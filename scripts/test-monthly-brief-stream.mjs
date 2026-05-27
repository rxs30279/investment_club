// Test the /api/monthly-brief streaming behavior end-to-end against
// the local dev server. Prints each NDJSON event with a wall-clock timestamp
// so we can confirm bytes flow throughout the ~140s DeepSeek wait.
//
// Run: node scripts/test-monthly-brief-stream.mjs

import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${path} ${r.status}`);
  return r.json();
}

console.log('Loading minimal payload from Supabase...');
const holdings = await sb('holdings?select=ticker,name,sector&order=ticker.asc');
// Deduplicate
const seen = new Set();
// Position objects need the computed fields buildPortfolioJSON expects.
// Real values come from calculatePositions in the manage page; for this
// streaming test stub values are fine — we only care about events flowing.
const positions = holdings
  .filter(h => { if (seen.has(h.ticker)) return false; seen.add(h.ticker); return true; })
  .map(h => ({
    name: h.name, ticker: h.ticker, sector: h.sector ?? '',
    avgCost: 100, currentPrice: 100, pnlPercent: 0, currentValue: 1000,
  }));
const unitValues = await sb('unit_values?select=*&order=valuation_date.desc&limit=24');

const today = new Date();
const reportMonth = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const currentDate = today.toISOString().slice(0, 10);

const body = {
  positions,
  monthlyPerf: {},
  unitValues,
  reportMonth,
  currentDate,
  userArticles: '',
};

console.log(`Payload: ${positions.length} positions, ${unitValues.length} unit values`);
const TARGET = process.env.TARGET ?? 'http://localhost:3000';
console.log(`POST ${TARGET}/api/monthly-brief\n`);

const t0 = Date.now();
const adminSecret = env.MANAGE_API_SECRET ?? process.env.MANAGE_API_SECRET;
const res = await fetch(`${TARGET}/api/monthly-brief`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(adminSecret ? { 'x-admin-secret': adminSecret } : {}),
  },
  body: JSON.stringify(body),
});

console.log(`[+${(Date.now() - t0) / 1000}s] HTTP ${res.status} ${res.headers.get('content-type')}`);
if (!res.ok) {
  console.log(await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let evtCount = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    evtCount++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (evt.type === 'chunk') {
      // Throttle chunk logging — print every 10th
      if (evtCount % 10 === 0) console.log(`[+${elapsed}s] chunk part=${evt.part} chars=${evt.chars}`);
    } else if (evt.type === 'done') {
      console.log(`[+${elapsed}s] DONE — html=${evt.html?.length ?? 0} bytes, dbError=${evt.dbError ?? 'none'}`);
    } else if (evt.type === 'error') {
      console.log(`[+${elapsed}s] ERROR — ${evt.error}`);
    } else {
      console.log(`[+${elapsed}s] ${JSON.stringify(evt)}`);
    }
  }
}

console.log(`\nTotal events: ${evtCount}, total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
