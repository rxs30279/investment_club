import type { InvestegateData, RnsItem } from '../monthly-brief/types';

// Daily pages at /today-announcements/YYYY-MM-DD are fetched ONCE.
// Each announcement link URL contains the ticker:
//   /announcement/{type}/{slug}--{ticker}/{headline-slug}/{id}
//
// In a single pass over the pages we classify every portfolio hit into:
//   1. allRns       – every headline (index / reference)
//   2. directorHits – Director/PDMR Shareholding (personal trades only)
//   3. materialHits – high-value corporate announcements
//
// Summaries are then fetched in parallel for director + material hits.

const TICKER_RE   = /\/announcement\/[a-z]+\/[^/]+--([a-z0-9.]+)\/([^/]+)\//i;
// Match any <a> with class="announcement-link" regardless of attribute order.
// Old regex was strict about class being the first attribute.
const ANN_LINK_RE = /<a\b[^>]*?\bclass\s*=\s*["'][^"']*\bannouncement-link\b[^"']*["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const ANN_LINK_RE_HREF_FIRST = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*?\bclass\s*=\s*["'][^"']*\bannouncement-link\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
// Summary block — accept either #collapseSummary id or a class containing 'summary'.
const SUMMARY_RE  = /<div[^>]*\b(?:id\s*=\s*["']collapseSummary["']|class\s*=\s*["'][^"']*\bcollapse-summary\b[^"']*["'])[^>]*>([\s\S]*?)(?:<p[^>]*\bid\s*=\s*["']summary-disclaimer["']|<\/div>)/i;

// Director/PDMR personal share purchases or sales
const DIRECTOR_KW = [
  'director/pdmr shareholding', 'pdmr shareholding', 'director shareholding',
  'director dealing', 'director purchase', 'director sale', 'pdmr dealing',
];

// Material corporate events — always worth fetching the full AI summary.
// Categories tagged 'aggregate: true' get rolled up into one synthetic record
// per ticker (e.g. 53 daily buyback executions → one row). Without that LLOY's
// buyback programme would flood section 8 and crowd out everything else.
const MATERIAL_KW: { kw: string; category: string; aggregate?: boolean }[] = [
  // Results
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
  { kw: 'q1 results',             category: 'Results' },
  { kw: 'q2 results',             category: 'Results' },
  { kw: 'q3 results',             category: 'Results' },
  { kw: 'first quarter results',  category: 'Results' },
  { kw: 'third quarter results',  category: 'Results' },
  // Guidance & warnings
  { kw: 'trading update',         category: 'Trading Update' },
  { kw: 'trading statement',      category: 'Trading Update' },
  { kw: 'profit warning',         category: 'Profit Warning' },
  { kw: 'revenue update',         category: 'Trading Update' },
  { kw: 'business update',        category: 'Trading Update' },
  { kw: 'agm statement',          category: 'Trading Update' },
  { kw: 'agm trading',            category: 'Trading Update' },
  { kw: 'q1 update',              category: 'Trading Update' },
  { kw: 'q2 update',              category: 'Trading Update' },
  { kw: 'q3 update',              category: 'Trading Update' },
  { kw: 'q4 update',              category: 'Trading Update' },
  { kw: 'quarterly update',       category: 'Trading Update' },
  { kw: 'operations update',      category: 'Trading Update' },
  { kw: 'operational update',     category: 'Trading Update' },
  { kw: 'production update',      category: 'Trading Update' },
  { kw: 'reserves update',        category: 'Trading Update' },
  // Corporate actions
  { kw: 'acquisition',            category: 'Acquisition/Disposal' },
  { kw: 'disposal',               category: 'Acquisition/Disposal' },
  { kw: 'merger',                 category: 'Acquisition/Disposal' },
  { kw: 'recommended offer',      category: 'Acquisition/Disposal' },
  { kw: 'recommended cash offer', category: 'Acquisition/Disposal' },
  { kw: 'firm offer',             category: 'Acquisition/Disposal' },
  // Capital — buyback executions are aggregated so 50 daily rows for one programme become one line
  { kw: 'placing',                category: 'Capital Raise' },
  { kw: 'rights issue',           category: 'Capital Raise' },
  { kw: 'capital raise',          category: 'Capital Raise' },
  { kw: 'share issuance',         category: 'Capital Raise' },
  { kw: 'bond repurchase',        category: 'Capital Raise' },
  { kw: 'senior unsecured',       category: 'Capital Raise' },
  { kw: 'convertible bond',       category: 'Capital Raise' },
  { kw: 'notes issue',            category: 'Capital Raise' },
  { kw: 'share buyback',          category: 'Buyback' },
  { kw: 'share repurchase',       category: 'Buyback' },
  { kw: 'buyback programme',      category: 'Buyback' },
  { kw: 'buy-back programme',     category: 'Buyback' },
  { kw: 'transaction in own shares', category: 'Buyback', aggregate: true },
  // Dividends
  { kw: 'dividend declaration',   category: 'Dividend' },
  { kw: 'special dividend',       category: 'Dividend' },
  { kw: 'dividend cut',           category: 'Dividend' },
  { kw: 'dividend increase',      category: 'Dividend' },
  { kw: 'interim dividend',       category: 'Dividend' },
  { kw: 'final dividend',         category: 'Dividend' },
  // Board & strategy
  { kw: 'chief executive',        category: 'Board Change' },
  { kw: 'chief financial',        category: 'Board Change' },
  { kw: 'chairman',               category: 'Board Change' },
  { kw: 'board change',           category: 'Board Change' },
  { kw: 'director appointment',   category: 'Board Change' },
  { kw: 'director resignation',   category: 'Board Change' },
  { kw: 'strategy update',        category: 'Strategy' },
  { kw: 'strategic review',       category: 'Strategy' },
  // Contracts & operations
  { kw: 'contract win',           category: 'Contract' },
  { kw: 'new contract',           category: 'Contract' },
  { kw: 'material contract',      category: 'Contract' },
  { kw: 'joint venture',          category: 'Contract' },
  // Shareholder changes — institutional stake moves crossing 3% threshold (aggregated)
  { kw: 'holding(s) in company',  category: 'Shareholder Change', aggregate: true },
  { kw: 'holdings in company',    category: 'Shareholder Change', aggregate: true },
  { kw: 'major shareholding',     category: 'Shareholder Change', aggregate: true },
  // Index changes (FTSE inclusions/exclusions are price-moving)
  { kw: 'index change',           category: 'Index Change' },
  { kw: 'ftse russell',           category: 'Index Change' },
  { kw: 'index rebalance',        category: 'Index Change' },
  // Regulatory & legal
  { kw: 'regulatory update',      category: 'Regulatory' },
  { kw: 'outcome of investigation', category: 'Regulatory' },
  { kw: 'court judgment',         category: 'Regulatory' },
  { kw: 'material litigation',    category: 'Regulatory' },
];

const AGGREGATE_CATEGORIES = new Set(
  MATERIAL_KW.filter(k => k.aggregate).map(k => k.category)
);

function classifyHeadline(headline: string): 'director' | 'material' | 'routine' {
  const h = headline.toLowerCase();
  if (DIRECTOR_KW.some(kw => h.includes(kw))) return 'director';
  if (MATERIAL_KW.some(({ kw }) => h.includes(kw)))  return 'material';
  return 'routine';
}

function materialCategory(headline: string): string {
  const h = headline.toLowerCase();
  return MATERIAL_KW.find(({ kw }) => h.includes(kw))?.category ?? 'Other';
}

function buildTradingDates(count = 45): string[] {
  const today = new Date();
  const dates: string[] = [];
  for (let d = 0; d < count * 2 && dates.length < count; d++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - d);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchDailyPages(dates: string[]): Promise<{ date: string; html: string }[]> {
  const PAGE_LIMIT = /announcement-link/;
  const MAX_PAGES  = 10;

  async function fetchAllPagesForDate(date: string): Promise<{ date: string; html: string }[]> {
    const pages: { date: string; html: string }[] = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = p === 1
        ? `https://www.investegate.co.uk/today-announcements/${date}`
        : `https://www.investegate.co.uk/today-announcements/${date}?page=${p}`;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) break;
        const html = await r.text();
        if (!html || !PAGE_LIMIT.test(html)) break;
        pages.push({ date, html });
        const maxPage = Math.max(...[...html.matchAll(/[?&]page=(\d+)/gi)].map(m => parseInt(m[1], 10)), 0);
        if (maxPage < p + 1) break;
      } catch { break; }
    }
    return pages;
  }

  // Batch in groups of 5 to avoid overwhelming Investegate with concurrent connections
  const BATCH = 5;
  const out: { date: string; html: string }[] = [];
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = await Promise.allSettled(dates.slice(i, i + BATCH).map(fetchAllPagesForDate));
    out.push(...batch.flatMap(r => r.status === 'fulfilled' ? r.value : []));
  }
  return out;
}

