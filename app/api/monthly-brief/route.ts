// app/api/monthly-brief/route.ts
//
// Generates the monthly intelligence briefing using DeepSeek (deepseek-chat).
// DeepSeek is OpenAI-compatible and ~20x cheaper than Claude Sonnet.
//
// Live data fetched server-side before the prompt is sent:
//   - Macro prices (GBP/USD, Brent, Gold, FTSE 100/250 current)  — Yahoo Finance
//   - FTSE 100 / FTSE 250 YTD returns                            — Yahoo Finance
//   - Bank Rate + 10yr Gilt yield                                 — Bank of England IADB
//   - UK CPI annual rate                                          — ONS generator
//   - UK GDP quarterly growth rate                                — ONS generator
//   - ETF flow themes (best ETFs by YTD)                         — JustETF
//   - RNS headline index (last 45 trading days, portfolio tickers)— Investegate
//   - Material RNS summaries (results, trading updates, M&A etc.) — Investegate
//   - Director/PDMR dealing summaries                             — Investegate
//   - Dividend history (last 12 months, ex-div dates + amounts)   — Yahoo Finance
//   - Dividend payment dates (where declared in last 45 days)     — extracted from RNS announcement summaries
//
// DeepSeek uses its training knowledge only for fields not covered above
// (e.g. index membership, geographic revenue mix, takeover activity narrative).
//
// MAINTENANCE: Review this prompt each quarter — ETF themes, macro context,
// and portfolio holdings change. The section list and tone guidance should be
// checked against the original prompt spec in ./original prompt.txt.

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Allow up to 5 minutes
export const maxDuration = 300;

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Position {
  name: string; ticker: string; sector: string;
  shares: number; avgCost: number; totalCost: number;
  currentPrice: number; currentValue: number;
  pnl: number; pnlPercent: number;
}
interface MonthlyPerfEntry { monthStart: number; current: number; changePercent: number; }
interface UnitValue      { valuation_date: string; unit_value: number; }
interface BenchmarkPoint { date: string; value: number; }

interface RequestBody {
  positions:    Position[];
  monthlyPerf:  Record<string, MonthlyPerfEntry>;
  unitValues:   UnitValue[];
  ftse100:      BenchmarkPoint[];
  ftse250:      BenchmarkPoint[];
  reportMonth:  string;
  currentDate:  string;
  userArticles?: string; // member-submitted articles/URLs from the monthly brief page
}

// ── Yahoo Finance macro fetches ────────────────────────────────────────────────

async function fetchYahooPrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(5000), headers: YAHOO_HEADERS }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch { return null; }
}

// ── Yahoo Finance dividend history ────────────────────────────────────────────
//
// Uses the v8 chart endpoint with events=div to get the last 12 months of
// ex-dividend dates and amounts for each portfolio holding.
// UK stocks need a ".L" suffix on Yahoo Finance; we try that first.

interface DividendEvent { date: string; amount: number; }

