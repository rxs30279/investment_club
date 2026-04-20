import type { DividendEvent, DividendRow, FtseAligned, MacroData, Position } from '../monthly-brief/types';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

export async function fetchYahooPrice(ticker: string): Promise<number | null> {
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

// Uses the v8 chart endpoint with events=div to get the last 12 months of
// ex-dividend dates and amounts for each portfolio holding.
// UK stocks need a ".L" suffix on Yahoo Finance; we try that first.
export async function fetchDividendHistory(ticker: string): Promise<DividendEvent[]> {
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

export async function fetchDividendRows(positions: Position[]): Promise<DividendRow[]> {
  const results = await Promise.allSettled(
    positions.map(async p => ({
      ticker: p.ticker,
      name:   p.name,
      divs:   await fetchDividendHistory(p.ticker),
    }))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
}

// Payment dates are deliberately omitted — dividenddata.co.uk serves an empty
// HTML shell to Vercel's data-center IPs, so we can't source them reliably
// from a serverless environment.
export function formatDividendData(rows: DividendRow[]): string {
  const lines: string[] = [
    '=== Dividend history (ex-div dates + amounts from Yahoo Finance — last 12 months per holding) ===\n',
    'Ticker     | Company                        | Ex-Div Date | Amount (p)',
    '-----------|--------------------------------|-------------|------------',
  ];

  let anyData = false;
  for (const { ticker, name, divs } of rows) {
    if (divs.length === 0) {
      lines.push(`${ticker.padEnd(10)} | ${name.substring(0, 30).padEnd(30)} | No dividend data found`);
      continue;
    }
    anyData = true;
    for (const d of divs) {
      lines.push(
        `${ticker.padEnd(10)} | ${name.substring(0, 30).padEnd(30)} | ${d.date}  | ${d.amount.toFixed(4).padStart(10)}`
      );
    }
  }

  if (!anyData) return '[Dividend data unavailable — use your knowledge for dividend dates and yields]';
  return lines.join('\n');
}

export async function fetchMacroData(): Promise<MacroData> {
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

// Fetches a small daily window around the target date and returns the last
// valid close — this handles weekends/holidays where the exact date has no data.
async function fetchFtseOnDate(ticker: string, targetDate: string): Promise<number | null> {
  const date    = new Date(targetDate);
  const period1 = Math.floor(date.getTime() / 1000) - 86400 * 5;
  const period2 = Math.floor(date.getTime() / 1000) + 86400 * 2;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`,
      { signal: AbortSignal.timeout(7000), headers: YAHOO_HEADERS }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as (number | null)[] | undefined;
    if (!closes) return null;
    return [...closes].reverse().find(v => v != null) ?? null;
  } catch { return null; }
}

export async function fetchFtseAligned(fromDate: string, toDate: string): Promise<FtseAligned> {
  const [ftse100From, ftse100To, ftse250From, ftse250To] = await Promise.all([
    fetchFtseOnDate('^FTSE', fromDate),
    fetchFtseOnDate('^FTSE', toDate),
    fetchFtseOnDate('^FTMC', fromDate),
    fetchFtseOnDate('^FTMC', toDate),
  ]);
  return { ftse100From, ftse100To, ftse250From, ftse250To, fromDate, toDate };
}

export async function fetchFtseYtd(): Promise<{ ftse100Ytd: number | null; ftse250Ytd: number | null }> {
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