async function fetchAnnouncementSummary(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = SUMMARY_RE.exec(html);
    if (!m) return null;
    return m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  } catch { return null; }
}

function extractAnnouncementLinks(html: string): { url: string; headline: string }[] {
  const seen = new Set<string>();
  const out: { url: string; headline: string }[] = [];
  for (const re of [ANN_LINK_RE, ANN_LINK_RE_HREF_FIRST]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);
      const headline = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (headline) out.push({ url, headline });
    }
  }
  return out;
}

export async function fetchAllInvestegateData(tickers: string[]): Promise<InvestegateData> {
  const empty = {
    rnsData:      '[No RNS data — no tickers provided]',
    directorData: '[No director dealings data]',
    materialData: '[No material announcements data]',
  };
  if (tickers.length === 0) return empty;

  // Investegate URLs use bare tickers (e.g. "cwr") — strip exchange suffixes (.L, .AX, etc.)
  const tickerSet = new Set(tickers.map(t => t.toUpperCase().replace(/[^A-Z0-9.]/g, '').replace(/\.[A-Z]{1,2}$/, '')));
  const dates = buildTradingDates(60);
  const pages = await fetchDailyPages(dates);
  console.log(`[investegate] Fetched ${pages.length}/${dates.length} daily pages. Tickers: ${[...tickerSet].join(',')}`);
  if (pages.length > 0) {
    const sample = extractAnnouncementLinks(pages[0].html).slice(0, 3);
    console.log('[investegate] Sample announcement links from first page:', sample);
  }

  const allHits:      RnsItem[] = [];
  const directorHits: RnsItem[] = [];
  const materialHits: (RnsItem & { category: string })[] = [];

  for (const { date, html } of pages) {
    for (const { url: rawUrl, headline } of extractAnnouncementLinks(html)) {
      const url      = rawUrl.startsWith('http') ? rawUrl : `https://www.investegate.co.uk${rawUrl}`;
      const tickerM  = TICKER_RE.exec(url);
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

  // Aggregate noisy repeating categories (per-day buyback executions, recurring
  // shareholder-stake updates) into one synthetic record per ticker+category.
  // Without this an active buyback programme can flood section 8 with 50+ rows.
  type CategoryItem = RnsItem & { category: string; synthetic?: boolean };
  const individual: CategoryItem[] = [];
  const groupBuffer: Record<string, CategoryItem[]> = {};
  for (const item of materialHits) {
    if (AGGREGATE_CATEGORIES.has(item.category)) {
      (groupBuffer[`${item.ticker}|${item.category}`] ??= []).push(item);
    } else {
      individual.push(item);
    }
  }
  const aggregated: CategoryItem[] = Object.entries(groupBuffer).map(([key, items]) => {
    const [ticker, category] = key.split('|');
    const sorted = items.sort((a, b) => b.date.localeCompare(a.date));
    return {
      date:      sorted[0].date,
      ticker,
      headline:  `${items.length} × ${category} announcements (${sorted[sorted.length - 1].date} to ${sorted[0].date})`,
      url:       sorted[0].url,
      category,
      synthetic: true,
    };
  });
  const materialForSummary = [...individual, ...aggregated]
    .sort((a, b) => b.date.localeCompare(a.date));

  console.log(`[investegate] allHits: ${allHits.length}, director: ${directorHits.length}, material raw: ${materialHits.length}, after aggregate: ${materialForSummary.length}`);
  if (allHits.length > 0) console.log('[investegate] First hit:', JSON.stringify(allHits[0]));

  const [directorSummaries, materialSummaries] = await Promise.all([
    Promise.allSettled(
      directorHits.slice(0, 20).map(item =>
        fetchAnnouncementSummary(item.url).then(s => ({ ...item, summary: s }))
      )
    ),
    // Synthetic aggregated rows get no per-item summary — there's no single
    // Investegate summary that covers e.g. 53 daily buyback filings.
    Promise.allSettled(
      materialForSummary.slice(0, 40).map(async item => ({
        ...item,
        summary: item.synthetic ? null : await fetchAnnouncementSummary(item.url),
      }))
    ),
  ]);

  // RNS index is reference-only context for the model — summary form is enough.
  // One line per ticker keeps it tiny so the dropdown bloat doesn't eat the
  // prompt budget.
  const rnsLines: string[] = ['=== Investegate RNS index summary (last 60 trading days, portfolio holdings — counts only; see MATERIAL RNS for the substantive announcements) ===\n'];
  if (allHits.length === 0) {
    rnsLines.push('[No announcements found for portfolio tickers in this period]');
  } else {
    const byTicker: Record<string, RnsItem[]> = {};
    for (const h of allHits) (byTicker[h.ticker] ??= []).push(h);
    for (const [ticker, items] of Object.entries(byTicker).sort()) {
      const last = [...items].sort((a, b) => b.date.localeCompare(a.date))[0];
      rnsLines.push(`${ticker}: ${items.length} announcements (most recent ${last.date} — "${last.headline.slice(0, 80)}")`);
    }
  }

  const dirLines: string[] = ['=== Director/PDMR Dealings (last 60 trading days, live summaries from Investegate) ===\n'];
  const dirFulfilled = directorSummaries.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  if (dirFulfilled.length === 0) {
    dirLines.push('[No director/PDMR shareholding announcements found for portfolio holdings in this period]');
  } else {
    for (const { date, ticker, headline, summary } of dirFulfilled) {
      dirLines.push(`${date}  ${ticker}  ${headline}`);
      if (summary) dirLines.push(`  → ${summary}`);
      dirLines.push('');
    }
  }

  const matLines: string[] = ['=== Material RNS Announcements (last 60 trading days, live summaries from Investegate) ===\n'];
  const matFulfilled = materialSummaries.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  if (matFulfilled.length === 0) {
    matLines.push('[No material announcements (results, trading updates, acquisitions, etc.) found for portfolio holdings in this period]');
  } else {
    const byCat: Record<string, typeof matFulfilled> = {};
    for (const item of matFulfilled) (byCat[item.category] ??= []).push(item);
    for (const [cat, items] of Object.entries(byCat).sort()) {
      matLines.push(`--- ${cat} ---`);
      for (const { date, ticker, headline, summary } of items) {
        matLines.push(`${date}  ${ticker}  ${headline}`);
        if (summary) matLines.push(`  → ${summary}`);
        matLines.push('');
      }
    }
  }

  return {
    rnsData:      rnsLines.join('\n'),
    directorData: dirLines.join('\n'),
    materialData: matLines.join('\n'),
  };
}