async function fetchDividendHistory(ticker: string): Promise<DividendEvent[]> {
  // Try with .L suffix (LSE), then bare ticker as fallback.
  // Strip any trailing dot before appending .L (e.g. "BP." → "BP.L" not "BP..L")
  const base = ticker.replace(/\.$/, '');
  const candidates = ticker.endsWith('.L') ? [ticker] : [`${base}.L`, ticker];
  for (const yTicker of candidates) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yTicker)}?interval=1mo&range=12mo&events=div`,
        { signal: AbortSignal.timeout(6000), headers: YAHOO_HEADERS }
      );
      if (!res.ok) continue;
      const json = await res.json();
      const rawDivs: Record<string, { amount: number; date: number }> =
        json?.chart?.result?.[0]?.events?.dividends ?? {};
      if (Object.keys(rawDivs).length === 0) continue;
      return Object.values(rawDivs)
        .map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch { /* try next candidate */ }
  }
  return [];
}

interface DividendRow { ticker: string; name: string; divs: DividendEvent[]; }

async function fetchDividendRows(positions: Position[]): Promise<DividendRow[]> {
  const results = await Promise.allSettled(
    positions.map(async p => ({
      ticker: p.ticker,
      name:   p.name,
      divs:   await fetchDividendHistory(p.ticker),
    }))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
}

// Payment dates are extracted from Investegate's AI summaries of Dividend category
// RNS announcements (the materialData feed). Summaries typically say "payable on
// 27 March 2026" or similar — we regex that out and match back to the Yahoo
// ex-div rows by pence amount. This only covers dividends declared within the
// 45-day RNS window; older rows get a blank Payment Date cell.
interface RnsPaymentRecord { amount: number; paymentDate: string; }

const MONTH_LOOKUP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08',
  sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

function parsePaymentDateString(raw: string): string | null {
  const trimmed = raw.trim().replace(/,/g, '');
  const word = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/);
  if (word) {
    const mm = MONTH_LOOKUP[word[2].toLowerCase()];
    if (!mm) return null;
    return `${word[3]}-${mm}-${word[1].padStart(2, '0')}`;
  }
  const slash = trimmed.match(/^(\d{1,2})[\-/](\d{1,2})[\-/](\d{2,4})$/);
  if (slash) {
    let [, d, m, y] = slash;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// "payable on 27 March 2026" / "will be paid on 27/03/2026" / "payment date: 27 Mar 2026"
const PAYMENT_PHRASE_RE = /(?:payable|(?:to be|due to be|expected to be|will be) paid|payment (?:will be made|date(?: is)?:?))[^\d\n]{0,60}?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+\d{4}|\d{1,2}[\-/]\d{1,2}[\-/](?:\d{4}|\d{2}))/i;
const AMOUNT_PENCE_RE   = /(\d+(?:\.\d+)?)\s*(?:pence per share|pence|p per share|p)\b/i;

function extractDividendPaymentDates(materialData: string): Map<string, RnsPaymentRecord[]> {
  const map = new Map<string, RnsPaymentRecord[]>();
  const divHeader = '--- Dividend ---';
  const divStart = materialData.indexOf(divHeader);
  if (divStart < 0) return map;
  let divEnd = materialData.indexOf('\n--- ', divStart + divHeader.length);
  if (divEnd < 0) divEnd = materialData.length;
  const section = materialData.substring(divStart + divHeader.length, divEnd);

  // Each entry: "YYYY-MM-DD  TICKER  Headline\n  → Summary"
  const entryRe = /^(\d{4}-\d{2}-\d{2})\s+(\S+)\s+[^\n]*\n\s*→\s+([\s\S]*?)(?=\n\s*\n|\n\d{4}-\d{2}-\d{2}\s|\s*$)/gm;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(section)) !== null) {
    const ticker  = m[2].toUpperCase().replace(/\.[A-Z]{1,2}$/, '');
    const summary = m[3];

    const payMatch = summary.match(PAYMENT_PHRASE_RE);
    if (!payMatch) continue;
    const paymentDate = parsePaymentDateString(payMatch[1]);
    if (!paymentDate) continue;

    const amtMatch = summary.match(AMOUNT_PENCE_RE);
    if (!amtMatch) continue;
    const amount = parseFloat(amtMatch[1]);
    if (!isFinite(amount)) continue;

    const list = map.get(ticker) ?? [];
    list.push({ amount, paymentDate });
    map.set(ticker, list);
  }
  return map;
}

function formatDividendData(rows: DividendRow[], paymentDates: Map<string, RnsPaymentRecord[]>): string {
  const lines: string[] = [
    '=== Dividend data (ex-div dates + amounts from Yahoo Finance; Payment Date column pre-extracted from RNS Dividend announcements via Investegate) ===\n',
    'Payment Date column is populated ONLY when the dividend was declared within the last 45 trading days (the RNS window) AND Investegate\'s AI summary contained a parseable payment-date phrase. Older ex-div rows correctly show "—" in that column — do not invent a date.',
    '',
    'Ticker     | Company                        | Ex-Div Date | Amount (p) | Payment Date | Notes',
    '-----------|--------------------------------|-------------|------------|--------------|------',
  ];

  let anyData = false;
  for (const { ticker, name, divs } of rows) {
    if (divs.length === 0) {
      lines.push(`${ticker.padEnd(10)} | ${name.substring(0, 30).padEnd(30)} | No dividend data found`);
      continue;
    }
    anyData = true;

    const bareTicker = ticker.toUpperCase().replace(/\.[A-Z]{1,2}$/, '').replace(/\.$/, '');
    const tickerPayDates = paymentDates.get(bareTicker) ?? [];

    for (const d of divs) {
      const matched = tickerPayDates.find(pd => Math.abs(pd.amount - d.amount) < 0.02);
      const payCell = matched ? matched.paymentDate : '—           ';
      lines.push(
        `${ticker.padEnd(10)} | ${name.substring(0, 30).padEnd(30)} | ${d.date}    |` +
        ` ${d.amount.toFixed(4).padStart(10)} | ${payCell.padEnd(12)} |`
      );
    }
  }

  if (!anyData) return '[Dividend data unavailable — use your knowledge for dividend dates and yields]';
  return lines.join('\n');
}

async function fetchMacroData() {
  const [gbpUsd, gbpEur, brent, gold, ftse100, ftse250] = await Promise.all([
    fetchYahooPrice('GBPUSD=X'),
    fetchYahooPrice('GBPEUR=X'),
    fetchYahooPrice('BZ=F'),
    fetchYahooPrice('GC=F'),
    fetchYahooPrice('^FTSE'),
    fetchYahooPrice('^FTMC'),
  ]);
  return { gbpUsd, gbpEur, brent, gold, ftse100, ftse250 };
}

// ── Bank of England + ONS live macro fetches ───────────────────────────────────
//
// BoE IADB API returns multi-series CSV; most-recent row is the latest value.
// ONS generator returns annual CSV; last quoted row is the latest month.

interface BoeMacro {
  bankRate:      number | null;
  giltYield10yr: number | null;
  ukCpi:         number | null;
  ukCpiDate:     string | null;
  ukGdpQoQ:      number | null;
  ukGdpDate:     string | null;
}

/** Parse latest value from BoE IADB multi-series CSV.
 *  Format after header block: DATE,COL1,COL2,...  */
function parseBoeCsv(csv: string, colIndex: number): number | null {
  const lines = csv.split('\n').filter(l => l.trim());
  // Find the data rows — they start after the blank line following the header block
  let dataStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{2}\s+[A-Z][a-z]{2}\s+\d{4}/.test(lines[i])) { dataStart = i; break; }
  }
  if (dataStart === -1) return null;
  // Walk backwards to find the last row with a value in the target column
  for (let i = lines.length - 1; i >= dataStart; i--) {
    const parts = lines[i].split(',');
    const val = parts[colIndex]?.trim();
    if (val && val !== '') {
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    }
  }
  return null;
}

/** Parse latest value + period label from ONS generator CSV.
 *  Format: "YYYY MON","value"  */
function parseOnsCsv(csv: string): { value: number | null; period: string | null } {
  const lines = csv.split('\n').filter(l => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^"(\d{4}\s+[A-Z]+)","([\d.]+)"/);
    if (m) return { value: parseFloat(m[2]), period: m[1] };
  }
  return { value: null, period: null };
}

async function fetchBoeMacro(): Promise<BoeMacro> {
  // Fetch Bank Rate + 10yr gilt in a single BoE request
  const boeFetch = fetch(
    'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp' +
    '?csv.x=yes&SeriesCodes=IUDBEDR,IUDMNPY&CSVF=TT&UsingCodes=Y&Datefrom=01/Jan/2025&Dateto=now',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    }
  );

  // ONS CPI annual rate (D7G7 from MM23 dataset)
  const onsFetch = fetch(
    'https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/d7g7/mm23',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    }
  );

  // ONS GDP quarterly growth rate (IHYQ Q/Q %, QNA dataset)
  const gdpFetch = fetch(
    'https://www.ons.gov.uk/generator?format=csv&uri=/economy/grossdomesticproductgdp/timeseries/ihyq/qna',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    }
  );

  const [boeRes, onsRes, gdpRes] = await Promise.allSettled([boeFetch, onsFetch, gdpFetch]);

  let bankRate: number | null = null;
  let giltYield10yr: number | null = null;
  if (boeRes.status === 'fulfilled' && boeRes.value.ok) {
    const csv = await boeRes.value.text();
    bankRate      = parseBoeCsv(csv, 1);   // IUDBEDR is column index 1
    giltYield10yr = parseBoeCsv(csv, 2);   // IUDMNPY is column index 2
  }

  let ukCpi: number | null = null;
  let ukCpiDate: string | null = null;
  if (onsRes.status === 'fulfilled' && onsRes.value.ok) {
    const csv = await onsRes.value.text();
    const parsed = parseOnsCsv(csv);
    ukCpi     = parsed.value;
    ukCpiDate = parsed.period;
  }

  let ukGdpQoQ: number | null = null;
  let ukGdpDate: string | null = null;
  if (gdpRes.status === 'fulfilled' && gdpRes.value.ok) {
    const csv = await gdpRes.value.text();
    const parsed = parseOnsCsv(csv);
    ukGdpQoQ = parsed.value;
    ukGdpDate = parsed.period;
  }

  return { bankRate, giltYield10yr, ukCpi, ukCpiDate, ukGdpQoQ, ukGdpDate };
}

// ── FTSE price on a specific date via Yahoo Finance ───────────────────────────
//
// Fetches a small daily window around the target date and returns the last
// valid close — this handles weekends/holidays where the exact date has no data.

async function fetchFtseOnDate(ticker: string, targetDate: string): Promise<number | null> {
  const date    = new Date(targetDate);
  const period1 = Math.floor(date.getTime() / 1000) - 86400 * 5; // 5 days back buffer
  const period2 = Math.floor(date.getTime() / 1000) + 86400 * 2; // 2 days forward buffer
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`,
      { signal: AbortSignal.timeout(7000), headers: YAHOO_HEADERS }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as (number | null)[] | undefined;
    if (!closes) return null;
    // Return the last valid close in the window — closest trading day at or before targetDate
    return [...closes].reverse().find(v => v != null) ?? null;
  } catch { return null; }
}

// ── FTSE monthly return aligned to MESI unit value dates ─────────────────────
//
// Fetches FTSE 100 and FTSE 250 prices on the same two dates used for the MESI
// monthly return so the comparison is apples-to-apples.

interface FtseAligned {
  ftse100From:    number | null;
  ftse100To:      number | null;
  ftse250From:    number | null;
  ftse250To:      number | null;
  fromDate:       string;
  toDate:         string;
}

async function fetchFtseAligned(fromDate: string, toDate: string): Promise<FtseAligned> {
  const [ftse100From, ftse100To, ftse250From, ftse250To] = await Promise.all([
    fetchFtseOnDate('^FTSE', fromDate),
    fetchFtseOnDate('^FTSE', toDate),
    fetchFtseOnDate('^FTMC', fromDate),
    fetchFtseOnDate('^FTMC', toDate),
  ]);
  return { ftse100From, ftse100To, ftse250From, ftse250To, fromDate, toDate };
}

// ── FTSE YTD return via Yahoo Finance ─────────────────────────────────────────
//
// Fetches daily closes from Jan 1 of the current year to today.
// YTD return = (latest close − first close) / first close × 100

