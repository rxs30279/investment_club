// Diagnostic script: time every step of the monthly brief generation pipeline
// to find where it hangs or fails. Run: node scripts/diagnose-monthly-brief.mjs
//
// Reads DEEPSEEK_API_KEY and Supabase keys from .env.local.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = join(__dirname, '..', '.env.local');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DEEPSEEK_KEY = env.DEEPSEEK_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase env vars.'); process.exit(1); }
if (!DEEPSEEK_KEY) { console.error('Missing DEEPSEEK_API_KEY.'); process.exit(1); }

// ── Helpers ──────────────────────────────────────────────────────────────────
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const YH = { ...UA, Accept: 'application/json' };
const HH = { ...UA, Accept: 'text/html' };

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    console.log(`  [${String(ms).padStart(5)} ms] ${label} — OK`);
    return { ok: true, ms, result };
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`  [${String(ms).padStart(5)} ms] ${label} — FAIL: ${err.message ?? err}`);
    return { ok: false, ms, error: err.message ?? String(err) };
  }
}

// ── Fetchers (mirrors route.ts) ──────────────────────────────────────────────
async function fetchTickers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/holdings?select=ticker,name&order=ticker.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function fetchYahooQuote(ticker) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
    { headers: YH, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`Yahoo ${ticker} ${res.status}`);
  return res.json();
}

async function fetchBoeBankRate() {
  // Bank of England IADB - bank rate
  const res = await fetch(
    'https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp?Travel=NIxIRx&FromSeries=1&ToSeries=50&DAT=RNG&FD=1&FM=Jan&FY=2024&TD=1&TM=Jan&TY=2026&FNY=Y&CSVF=TT&html.x=66&html.y=26&SeriesCodes=IUDBEDR&UsingCodes=Y&Filter=N&title=IUDBEDR&VPD=Y',
    { headers: HH, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`BoE ${res.status}`);
  const text = await res.text();
  if (text.length < 100) throw new Error('BoE empty response');
  return text.length;
}

async function fetchJustEtf() {
  const res = await fetch('https://www.justetf.com/uk/etf-screener.html', {
    headers: HH, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`JustETF ${res.status}`);
  return (await res.text()).length;
}

async function fetchInvestegateDay(date) {
  const res = await fetch(`https://www.investegate.co.uk/today-announcements/${date}`, {
    headers: HH, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Investegate ${date} ${res.status}`);
  return (await res.text()).length;
}

async function fetchGoogleNews(query) {
  const res = await fetch(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`,
    { headers: { ...UA, Accept: 'application/rss+xml,application/xml;q=0.9' }, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`Google News ${res.status}`);
  return (await res.text()).length;
}

async function smallDeepSeekCall() {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You output only the literal text "OK".' },
        { role: 'user',   content: 'Reply.' },
      ],
      max_tokens: 8,
      temperature: 0,
      stream: false,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek ${res.status} ${errText.slice(0, 300)}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '[no content]';
}

async function realisticDeepSeekCall() {
  // Simulate a real Part-2-sized prompt (~6KB input, 8192 output max) to
  // measure typical latency. This is what the route does 3x in parallel.
  const filler = 'ANALYSIS NOTES: '.repeat(200);
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a UK investment analyst. Write detailed HTML.' },
        { role: 'user',   content: `Write a 2000-word HTML analysis of UK FTSE 100 trends. Context: ${filler}` },
      ],
      max_tokens: 8192,
      temperature: 0.7,
      stream: true,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek ${res.status} ${errText.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let firstByteAt = null;
  const t0 = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteAt === null) firstByteAt = Date.now() - t0;
    total += decoder.decode(value, { stream: true }).length;
  }
  return `${total} bytes streamed, first chunk after ${firstByteAt}ms`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Step 1: Supabase holdings ===');
  const holdingsRes = await timed('fetch holdings', fetchTickers);
  if (!holdingsRes.ok) process.exit(1);
  const tickers = holdingsRes.result.map(h => h.ticker);
  console.log(`  ${tickers.length} tickers: ${tickers.join(', ')}\n`);

  console.log('=== Step 2: Yahoo Finance (1 macro + first 3 tickers) ===');
  await timed('Yahoo macro (^FTSE)', () => fetchYahooQuote('^FTSE'));
  for (const t of tickers.slice(0, 3)) {
    await timed(`Yahoo quote ${t}`, () => fetchYahooQuote(t));
  }
  console.log('');

  console.log('=== Step 3: External data sources ===');
  await timed('Bank of England (IADB)', fetchBoeBankRate);
  await timed('JustETF', fetchJustEtf);
  console.log('');

  console.log('=== Step 4: Investegate (5 sample trading days, parallel) ===');
  const dates = [];
  const today = new Date();
  for (let d = 0; d < 10 && dates.length < 5; d++) {
    const dt = new Date(today); dt.setDate(today.getDate() - d);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    dates.push(dt.toISOString().slice(0, 10));
  }
  const t0 = Date.now();
  const investRes = await Promise.allSettled(dates.map(d => fetchInvestegateDay(d)));
  console.log(`  [${String(Date.now() - t0).padStart(5)} ms] ${dates.length} days in parallel — ${investRes.filter(r => r.status === 'fulfilled').length}/${dates.length} OK`);
  for (let i = 0; i < dates.length; i++) {
    const r = investRes[i];
    console.log(`     ${dates[i]}: ${r.status === 'fulfilled' ? 'OK ' + r.value + ' bytes' : 'FAIL ' + r.reason.message}`);
  }
  console.log('');

  console.log('=== Step 5: Google News (first ticker company) ===');
  const firstName = holdingsRes.result[0]?.name ?? 'Rolls Royce';
  await timed(`Google News "${firstName}"`, () => fetchGoogleNews(firstName));
  console.log('');

  console.log('=== Step 6: DeepSeek API ===');
  const ds1 = await timed('Small smoke test (8 tokens)', smallDeepSeekCall);
  if (ds1.ok) console.log(`     Response: "${ds1.result}"`);
  console.log('');

  console.log('=== Step 7: DeepSeek realistic streaming call (8192 tokens, ~part-sized) ===');
  const ds2 = await timed('Realistic streaming call', realisticDeepSeekCall);
  if (ds2.ok) console.log(`     ${ds2.result}`);
  console.log('');

  console.log('=== Done ===');
  console.log('If the DeepSeek streaming call took >50s, the route\'s 3x parallel calls likely time out at the platform/browser layer.');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
