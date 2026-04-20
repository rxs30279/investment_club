// Smoke test: each external data source used by /api/monthly-brief.
// Fires one representative request at each and prints a tiny sample so we can
// see at a glance whether a source has broken, changed shape, or rate-limited.
//
// This is a URL-level check. It catches upstream outages and response-shape
// changes — not regressions in the parsing logic inside lib/sources/. Those
// are covered by the full end-to-end run in test-monthly-brief-stream.mjs.
//
// Run: node scripts/test-sources.mjs

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const RESULTS = [];

function mark(name, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL';
  RESULTS.push({ name, ok });
  console.log(`[${tag}] ${name.padEnd(32)} ${detail}`);
}

async function timed(fn) {
  const t0 = Date.now();
  try { return { value: await fn(), ms: Date.now() - t0, err: null }; }
  catch (err) { return { value: null, ms: Date.now() - t0, err }; }
}

async function testYahooMacro() {
  const { value: json, ms, err } = await timed(async () => {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EFTSE', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
  const ok = typeof price === 'number' && price > 0;
  mark('Yahoo Finance (^FTSE price)', ok, ok ? `${price} (${ms}ms)` : `failed ${err?.message ?? 'no price'}`);
}

async function testYahooDividends() {
  const { value: json, ms, err } = await timed(async () => {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/BP.L?interval=1mo&range=12mo&events=div', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  const divs = json?.chart?.result?.[0]?.events?.dividends;
  const count = divs ? Object.keys(divs).length : 0;
  const ok = count > 0;
  mark('Yahoo Finance (BP.L dividends)', ok, ok ? `${count} events (${ms}ms)` : `no dividend events ${err?.message ?? ''}`);
}

async function testYahooYtd() {
  const period1 = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const { value: json, ms, err } = await timed(async () => {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EFTSE?interval=1d&period1=${period1}&period2=${period2}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  const count = closes?.filter(v => v != null).length ?? 0;
  const ok = count > 10;
  mark('Yahoo Finance (^FTSE YTD daily)', ok, ok ? `${count} daily closes (${ms}ms)` : `only ${count} closes ${err?.message ?? ''}`);
}

async function testBoe() {
  const { value: csv, ms, err } = await timed(async () => {
    const res = await fetch(
      'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp' +
      '?csv.x=yes&SeriesCodes=IUDBEDR,IUDMNPY&CSVF=TT&UsingCodes=Y&Datefrom=01/Jan/2025&Dateto=now',
      { headers: { 'User-Agent': UA, 'Accept': 'text/csv' }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  const dataRows = csv ? csv.split('\n').filter(l => /^\d{2}\s+[A-Z][a-z]{2}\s+\d{4}/.test(l)).length : 0;
  const ok = dataRows > 0;
  mark('Bank of England (IADB CSV)', ok, ok ? `${dataRows} data rows (${ms}ms)` : `no data rows ${err?.message ?? ''}`);
}

async function testOnsCpi() {
  const { value: csv, ms, err } = await timed(async () => {
    const res = await fetch('https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/d7g7/mm23', {
      headers: { 'User-Agent': UA, 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  const matches = csv ? [...csv.matchAll(/^"(\d{4}\s+[A-Z][A-Z0-9]+)","(-?[\d.]+)"/gm)] : [];
  const ok = matches.length > 0;
  const latest = matches[matches.length - 1];
  mark('ONS (CPI annual rate D7G7)', ok, ok ? `latest ${latest[1]} = ${latest[2]}% (${ms}ms)` : `no rows ${err?.message ?? ''}`);
}

async function testOnsGdp() {
  const { value: csv, ms, err } = await timed(async () => {
    const res = await fetch('https://www.ons.gov.uk/generator?format=csv&uri=/economy/grossdomesticproductgdp/timeseries/ihyq/qna', {
      headers: { 'User-Agent': UA, 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  const matches = csv ? [...csv.matchAll(/^"(\d{4}\s+[A-Z][A-Z0-9]+)","(-?[\d.]+)"/gm)] : [];
  const ok = matches.length > 0;
  const latest = matches[matches.length - 1];
  mark('ONS (GDP Q/Q IHYQ)', ok, ok ? `latest ${latest[1]} = ${latest[2]}% (${ms}ms)` : `no rows ${err?.message ?? ''}`);
}

async function testJustEtf() {
  const { value: html, ms, err } = await timed(async () => {
    const res = await fetch('https://www.justetf.com/uk/market-overview/the-best-etfs.html', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  const ROW_RE = /^(.*?)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+(\d+\s+ETFs?)$/;
  const trMatches = html?.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  let parsed = 0;
  for (const tr of trMatches) {
    const text = tr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (ROW_RE.test(text)) parsed++;
  }
  const ok = parsed >= 5;
  mark('JustETF (best ETFs page)', ok, ok ? `${parsed} rows parsed (${ms}ms)` : `only ${parsed} rows parsed ${err?.message ?? ''}`);
}

async function testInvestegate() {
  // Use yesterday to avoid empty page races (no announcements yet today)
  const d = new Date();
  d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() - 2);
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  const date = d.toISOString().slice(0, 10);

  const { value: html, ms, err } = await timed(async () => {
    const res = await fetch(`https://www.investegate.co.uk/today-announcements/${date}`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  const links = html?.match(/<a[^>]*class="announcement-link"[^>]*href="([^"]+)"/gi) ?? [];
  const ok = links.length > 0;
  mark(`Investegate (${date})`, ok, ok ? `${links.length} announcement links (${ms}ms)` : `no announcement-link anchors ${err?.message ?? ''}`);
}

async function testGoogleNewsRss() {
  const { value: xml, ms, err } = await timed(async () => {
    const res = await fetch('https://news.google.com/rss/search?q=%22BP%22&hl=en-GB&gl=GB&ceid=GB:en', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, text/xml' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  const items = xml?.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  const ok = items.length > 0;
  mark('Google News RSS', ok, ok ? `${items.length} <item> blocks (${ms}ms)` : `no items ${err?.message ?? ''}`);
}

console.log('Probing external sources…\n');

await Promise.all([
  testYahooMacro(),
  testYahooDividends(),
  testYahooYtd(),
  testBoe(),
  testOnsCpi(),
  testOnsGdp(),
  testJustEtf(),
  testInvestegate(),
  testGoogleNewsRss(),
]);

const pass = RESULTS.filter(r => r.ok).length;
const fail = RESULTS.length - pass;
console.log(`\nResults: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
