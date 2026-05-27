// Diagnostic script: fetch Investegate RNS data for portfolio tickers
// Run: node scripts/diagnose-rns.mjs

const SUPABASE_URL = 'https://houiwkuqhpylupdbqogu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvdWl3a3VxaHB5bHVwZGJxb2d1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYyMTY4MywiZXhwIjoyMDkwMTk3NjgzfQ.OUPt7IE2F_z-NfIYKIWluGbWBjuGq8Y4ox4pF6SU1Xw';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ── Fetch tickers from Supabase ───────────────────────────────────────────────

async function fetchTickers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/holdings?select=ticker,name&order=ticker.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  const rows = await res.json();
  // Deduplicate
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.ticker)) return false; seen.add(r.ticker); return true; });
}

// ── Investegate helpers (same logic as route.ts) ──────────────────────────────

const TICKER_RE   = /\/announcement\/[a-z]+\/[^\/]+--([a-z0-9.]+)\/([^\/]+)\//i;
const ANN_LINK_RE = /<a[^>]*class="announcement-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
const SUMMARY_RE  = /<div[^>]*id="collapseSummary"[^>]*>([\s\S]*?)<p[^>]*id="summary-disclaimer"/i;

const DIRECTOR_KW = [
  'director/pdmr shareholding', 'pdmr shareholding', 'director shareholding',
  'director dealing', 'director purchase', 'director sale', 'pdmr dealing',
];

const MATERIAL_KW = [
  { kw: 'preliminary results',    category: 'Results' },
  { kw: 'preliminary result',     category: 'Results' },
  { kw: 'full year results',      category: 'Results' },
  { kw: 'full-year results',      category: 'Results' },
  { kw: 'annual results',         category: 'Results' },
  { kw: 'half year results',      category: 'Results' },
  { kw: 'half-year results',      category: 'Results' },
  { kw: 'interim results',        category: 'Results' },
  { kw: 'half year report',       category: 'Results' },
  { kw: 'annual report',          category: 'Results' },
  { kw: 'trading update',         category: 'Trading Update' },
  { kw: 'trading statement',      category: 'Trading Update' },
  { kw: 'profit warning',         category: 'Profit Warning' },
  { kw: 'revenue update',         category: 'Trading Update' },
  { kw: 'business update',        category: 'Trading Update' },
  { kw: 'acquisition',            category: 'Acquisition/Disposal' },
  { kw: 'disposal',               category: 'Acquisition/Disposal' },
  { kw: 'merger',                 category: 'Acquisition/Disposal' },
  { kw: 'recommended offer',      category: 'Acquisition/Disposal' },
  { kw: 'recommended cash offer', category: 'Acquisition/Disposal' },
  { kw: 'firm offer',             category: 'Acquisition/Disposal' },
  { kw: 'placing',                category: 'Capital Raise' },
  { kw: 'rights issue',           category: 'Capital Raise' },
  { kw: 'capital raise',          category: 'Capital Raise' },
  { kw: 'share issuance',         category: 'Capital Raise' },
  { kw: 'dividend declaration',   category: 'Dividend' },
  { kw: 'special dividend',       category: 'Dividend' },
  { kw: 'dividend cut',           category: 'Dividend' },
  { kw: 'dividend increase',      category: 'Dividend' },
  { kw: 'interim dividend',       category: 'Dividend' },
  { kw: 'final dividend',         category: 'Dividend' },
  { kw: 'chief executive',        category: 'Board Change' },
  { kw: 'chief financial',        category: 'Board Change' },
  { kw: 'chairman',               category: 'Board Change' },
  { kw: 'board change',           category: 'Board Change' },
  { kw: 'director appointment',   category: 'Board Change' },
  { kw: 'director resignation',   category: 'Board Change' },
  { kw: 'strategy update',        category: 'Strategy' },
  { kw: 'strategic review',       category: 'Strategy' },
  { kw: 'contract win',           category: 'Contract' },
  { kw: 'new contract',           category: 'Contract' },
  { kw: 'material contract',      category: 'Contract' },
  { kw: 'index change',           category: 'Index Change' },
  { kw: 'ftse russell',           category: 'Index Change' },
  { kw: 'index rebalance',        category: 'Index Change' },
  { kw: 'regulatory update',      category: 'Regulatory' },
  { kw: 'outcome of investigation', category: 'Regulatory' },
  { kw: 'court judgment',         category: 'Regulatory' },
  { kw: 'material litigation',    category: 'Regulatory' },
];

function classifyHeadline(headline) {
  const h = headline.toLowerCase();
  if (DIRECTOR_KW.some(kw => h.includes(kw))) return 'director';
  if (MATERIAL_KW.some(({ kw }) => h.includes(kw))) return 'material';
  return 'routine';
}

function materialCategory(headline) {
  const h = headline.toLowerCase();
  return MATERIAL_KW.find(({ kw }) => h.includes(kw))?.category ?? 'Other';
}