async function fetchFtseYtd(): Promise<{ ftse100Ytd: number | null; ftse250Ytd: number | null }> {
  const period1 = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  async function getYtd(ticker: string): Promise<number | null> {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`,
        { signal: AbortSignal.timeout(7000), headers: YAHOO_HEADERS }
      );
      if (!res.ok) return null;
      const json = await res.json();
      const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as (number | null)[] | undefined;
      if (!closes || closes.length < 2) return null;
      const first = closes.find(v => v != null);
      const last  = [...closes].reverse().find(v => v != null);
      if (first == null || last == null) return null;
      return parseFloat(((last - first) / first * 100).toFixed(2));
    } catch { return null; }
  }

  const [ftse100Ytd, ftse250Ytd] = await Promise.all([getYtd('^FTSE'), getYtd('^FTMC')]);
  return { ftse100Ytd, ftse250Ytd };
}

// ── Investegate RNS fetch (single daily-page pass → three output streams) ────
//
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

const TICKER_RE   = /\/announcement\/[a-z]+\/[^\/]+--([a-z0-9.]+)\/([^\/]+)\//i;
const ANN_LINK_RE = /<a[^>]*class="announcement-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
const SUMMARY_RE  = /<div[^>]*id="collapseSummary"[^>]*>([\s\S]*?)<p[^>]*id="summary-disclaimer"/i;

// ── Headline classifiers ───────────────────────────────────────────────────────

// Director/PDMR personal share purchases or sales
const DIRECTOR_KW = [
  'director/pdmr shareholding', 'pdmr shareholding', 'director shareholding',
  'director dealing', 'director purchase', 'director sale', 'pdmr dealing',
];

// Material corporate events — always worth fetching the full AI summary
const MATERIAL_KW: { kw: string; category: string }[] = [
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
  // Guidance & warnings
  { kw: 'trading update',         category: 'Trading Update' },
  { kw: 'trading statement',      category: 'Trading Update' },
  { kw: 'profit warning',         category: 'Profit Warning' },
  { kw: 'revenue update',         category: 'Trading Update' },
  { kw: 'business update',        category: 'Trading Update' },
  // Corporate actions
  { kw: 'acquisition',            category: 'Acquisition/Disposal' },
  { kw: 'disposal',               category: 'Acquisition/Disposal' },
  { kw: 'merger',                 category: 'Acquisition/Disposal' },
  { kw: 'recommended offer',      category: 'Acquisition/Disposal' },
  { kw: 'recommended cash offer', category: 'Acquisition/Disposal' },
  { kw: 'firm offer',             category: 'Acquisition/Disposal' },
  // Capital
  { kw: 'placing',                category: 'Capital Raise' },
  { kw: 'rights issue',           category: 'Capital Raise' },
  { kw: 'capital raise',          category: 'Capital Raise' },
  { kw: 'share issuance',         category: 'Capital Raise' },
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

interface RnsItem { date: string; ticker: string; headline: string; url: string; }

// ── Shared daily-page fetcher ─────────────────────────────────────────────────

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
        // Stop if there's no next-page link beyond the current page number
        const maxPage = Math.max(...[...html.matchAll(/[?&]page=(\d+)/gi)].map(m => parseInt(m[1], 10)), 0);
        if (maxPage < p + 1) break;
      } catch { break; }
    }
    return pages;
  }

  // Batch dates in groups of 5 to avoid overwhelming Investegate with concurrent connections
  const BATCH = 5;
  const out: { date: string; html: string }[] = [];
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = await Promise.allSettled(dates.slice(i, i + BATCH).map(fetchAllPagesForDate));
    out.push(...batch.flatMap(r => r.status === 'fulfilled' ? r.value : []));
  }
  return out;
}

// ── Summary extractor ─────────────────────────────────────────────────────────

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
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch { return null; }
}

// ── Main Investegate function ─────────────────────────────────────────────────

interface InvestegateData {
  rnsData:      string;
  directorData: string;
  materialData: string;
}

async function fetchAllInvestegateData(tickers: string[]): Promise<InvestegateData> {
  const empty = {
    rnsData:      '[No RNS data — no tickers provided]',
    directorData: '[No director dealings data]',
    materialData: '[No material announcements data]',
  };
  if (tickers.length === 0) return empty;

  // Investegate URLs use bare tickers (e.g. "cwr") — strip exchange suffixes (.L, .AX, etc.)
  const tickerSet = new Set(tickers.map(t => t.toUpperCase().replace(/[^A-Z0-9.]/g, '').replace(/\.[A-Z]{1,2}$/, '')));
  const dates = buildTradingDates(30);
  const pages = await fetchDailyPages(dates);
  console.log(`[investegate] Fetched ${pages.length}/${dates.length} daily pages. Tickers: ${[...tickerSet].join(',')}`);
  if (pages.length > 0) {
    const sampleLinks = (pages[0].html.match(ANN_LINK_RE) ?? []).slice(0, 3);
    console.log('[investegate] Sample announcement links from first page:', sampleLinks);
  }

  // Single pass: classify every portfolio hit
  const allHits:      RnsItem[] = [];
  const directorHits: RnsItem[] = [];
  const materialHits: (RnsItem & { category: string })[] = [];

  for (const { date, html } of pages) {
    let m: RegExpExecArray | null;
    ANN_LINK_RE.lastIndex = 0;
    while ((m = ANN_LINK_RE.exec(html)) !== null) {
      const rawUrl   = m[1];
      const url      = rawUrl.startsWith('http') ? rawUrl : `https://www.investegate.co.uk${rawUrl}`;
      const headline = m[2].trim();
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

  console.log(`[investegate] allHits: ${allHits.length}, director: ${directorHits.length}, material: ${materialHits.length}`);
  if (allHits.length > 0) console.log('[investegate] First hit:', JSON.stringify(allHits[0]));

  // Fetch summaries for director + material hits in parallel (cap each at 20)
  const [directorSummaries, materialSummaries] = await Promise.all([
    Promise.allSettled(
      directorHits.slice(0, 20).map(item =>
        fetchAnnouncementSummary(item.url).then(s => ({ ...item, summary: s }))
      )
    ),
    Promise.allSettled(
      materialHits.slice(0, 20).map(item =>
        fetchAnnouncementSummary(item.url).then(s => ({ ...item, summary: s }))
      )
    ),
  ]);

  // ── Format: all RNS index ──────────────────────────────────────────────────
  const rnsLines: string[] = ['=== Investegate RNS index (last 45 trading days, portfolio holdings) ===\n'];
  if (allHits.length === 0) {
    rnsLines.push('[No announcements found for portfolio tickers in this period]');
  } else {
    allHits.sort((a, b) => b.date.localeCompare(a.date));
    const byTicker: Record<string, RnsItem[]> = {};
    for (const h of allHits) (byTicker[h.ticker] ??= []).push(h);
    for (const [ticker, items] of Object.entries(byTicker).sort()) {
      rnsLines.push(`${ticker} (${items.length}):`);
      for (const item of items) rnsLines.push(`  ${item.date}  ${item.headline}`);
      rnsLines.push('');
    }
  }

  // ── Format: director dealings ──────────────────────────────────────────────
  const dirLines: string[] = ['=== Director/PDMR Dealings (last 45 trading days, live summaries from Investegate) ===\n'];
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

  // ── Format: material announcements ────────────────────────────────────────
  const matLines: string[] = ['=== Material RNS Announcements (last 45 trading days, live summaries from Investegate) ===\n'];
  const matFulfilled = materialSummaries.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  if (matFulfilled.length === 0) {
    matLines.push('[No material announcements (results, trading updates, acquisitions, etc.) found for portfolio holdings in this period]');
  } else {
    // Group by category for readability
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

// ── JustETF server-side fetch ──────────────────────────────────────────────────
//
// Both pages serve full table data in static HTML (Angular SSR).
// Row text format after stripping tags:
//   [AssetClass] [Region] [Sector?] [IndexName] [YTD%] [1M%] [3M%] [1Y%] [3Y%] [N ETF(s)]
// We parse each row by matching the trailing numeric tokens, leaving everything
// before the first percentage as the theme description.

interface EtfRow {
  rank:  number;
  theme: string;
  ytd:   string;
  m1:    string;
  m3:    string;
  y1:    string;
  y3:    string;
  count: string;
}

// Trailing pattern: pct pct pct pct pct  "N ETF(s)"
const ROW_RE = /^(.*?)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+(\d+\s+ETFs?)$/;

function parseEtfRows(html: string): EtfRow[] {
  const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rows: EtfRow[] = [];
  let rank = 0;
  for (const tr of trMatches) {
    const text = tr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const m = ROW_RE.exec(text);
    if (!m) continue;
    rank++;
    rows.push({
      rank,
      theme: m[1].trim(),
      ytd:   m[2],
      m1:    m[3],
      m3:    m[4],
      y1:    m[5],
      y3:    m[6],
      count: m[7],
    });
  }
  return rows;
}

function formatEtfTable(label: string, rows: EtfRow[]): string {
  if (rows.length === 0) return `${label}: no data parsed`;
  const header = 'Rank | Theme / Index                                                      | YTD    | 1M     | 3M     | 1Y     | 3Y     | ETFs';
  const sep    = '-----|--------------------------------------------------------------------|--------|--------|--------|--------|--------|------';
  const lines  = rows.map(r =>
    `${String(r.rank).padStart(4)} | ${r.theme.substring(0, 66).padEnd(66)} | ${r.ytd.padStart(6)} | ${r.m1.padStart(6)} | ${r.m3.padStart(6)} | ${r.y1.padStart(6)} | ${r.y3.padStart(6)} | ${r.count}`
  );
  return [label, header, sep, ...lines].join('\n');
}

async function fetchJustEtf(): Promise<string> {
  const pages = [
    { url: 'https://www.justetf.com/uk/market-overview/the-best-etfs.html',        label: '=== JustETF: Best ETFs (all categories, ranked by YTD) ===' },
    { url: 'https://www.justetf.com/uk/market-overview/the-best-sector-etfs.html', label: '=== JustETF: Best Sector ETFs (ranked by YTD) ===' },
  ];
  const results: string[] = [];

  for (const { url, label } of pages) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const rows = parseEtfRows(html);
      if (rows.length > 0) {
        results.push(formatEtfTable(label, rows));
      }
    } catch { /* ignore network errors — AI falls back to training knowledge */ }
  }

  return results.length > 0
    ? results.join('\n\n')
    : '[JustETF data unavailable — use training knowledge of current ETF flow themes for the report month]';
}

// ── Portfolio news via RSS (Google News + FT) ────────────────────────────────
//
// Searches Google News RSS and FT RSS for each portfolio company name.
// Both feeds are public and require no API key.
// Bloomberg shut down public RSS in 2019; Google News aggregates Bloomberg
// stories alongside FT, Reuters and others, so it serves as the proxy.
//
// XML is parsed inline with regex — no rss-parser dependency needed.
// Results are capped at 3 articles per company to keep the prompt concise.
//
// SUPABASE NOTE: This feature also uses the monthly_reports.user_articles
// TEXT column for member-submitted articles. Run this migration if not done:
//   ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS user_articles TEXT;

interface NewsItem {
  company: string;
  title:   string;
  source:  string;
  date:    string;
}

function parseRssItems(xml: string, fallbackSource: string): { title: string; source: string; date: string }[] {
  const out: { title: string; source: string; date: string }[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const block of blocks.slice(0, 5)) {
    // Title — may be CDATA-wrapped or plain
    const rawTitle = (
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
    ).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

    // pubDate
    const raw = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
    let date = 'recent';
    try { if (raw) date = new Date(raw).toISOString().slice(0, 10); } catch { /* keep 'recent' */ }

    // Google News RSS embeds the source at the end of the title as " - Source Name".
    // Extract it so we show "Financial Times" rather than the generic fallback.
    let title  = rawTitle;
    let source = fallbackSource;
    const xmlSource = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim();
    if (xmlSource) {
      source = xmlSource;
    } else {
      // Google News format: "Headline text - Source Name"
      const dashIdx = rawTitle.lastIndexOf(' - ');
      if (dashIdx !== -1) {
        title  = rawTitle.slice(0, dashIdx).trim();
        source = rawTitle.slice(dashIdx + 3).trim();
      }
    }

    if (title.length > 8) out.push({ title, source, date });
  }
  return out;
}

const RSS_HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, text/xml' };

async function fetchCompanyNews(companyName: string): Promise<NewsItem[]> {
  // Single Google News RSS search per company.
  // Google News embeds the real publisher name in the title as "Headline - Source Name"
  // so source attribution is reliable without site: filtering.
  // Two queries: exact company name + broader name (first two words) to catch
  // articles that abbreviate the company name.
  const q1   = encodeURIComponent(`"${companyName}"`);
  const name2words = companyName.split(/\s+/).slice(0, 2).join(' ');
  const q2   = encodeURIComponent(name2words);
  const tail = '&hl=en-GB&gl=GB&ceid=GB:en';
  const base = 'https://news.google.com/rss/search?q=';

  const [res1, res2, res3] = await Promise.allSettled([
    fetch(`${base}${q1}${tail}`,                      { headers: RSS_HEADERS, signal: AbortSignal.timeout(8000) }),
    fetch(`${base}${q2}${tail}`,                      { headers: RSS_HEADERS, signal: AbortSignal.timeout(8000) }),
    fetch(`${base}${q1}+site%3Abloomberg.com${tail}`, { headers: RSS_HEADERS, signal: AbortSignal.timeout(8000) }),
  ]);

  const seen  = new Set<string>();
  const items: NewsItem[] = [];

  const add = (parsed: ReturnType<typeof parseRssItems>) => {
    for (const p of parsed) {
      const key = p.title.toLowerCase().slice(0, 40);
      if (!seen.has(key)) { seen.add(key); items.push({ company: companyName, ...p }); }
    }
  };

  if (res1.status === 'fulfilled' && res1.value.ok)
    add(parseRssItems(await res1.value.text(), 'News'));
  if (res2.status === 'fulfilled' && res2.value.ok)
    add(parseRssItems(await res2.value.text(), 'News'));
  if (res3.status === 'fulfilled' && res3.value.ok)
    add(parseRssItems(await res3.value.text(), 'News'));

  // Real FT/Bloomberg journalism floats to the top; company announcement feeds sink to bottom
  const isPremium = (s: string) => s === 'Financial Times' || s.toLowerCase().includes('bloomberg');
  const isDemoted = (s: string) => /co\.?\s*announcement|regulatory|filing/i.test(s);
  const priority  = items.filter(i => isPremium(i.source));
  const demoted   = items.filter(i => !isPremium(i.source) && isDemoted(i.source));
  const middle    = items.filter(i => !isPremium(i.source) && !isDemoted(i.source));
  return [...priority, ...middle, ...demoted].slice(0, 5); // max 5 per company
}

async function fetchPortfolioNews(positions: Position[]): Promise<string> {
  if (positions.length === 0) return '[No portfolio news — no positions]';

  // Batch in groups of 3 to be polite to Google News
  const all: NewsItem[] = [];
  const BATCH = 3;
  for (let i = 0; i < positions.length; i += BATCH) {
    const batch = positions.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(p => fetchCompanyNews(p.name)));
    for (const r of settled) if (r.status === 'fulfilled') all.push(...r.value);
  }

  if (all.length === 0)
    return '[No press news found — RSS feeds returned no results or were unavailable]';

  // Group by company
  const byCompany: Record<string, NewsItem[]> = {};
  for (const item of all) (byCompany[item.company] ??= []).push(item);

  const lines: string[] = ['=== Press Coverage (Google News RSS + FT RSS, portfolio companies) ===\n'];
  for (const [company, news] of Object.entries(byCompany)) {
    lines.push(`${company.toUpperCase()} (${news.length}):`);
    for (const n of news) lines.push(`  ${n.date} | ${n.source} | ${n.title}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Prompt builders ────────────────────────────────────────────────────────────

function buildPortfolioJSON(
  positions: Position[],
  monthlyPerf: Record<string, MonthlyPerfEntry>
): string {
  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
  const items = positions.map(p => {
    const mp = monthlyPerf[p.ticker];
    return {
      company:                p.name,
      ticker:                 p.ticker,
      sector:                 p.sector,
      weighting:              totalValue > 0 ? parseFloat((p.currentValue / totalValue * 100).toFixed(2)) : 0,
      purchase_price:         parseFloat(p.avgCost.toFixed(4)),
      current_price:          parseFloat(p.currentPrice.toFixed(4)),
      month_start_price:      mp ? parseFloat(mp.monthStart.toFixed(4)) : null,
      index_membership:       '[determine from your knowledge — FTSE100 / FTSE250 / AIM]',
      revenue_geographic_mix: '[determine from your knowledge — Global / Domestic / Mixed]',
      dividend_yield:         '[determine from your knowledge]',
      market_cap_millions:    '[determine from your knowledge]',
      monthly_change_pct:     mp ? parseFloat(mp.changePercent.toFixed(2)) : null,
      unrealised_pnl_pct:     parseFloat(p.pnlPercent.toFixed(2)),
      current_value_gbp:      parseFloat(p.currentValue.toFixed(2)),
    };
  });
  return JSON.stringify(items, null, 2);
}

function buildUnitValueStats(unitValues: UnitValue[]): string {
  const sorted = [...unitValues].sort(
    (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
  );
  const latest    = sorted.at(-1);
  const prev      = sorted.at(-2);
  const inception = sorted[0];

  const monthlyReturn = latest && prev
    ? ((latest.unit_value - prev.unit_value) / prev.unit_value * 100).toFixed(2)
    : 'N/A';

  const inceptionReturn = latest && inception
    ? ((latest.unit_value - inception.unit_value) / inception.unit_value * 100).toFixed(2)
    : 'N/A';

  // YTD: compare latest unit value to the last valuation of the previous calendar year
  const currentYear = new Date().getFullYear();
  const prevYearEnd = [...sorted].reverse().find(
    v => new Date(v.valuation_date).getFullYear() < currentYear
  );
  const ytdBase = prevYearEnd ?? (latest !== inception ? inception : null);
  const ytdReturn = latest && ytdBase
    ? ((latest.unit_value - ytdBase.unit_value) / ytdBase.unit_value * 100).toFixed(2)
    : 'N/A';

  return JSON.stringify({
    latest_unit_value:         latest?.unit_value,
    latest_date:               latest?.valuation_date,
    monthly_return_pct:        monthlyReturn,
    monthly_measured_from:     prev?.valuation_date ?? 'N/A',
    monthly_measured_to:       latest?.valuation_date ?? 'N/A',
    ytd_return_pct:            ytdReturn,
    ytd_measured_from:         ytdBase?.valuation_date ?? 'N/A',
    ytd_measured_to:           latest?.valuation_date ?? 'N/A',
    inception_return_pct:      inceptionReturn,
    inception_date:            inception?.valuation_date,
    note: 'monthly_return_pct and ytd_return_pct are AUTHORITATIVE — calculated from club unit values in Supabase. Use these figures in the Section 4 headline performance table. Show the measured_from and measured_to dates alongside each figure so readers can see the exact window. The per-stock monthly_change_pct values in PORTFOLIO are for the stock-by-stock dropdown detail only.',
  }, null, 2);
}

function buildMacroJSON(
  macro:       Awaited<ReturnType<typeof fetchMacroData>>,
  boe:         BoeMacro,
  ftseYtd:     { ftse100Ytd: number | null; ftse250Ytd: number | null },
  ftseAligned: FtseAligned,
  reportMonth: string
): string {
  // Monthly returns measured over the exact same date window as MESI unit values
  const ftse100Monthly = ftseAligned.ftse100From && ftseAligned.ftse100To
    ? ((ftseAligned.ftse100To - ftseAligned.ftse100From) / ftseAligned.ftse100From * 100).toFixed(2)
    : null;
  const ftse250Monthly = ftseAligned.ftse250From && ftseAligned.ftse250To
    ? ((ftseAligned.ftse250To - ftseAligned.ftse250From) / ftseAligned.ftse250From * 100).toFixed(2)
    : null;

  const alignedWindow = `${ftseAligned.fromDate} to ${ftseAligned.toDate} — same window as MESI monthly return`;

  const ftse100MonthlyLabel = ftse100Monthly !== null
    ? `${ftse100Monthly}% (${alignedWindow})`
    : '[DATA NEEDED — use your knowledge]';
  const ftse250MonthlyLabel = ftse250Monthly !== null
    ? `${ftse250Monthly}% (${alignedWindow})`
    : '[DATA NEEDED — use your knowledge]';

  const ytdFromDate = `${new Date().getFullYear()}-01-01`;
  const ytdToDate   = new Date().toISOString().slice(0, 10);

  const ftse100YtdLabel = ftseYtd.ftse100Ytd !== null
    ? `${ftseYtd.ftse100Ytd}% (${ytdFromDate} to ${ytdToDate}, Yahoo Finance daily closes)`
    : '[DATA NEEDED — use your knowledge]';

  const ftse250YtdLabel = ftseYtd.ftse250Ytd !== null
    ? `${ftseYtd.ftse250Ytd}% (${ytdFromDate} to ${ytdToDate}, Yahoo Finance daily closes)`
    : '[DATA NEEDED — use your knowledge]';

  const cpiLabel = boe.ukCpi !== null
    ? `${boe.ukCpi}% (${boe.ukCpiDate ?? 'recent'}, CPI annual rate, ONS)`
    : '[DATA NEEDED]';

  const gdpLabel = boe.ukGdpQoQ !== null
    ? `${boe.ukGdpQoQ}% (${boe.ukGdpDate ?? 'recent'}, Q/Q GDP growth, ONS)`
    : '[DATA NEEDED — use your knowledge for report month]';

  return JSON.stringify({
    report_month:                    reportMonth,
    gbp_usd:                         macro.gbpUsd  ?? '[DATA NEEDED]',
    gbp_eur:                         macro.gbpEur  ?? '[DATA NEEDED]',
    oil_price_brent:                 macro.brent   ?? '[DATA NEEDED]',
    gold_price_usd:                  macro.gold    ?? '[DATA NEEDED]',
    ftse100_current:                 macro.ftse100 ?? '[DATA NEEDED]',
    ftse250_current:                 macro.ftse250 ?? '[DATA NEEDED]',
    ftse100_monthly_return_pct:      ftse100MonthlyLabel,
    ftse250_monthly_return_pct:      ftse250MonthlyLabel,
    ftse100_ytd_return_pct:          ftse100YtdLabel,
    ftse250_ytd_return_pct:          ftse250YtdLabel,
    bank_of_england_base_rate:       boe.bankRate        ?? '[DATA NEEDED]',
    gilt_yield_10yr:                 boe.giltYield10yr   ?? '[DATA NEEDED]',
    uk_cpi_latest:                   cpiLabel,
    uk_gdp_quarterly_growth:         gdpLabel,
    boe_rate_cuts_expected_next_12m: '[use your knowledge for report month]',
    uk_takeover_activity_index:      '[use your knowledge for report month]',
  }, null, 2);
}

// ── Shared style + tone block (included in both prompt parts) ────────────────

const STYLE_BLOCK =
  'STYLE: Dark theme. Background #111827, cards #1f2937, border #374151, text #e5e7eb, ' +
  'green #10b981, amber #f59e0b, red #ef4444. Font: Inter (Google Fonts). Cards with rounded corners and subtle shadow. ' +
  'Every top-level section must be wrapped in <div class="section">. ' +
  'Use <details><summary> tags for all expandable sections with summary text "📖 Read more — [topic]" (book emoji, em dash). ' +
  'Traffic light emojis in tables. Output only the HTML. ' +
  'NEVER use markdown syntax in the output — no **bold**, no ##headings, no bullet hyphens. Use HTML tags only (<strong>, <h3>, <ul> etc.).\n\n' +
  'TONE: Friendly knowledgeable friend, not City broker. Plain English. Jargon explained inline. ' +
  'Four threads throughout: (1) large/mid-cap gap (2) M&A landscape (3) macro backdrop (4) ETF flow alignment. Forward views = opinion not advice.';

// ── Part 1 prompt: Contents list + sections 1–3 (Market Overview) ─────────────
//
// Part One of the report: macro big picture, ETF flows, and outlook.

function buildPart1Message(
  portfolioJSON: string,
  macroJSON: string,
  etfData: string,
  reportMonth: string,
  currentDate: string,
): string {
  const sections = [
    'CONTENTS LIST — Before any sections, render a compact styled dark-theme contents panel. ' +
    'Show two parts clearly:\n' +
    '  PART ONE: MARKET OVERVIEW — 1. The Big Picture  2. ETF Flow Signal  3. Outlook\n' +
    '  PART TWO: CLUB ASSETS & THE MARKET — 4. Press Coverage  5. Portfolio vs Market  6. Sector Scorecard & Theme Tracker  7. Income Corner  8. Results & Corporate Actions  9. One to Watch\n' +
    'Style as a card with two clearly labelled rows. No anchor links needed — plain text is fine.',

    '1. THE BIG PICTURE — Macro tile row (GDP, CPI, GBP/USD, 10yr Gilt, Brent, Gold). 3–4 sentence macro summary. FTSE 100 vs FTSE 250 YTD banner with gap analysis.',

    '2. ETF FLOW SIGNAL — Top 10 ETF themes table (Rank|Theme|Category|YTD|Signal: >40% VERY HOT, 20–40% HOT, 10–20% WARM, <10% COOL). Absent themes. Portfolio alignment table + FLOW ALIGNMENT SCORE badge. Stealth themes note. Dropdown: methodology.',

    '3. OUTLOOK — Month ahead: 3–4 sentences + weather symbol 64px. Year ahead: 4–5 sentences + weather symbol. Dropdown: 3 upside surprises, 3 downside risks, mid-cap case, M&A outlook, ETF flow analogues.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 1 of 3 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (Yahoo Finance prices pre-fetched; other fields use your knowledge):\n' + macroJSON + '\n\n' +
    'ETF FLOW DATA (use below if present, otherwise use your knowledge):\n' + cap(etfData, 6000) + '\n\n' +
    'Use your training knowledge for macro figures not provided above. Use [DATA NEEDED] where genuinely uncertain.\n\n' +
    'OUTPUT: Begin with <div id="monthly-report">. Output the Contents List then sections 1–3 only. ' +
    'Do NOT add a footer or closing </div> — parts 2 and 3 follow immediately. No preamble. Output only the HTML.\n\n' +
    STYLE_BLOCK + '\n\n' +
    'SECTIONS (write Contents List then all 3 sections):\n\n' + sections
  );
}

// ── Part 2 prompt: sections 4–5 (Press Coverage + Portfolio vs Market) ────────
//
// Opens Part Two of the report. Has press news, unit value performance, and
// stock-by-stock detail from material RNS.

function buildPart2Message(
  portfolioJSON: string,
  macroJSON: string,
  unitValueStats: string,
  materialData: string,
  pressNews: string,
  userArticles: string,
  reportMonth: string,
  currentDate: string,
  perfMonth: string,
  indexMtdWindow: string,
): string {
  const memberBlock = userArticles?.trim()
    ? 'MEMBER READING LIST (articles shared by club members — format: [Contributor Name] "Title" then body; feature these prominently in section 4):\n' + userArticles + '\n\n'
    : '';

  const sections = [
    'PART TWO DIVIDER — Before section 4, render a prominent full-width section divider card ' +
    'labelled "PART TWO: CLUB ASSETS & THE MARKET" with a short subtitle "How our holdings relate to current market conditions." ' +
    'Style it as a dark card with an emerald accent border.',

    '4. PRESS COVERAGE — Use the PRESS NEWS data and MEMBER READING LIST below. ' +
    'Table: Date | Ticker | Company | Headline | Source | Impact (Positive / Negative / Neutral). ' +
    'Select the 10–15 most significant stories; prioritise FT and Bloomberg sources. ' +
    'If MEMBER READING LIST articles are present, render them in a separate highlighted card titled "Members\' Reading List" ' +
    'immediately below the main table, with a short 2-sentence note on why each article is relevant to the portfolio. ' +
    'Dropdown: one paragraph analysis per key article explaining what it means for the holding.',

    '5. PORTFOLIO vs MARKET — All output must be valid HTML only. Never use markdown.\n\n' +
    'A) PERFORMANCE TABLE — wrap in <div style="margin-bottom:24px">. ' +
    'Rows: MESI Portfolio / FTSE 100 / FTSE 250. Columns: "Month - ' + perfMonth + '" / YTD. ' +
    'Under the Month column header render a <div style="font-size:11px;color:#6b7280;font-weight:normal;margin-top:2px"> showing the date window from FUND PERFORMANCE. ' +
    'MESI row uses monthly_return_pct and ytd_return_pct from FUND PERFORMANCE. FTSE rows use MACRO figures.\n\n' +
    'B) AMBER NOTICE — immediately after the table render: <div class="notice-amber">One sentence on the unit-value lag. One sentence pointing to the Holdings page.</div>\n\n' +
    'C) INDEX BREAKDOWN — render <h3>Index Membership Breakdown</h3> then immediately below it render a <p style="font-size:12px;color:#6b7280;margin-bottom:16px"> containing the exact text "Month to date: ' + indexMtdWindow + '" so readers see the window these per-stock figures cover (sourced from PORTFOLIO monthly_change_pct, which is measured from the 1st of the current calendar month to today — NOT the fund-performance window used in the table above). Then one short intro sentence in a <p>.\n' +
    'Then for each index group (FTSE 100 / FTSE 250 / AIM / other) render one card using EXACTLY this class structure:\n' +
    '<div class="index-card">\n' +
    '  <div class="index-card-header">\n' +
    '    <span class="index-card-title">FTSE 100</span>\n' +
    '    <span class="index-card-badge">4 holdings</span>\n' +
    '  </div>\n' +
    '  <div class="index-card-pct pct-pos">+10.2%</div>\n' +
    '  <div class="index-card-label">Avg. monthly change</div>\n' +
    '  <div class="index-card-holdings">BAE Systems, Rolls-Royce, RELX, Lloyds</div>\n' +
    '  <div class="index-card-note">One sentence on what drove this group and any outliers.</div>\n' +
    '</div>\n' +
    'Use class "pct-pos" for positive, "pct-neg" for negative. Cards stacked vertically. Do not use a flex row.\n\n' +
    'D) DROPDOWN — <details> with stock-by-stock contribution table (Ticker | Company | Monthly Change | Contribution | Notes), sorted best to worst.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 2 of 3 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO:\n' + portfolioJSON + '\n\n' +
    'FUND PERFORMANCE:\n' + unitValueStats + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'MATERIAL RNS (results, trading updates, acquisitions, capital raises, board changes — live AI summaries from Investegate):\n' + cap(materialData, 6000) + '\n\n' +
    'PRESS NEWS (Google News RSS, searched by portfolio company name — use for section 4):\n' + cap(pressNews, 6000) + '\n\n' +
    memberBlock +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output the Part Two divider then sections 4–5 only. Do NOT add a footer or closing </div> — part 3 follows immediately. No preamble. Output only the HTML.\n\n' +
    STYLE_BLOCK + '\n\n' +
    'SECTIONS (write Part Two divider then sections 4 and 5):\n\n' + sections
  );
}

// ── Part 3 prompt: sections 6–9 + footer ──────────────────────────────────────
//
// Closes the report. Merged Sector Scorecard & Theme Tracker, Income Corner,
// Director Dealings, One to Watch. Closes the report div.

function buildPart3Message(
  portfolioJSON: string,
  macroJSON: string,
  etfData: string,
  rnsData: string,
  materialData: string,
  dividendData: string,
  directorData: string,
  reportMonth: string,
  currentDate: string,
): string {
  const sections = [
    '6. SECTOR SCORECARD & THEME TRACKER — Merged section combining sector performance with theme analysis. ' +
    'Backward table (Sector|Holdings|Market move|Our move|ETF Flow). FTSE100 vs FTSE250 deep dive. ' +
    'Forward compass (Sector|View|Rationale|ETF Signal|Key Risk). ' +
    'Then a Theme table: Theme|Direction|Strength|ETF Signal|Portfolio Impact — cover: Energy, Gold/Metals, Nuclear, M&A, Dividends, BOE Rates, Defence, Rare Earths, Activism, Labour Risk, AI, Foreign Buyers, Sterling, Clean Energy. ' +
    'Dropdown: bull/bear case 3 points each per sector, and detail on each theme.',

    '7. INCOME CORNER — Use the DIVIDEND DATA provided (ex-div dates + amounts from Yahoo Finance; the Payment Date column has been pre-extracted from RNS Dividend announcement summaries and matched to each ex-div row by pence amount). ' +
    'Table: Ticker | Company | Ex-Div Date | Payment Date | Amount (p) | Annual Yield est. | Vs FTSE100 avg. ' +
    'Populate Payment Date directly from the Payment Date column in DIVIDEND DATA. If that column shows "—" for a row, leave the Payment Date cell blank — do NOT infer or guess from other sources. ' +
    'Show all holdings with dividend data sorted by ex-div date (most recent first). ' +
    'Call out dividends paid this month, upcoming ex-div dates in next 30 days, any cuts or increases vs prior year, and buybacks. ' +
    'Compare portfolio income yield to FTSE100 benchmark: ~3.5% dividend yield / ~6.5% total cash yield. ' +
    'Dropdown: dividend history per holding.',

    '8. RESULTS & CORPORATE ACTIONS — Two sub-sections in one card.\n' +
    'Sub-section A — Results & Corporate Actions: Use the MATERIAL RNS DATA provided. ' +
    'For each item: Ticker | Company | Category | Date | Key numbers from summary | Verdict (Beat/In-line/Miss/Transformative). ' +
    'Group by category. Dropdown: full summary per item. If no material announcements, say so.\n' +
    'Sub-section B — Director Dealings: Use the DIRECTOR DEALINGS DATA provided (live from Investegate). ' +
    'Table: Date | Ticker | Company | Director/Role | Buy/Sell | Shares | Price (p) | Value £ | Signal. ' +
    'If no dealings say so clearly. Interpret sentiment: buying = bullish insider signal, selling = neutral unless large % of holding. ' +
    'Dropdown: context on each dealing.',

    '9. ONE TO WATCH — One holding needing attention next month. 3–4 sentences. Index, theme, ETF flow context.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 3 of 3 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'ETF FLOW DATA (use for sector/theme analysis in section 6):\n' + cap(etfData, 4000) + '\n\n' +
    'RNS INDEX (all portfolio announcements, last 45 trading days — reference for sector/theme context):\n' + cap(rnsData, 2000) + '\n\n' +
    'MATERIAL RNS (results, trading updates, acquisitions, capital raises, board changes — PRIMARY SOURCE for section 8 Results & Corporate Actions, also reference for sector context):\n' + cap(materialData, 8000) + '\n\n' +
    'DIVIDEND DATA (live ex-dividend dates and amounts from Yahoo Finance — last 12 months per holding):\n' + cap(dividendData, 4000) + '\n\n' +
    'DIRECTOR DEALINGS (live from Investegate — last 45 trading days, portfolio holdings only, with AI summaries):\n' + cap(directorData, 5000) + '\n\n' +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output sections 6–9 only, then the footer paragraph, then close with </div>. No preamble. Output only the HTML.\n\n' +
    STYLE_BLOCK + '\n\n' +
    'FOOTER (after section 9): Before the footer text, render a full-width <hr> styled with border-color #374151 and margin 32px 0. Then render the footer as a small centered paragraph in text color #6b7280. Text: Report generated ' + currentDate +
    ' | Portfolio data: Club database | Market data: Investegate, Yahoo Finance UK, Bank of England, ONS' +
    ' | ETF flow data: JustETF (justetf.com/uk) | RNS, Results & Director Dealings: Investegate' +
    ' | Press coverage: Google News | This report is produced for club members only and does not constitute financial advice.\n\n' +
    'SECTIONS (write all 4, then footer, then </div>):\n\n' + sections
  );
}

// ── HTML fragment cleaner ─────────────────────────────────────────────────────
//
// Parts 2 and 3 should be plain HTML fragments, but DeepSeek sometimes wraps
// output in a full document (<html><head>...<body>). Strip those wrappers so
// concatenation produces valid HTML.

function cleanFragment(html: string): string {
  let out = html.trim();
  // Remove markdown code fences if present
  out = out.replace(/^```html\s*/i, '').replace(/\s*```$/, '');
  // If it's a full document, extract just the body content
  const bodyMatch = out.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  // Otherwise strip any stray document-level tags
  out = out.replace(/<!DOCTYPE[^>]*>/gi, '');
  out = out.replace(/<\/?html[^>]*>/gi, '');
  out = out.replace(/<head>[\s\S]*?<\/head>/gi, '');
  out = out.replace(/<\/?body[^>]*>/gi, '');
  return out.trim();
}

// ── Data truncator ────────────────────────────────────────────────────────────
//
// Prevents prompts from bloating when Investegate returns many announcements
// for a large portfolio. The data is reference material — completeness matters
// less than keeping the prompt well within DeepSeek's context window.

function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[... truncated for length — remaining entries omitted ...]';
}

// ── DeepSeek streaming call ───────────────────────────────────────────────────

async function callDeepSeek(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
      max_tokens: 8192,
      temperature: 0.7,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${errText}`);
  }

  let output = '';
  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const json    = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content;
        if (content) output += content;
      } catch { /* ignore malformed chunks */ }
    }
  }

  return output;
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json(
      { error: 'DEEPSEEK_API_KEY not configured. Add it to .env.local.' },
      { status: 500 }
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Derive the MESI monthly measurement dates from unit values so FTSE monthly
  // returns can be fetched for the exact same window — apples-to-apples comparison.
  const sortedUV   = [...body.unitValues].sort(
    (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
  );
  const mesiFromDate = sortedUV.at(-2)?.valuation_date ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const mesiToDate   = sortedUV.at(-1)?.valuation_date ?? new Date().toISOString().slice(0, 10);
  // Month name derived from measurement end date (e.g. "March"), not the current calendar month
  const perfMonth    = new Date(mesiToDate).toLocaleString('en-GB', { month: 'long' });

  // Per-stock monthly_change_pct (used by the Index Membership Breakdown cards) is sourced
  // from /api/monthly-performance which measures from the 1st of the current calendar month
  // to today — so the subtitle under that heading must reflect that window, not the fund's
  // unit-value measurement window.
  const [curYr, curMo, curDy] = body.currentDate.split('-').map(Number);
  const curMonthShort = new Date(curYr, curMo - 1, curDy).toLocaleString('en-GB', { month: 'short' });
  const indexMtdWindow = `1 – ${curDy} ${curMonthShort} ${curYr}`;

  // Fetch all external data in parallel
  // Note: fetchAllInvestegateData fetches the 30 daily Investegate pages ONCE
  // and splits results into rnsData / directorData / materialData in a single pass.
  const tickers = body.positions.map(p => p.ticker);
  const [macro, boe, etfData, investegate, rawDividendRows, ftseYtd, ftseAligned, pressNews] = await Promise.all([
    fetchMacroData(),
    fetchBoeMacro(),
    fetchJustEtf(),
    fetchAllInvestegateData(tickers),
    fetchDividendRows(body.positions),
    fetchFtseYtd(),
    fetchFtseAligned(mesiFromDate, mesiToDate),
    fetchPortfolioNews(body.positions),
  ]);
  const { rnsData, directorData, materialData } = investegate;

  // Merge Yahoo ex-div rows with payment dates scraped from RNS Dividend summaries
  const paymentDateMap = extractDividendPaymentDates(materialData);
  const dividendData   = formatDividendData(rawDividendRows, paymentDateMap);

  console.log('[monthly-brief] BoE macro:', JSON.stringify(boe));
  console.log('[monthly-brief] MESI monthly window:', mesiFromDate, '→', mesiToDate);
  console.log('[monthly-brief] FTSE aligned:', JSON.stringify(ftseAligned));
  console.log('[monthly-brief] RNS index preview:', rnsData.substring(0, 200));
  console.log('[monthly-brief] Material RNS preview:', materialData.substring(0, 300));
  console.log('[monthly-brief] Director dealings preview:', directorData.substring(0, 300));
  console.log(`[monthly-brief] RNS payment dates extracted for ${paymentDateMap.size} ticker(s)`);
  console.log('[monthly-brief] Dividend data preview:', dividendData.substring(0, 300));
  console.log('[monthly-brief] Press news preview:', pressNews.substring(0, 300));

  const portfolioJSON  = buildPortfolioJSON(body.positions, body.monthlyPerf);
  const unitValueStats = buildUnitValueStats(body.unitValues);
  const macroJSON      = buildMacroJSON(macro, boe, ftseYtd, ftseAligned, body.reportMonth);

  const systemPrompt =
    'You are a friendly but knowledgeable investment analyst writing a monthly performance report for a UK private investment club. ' +
    'Your tone is warm, engaging and accessible - think a knowledgeable friend explaining markets over a coffee, not a stuffy City broker. ' +
    'Use plain English. Explain jargon where used. Reserve detailed analysis for expandable drop-down sections so the page stays clean and readable. ' +
    'Where you express a forward view, be clear it is opinion not advice.';

  try {
    // Three sequential DeepSeek calls so none hits the 8192-token output cap.
    // Part 1: Contents list + sections 1–3 (Market Overview — macro, ETF flow, outlook)
    // Part 2: sections 4–5  (Press Coverage + Portfolio vs Market)
    // Part 3: sections 6–9 + footer + closing </div>  (Sector/Theme, Income, Director Dealings, One to Watch)
    // The three HTML fragments are concatenated before saving.

    const part1Message = buildPart1Message(
      portfolioJSON, macroJSON, etfData,
      body.reportMonth, body.currentDate,
    );
    const part2Message = buildPart2Message(
      portfolioJSON, macroJSON, unitValueStats, materialData,
      pressNews, body.userArticles ?? '',
      body.reportMonth, body.currentDate, perfMonth, indexMtdWindow,
    );
    const part3Message = buildPart3Message(
      portfolioJSON, macroJSON, etfData, rnsData, materialData,
      dividendData, directorData,
      body.reportMonth, body.currentDate,
    );

    console.log('[monthly-brief] Launching all 3 parts in parallel. Prompt lengths:', part1Message.length, part2Message.length, part3Message.length);

    const [part1Raw, part2Raw, part3Raw] = await Promise.all([
      callDeepSeek(systemPrompt, part1Message),
      callDeepSeek(systemPrompt, part2Message),
      callDeepSeek(systemPrompt, part3Message),
    ]);

    console.log('[monthly-brief] All parts done. Raw lengths:', part1Raw.length, part2Raw.length, part3Raw.length);

    if (!part1Raw.trim()) return Response.json({ error: 'No content generated (part 1).' }, { status: 500 });
    if (!part2Raw.trim()) return Response.json({ error: 'No content generated (part 2).' }, { status: 500 });
    if (!part3Raw.trim()) return Response.json({ error: 'No content generated (part 3).' }, { status: 500 });

    const part1Html = cleanFragment(part1Raw);
    const part2Html = cleanFragment(part2Raw);
    const part3Html = cleanFragment(part3Raw);

    console.log('[monthly-brief] Cleaned lengths:', part1Html.length, part2Html.length, part3Html.length);

    const htmlOutput = part1Html + '\n' + part2Html + '\n' + part3Html;

    if (!htmlOutput.trim()) {
      return Response.json({ error: 'No content generated.' }, { status: 500 });
    }

    // Wrap in a proper HTML document so all three fragments are rendered together.
    // Without this, if DeepSeek's Part 1 generates </html> the browser silently
    // drops everything that follows it (Parts 2 and 3).
    const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #111827 !important; color: #e5e7eb !important; font-family: 'Inter', sans-serif; padding: 24px; line-height: 1.6; }
  #monthly-report { background: #111827; }

  /* ── Section spacing ── */
  .section { margin-bottom: 48px; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; color: #e5e7eb !important; margin-bottom: 16px; }
  th { background: #374151 !important; color: #f9fafb !important; padding: 10px 14px; text-align: left; font-size: 13px; }
  td { background: #1f2937 !important; color: #e5e7eb !important; padding: 10px 14px; border-bottom: 1px solid #374151; font-size: 13px; }
  tr:hover td { background: #263548 !important; }

  /* ── Expandable dropdowns ── */
  details { background: #1f2937; border: 1px solid #374151; border-radius: 8px; margin-top: 12px; padding: 4px 12px; }
  summary { color: #10b981; cursor: pointer; padding: 8px 0; font-size: 13px; }

  /* ── Index membership cards ── */
  .index-card { background: #1f2937; border: 1px solid #374151; border-radius: 10px; padding: 18px 20px; margin-bottom: 12px; }
  .index-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .index-card-title { color: #f9fafb; font-size: 14px; font-weight: 600; }
  .index-card-badge { background: #374151; color: #9ca3af; font-size: 11px; padding: 2px 10px; border-radius: 9999px; }
  .index-card-pct { font-size: 28px; font-weight: 700; margin-bottom: 2px; }
  .index-card-label { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
  .index-card-holdings { font-size: 12px; color: #9ca3af; margin-bottom: 8px; }
  .index-card-note { font-size: 12px; color: #6b7280; line-height: 1.5; }
  .pct-pos { color: #10b981; }
  .pct-neg { color: #ef4444; }

  /* ── Amber notice ── */
  .notice-amber { background: #451a03; border: 1px solid #92400e; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; color: #fcd34d; line-height: 1.6; }

  /* ── General ── */
  a { color: #10b981; }
  h1, h2, h3, h4 { color: #f9fafb; margin-bottom: 12px; }
  p { margin-bottom: 10px; }
</style>
</head>
<body>
${htmlOutput}
</body>
</html>`;

    // Save to Supabase — check if a row already exists for this month, then update or insert.
    // This avoids relying on a unique constraint for onConflict which may not be set up.
    const { data: existing, error: selectError } = await supabase
      .from('monthly_reports')
      .select('id')
      .eq('report_month', body.reportMonth)
      .maybeSingle();

    if (selectError) {
      console.error('[monthly-brief] Failed to check existing report:', selectError.message);
    }

    const payload: Record<string, string> = {
      report_month: body.reportMonth,
      html: finalHtml,
      generated_at: new Date().toISOString(),
    };
    // Preserve user_articles if they were passed in (column must exist — see migration note above)
    if (body.userArticles !== undefined) payload.user_articles = body.userArticles;
    const { error: dbError } = existing
      ? await supabase.from('monthly_reports').update(payload).eq('report_month', body.reportMonth)
      : await supabase.from('monthly_reports').insert(payload);

    if (dbError) {
      console.error('[monthly-brief] Failed to save report:', dbError.message);
      return Response.json({ html: finalHtml, dbError: dbError.message });
    }

    return Response.json({ html: finalHtml });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `DeepSeek API error: ${message}` }, { status: 500 });
  }
}