function buildTradingDates(count = 45) {
  const today = new Date();
  const dates = [];
  for (let d = 0; d < count * 2 && dates.length < count; d++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - d);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchDailyPages(dates) {
  const results = await Promise.allSettled(
    dates.map(date =>
      fetch(`https://www.investegate.co.uk/today-announcements/${date}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(10000),
      }).then(async r => ({ date, html: r.ok ? await r.text() : '' }))
    )
  );
  return results.flatMap(r => r.status === 'fulfilled' && r.value.html ? [r.value] : []);
}

async function fetchAnnouncementSummary(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = SUMMARY_RE.exec(html);
    if (!m) return null;
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching portfolio tickers from Supabase...');
  const holdings = await fetchTickers();
  const tickers = holdings.map(h => h.ticker);
  console.log(`Found ${tickers.length} holdings: ${tickers.join(', ')}\n`);

  // Strip exchange suffixes for Investegate matching
  const tickerSet = new Set(tickers.map(t => t.toUpperCase().replace(/[^A-Z0-9.]/g, '').replace(/\.[A-Z]{1,2}$/, '')));
  console.log(`Investegate ticker set: ${[...tickerSet].join(', ')}\n`);

  const dates = buildTradingDates(30);
  console.log(`Fetching ${dates.length} trading days of Investegate pages (${dates.at(-1)} → ${dates[0]})...`);
  const pages = await fetchDailyPages(dates);
  console.log(`Successfully fetched ${pages.length}/${dates.length} pages.\n`);

  // Single pass classification
  const allHits = [];
  const directorHits = [];
  const materialHits = [];

  for (const { date, html } of pages) {
    let m;
    ANN_LINK_RE.lastIndex = 0;
    while ((m = ANN_LINK_RE.exec(html)) !== null) {
      const rawUrl = m[1];
      const url = rawUrl.startsWith('http') ? rawUrl : `https://www.investegate.co.uk${rawUrl}`;
      const headline = m[2].trim();
      const tickerM = TICKER_RE.exec(url);
      if (!tickerM) continue;
      const ticker = tickerM[1].toUpperCase();
      if (!tickerSet.has(ticker)) continue;

      const item = { date, ticker, headline, url };
      allHits.push(item);

      const cls = classifyHeadline(headline);
      if (cls === 'director') directorHits.push(item);
      if (cls === 'material') materialHits.push({ ...item, category: materialCategory(headline) });
    }
  }

  console.log(`=== CLASSIFICATION SUMMARY ===`);
  console.log(`Total hits: ${allHits.length}`);
  console.log(`Material:   ${materialHits.length}`);
  console.log(`Director:   ${directorHits.length}`);
  console.log(`Routine:    ${allHits.length - materialHits.length - directorHits.length}\n`);

  // ── All hits index ────────────────────────────────────────────────────────
  console.log('=== ALL RNS HITS (chronological, newest first) ===\n');
  if (allHits.length === 0) {
    console.log('[None found — possible Investegate scraping issue]\n');
  } else {
    allHits.sort((a, b) => b.date.localeCompare(a.date));
    const byTicker = {};
    for (const h of allHits) (byTicker[h.ticker] ??= []).push(h);
    for (const [ticker, items] of Object.entries(byTicker).sort()) {
      console.log(`${ticker} (${items.length}):`);
      for (const item of items) console.log(`  ${item.date}  ${item.headline}`);
      console.log('');
    }
  }

  // ── Material hits with summaries ──────────────────────────────────────────
  console.log('=== MATERIAL ANNOUNCEMENTS (fetching summaries...) ===\n');
  if (materialHits.length === 0) {
    console.log('[None found]\n');
  } else {
    const summaryResults = await Promise.allSettled(
      materialHits.slice(0, 20).map(item =>
        fetchAnnouncementSummary(item.url).then(s => ({ ...item, summary: s }))
      )
    );

    const byCat = {};
    for (const r of summaryResults) {
      if (r.status !== 'fulfilled') continue;
      const { category } = r.value;
      (byCat[category] ??= []).push(r.value);
    }

    for (const [cat, items] of Object.entries(byCat).sort()) {
      console.log(`--- ${cat} ---`);
      for (const { date, ticker, headline, summary } of items) {
        console.log(`${date}  ${ticker}  ${headline}`);
        if (summary) {
          console.log(`  SUMMARY: ${summary.slice(0, 600)}${summary.length > 600 ? '...' : ''}`);
        } else {
          console.log(`  SUMMARY: [not found on page]`);
        }
        console.log('');
      }
    }
  }

  // ── Director dealings with summaries ─────────────────────────────────────
  console.log('=== DIRECTOR/PDMR DEALINGS (fetching summaries...) ===\n');
  if (directorHits.length === 0) {
    console.log('[None found]\n');
  } else {
    const summaryResults = await Promise.allSettled(
      directorHits.slice(0, 20).map(item =>
        fetchAnnouncementSummary(item.url).then(s => ({ ...item, summary: s }))
      )
    );
    for (const r of summaryResults) {
      if (r.status !== 'fulfilled') continue;
      const { date, ticker, headline, summary } = r.value;
      console.log(`${date}  ${ticker}  ${headline}`);
      if (summary) {
        console.log(`  SUMMARY: ${summary.slice(0, 600)}${summary.length > 600 ? '...' : ''}`);
      } else {
        console.log(`  SUMMARY: [not found on page]`);
      }
      console.log('');
    }
  }
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
