import type { DividendEvent, DividendRow, FtseAll, FtseSeries, MacroData } from '../monthly-brief/types';

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

export async function fetchDividendRows(positions: { ticker: string; name: string }[]): Promise<DividendRow[]> {
  const results = await Promise.allSettled(
    positions.map(async p => ({
      ticker: p.ticker,
      name:   p.name,
      divs:   await fetchDividendHistory(p.ticker),
    }))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
}

// Holdings ordered by current value, dropping the long tail so per-holding
// rows don't get clipped mid-line by a downstream character cap.
export function formatDividendData(rows: DividendRow[], maxHoldings = 30): string {
  const lines: string[] = [
    '=== Dividend history (ex-div dates + amounts from Yahoo Finance — last 12 months per holding) ===\n',
    'Ticker     | Company                        | Ex-Div Date | Amount (p)',
    '-----------|--------------------------------|-------------|------------',
  ];

  const slice = rows.slice(0, maxHoldings);
  let anyData = false;
  for (const { ticker, name, divs } of slice) {
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
  if (rows.length > slice.length) {
    lines.push(`\n[${rows.length - slice.length} smaller holdings omitted for length]`);
  }

  if (!anyData) return '[Dividend data unavailable — use your knowledge for dividend dates and yields]';
  return lines.join('\n');
}

// One fetch per index covers current price, YTD %, and the MESI-aligned monthly
// window. Used to be three separate calls per index. Range covers from the
// earlier of (current year start, alignedFromDate) so we can extract any value
// needed from one response.
async function fetchFtseSeries(
  ticker: string,
  alignedFromDate: string,
  alignedToDate: string,
): Promise<FtseSeries> {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const fromTs    = Math.min(yearStart.getTime(), new Date(alignedFromDate).getTime()) - 86400_000 * 5;
  const toTs      = Math.max(Date.now(), new Date(alignedToDate).getTime())               + 86400_000 * 2;
  const period1   = Math.floor(fromTs / 1000);
  const period2   = Math.floor(toTs   / 1000);

  const ytdFromDate = yearStart.toISOString().slice(0, 10);
  const ytdToDate   = new Date().toISOString().slice(0, 10);

  const empty: FtseSeries = {
    current: null, ytdPct: null, ytdFromDate, ytdToDate,
    alignedFromVal: null, alignedToVal: null,
    alignedFromDate, alignedToDate,
  };

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`,
      { signal: AbortSignal.timeout(8000), headers: YAHOO_HEADERS }
    );
    if (!res.ok) return empty;
    const json   = await res.json();
    const result = json?.chart?.result?.[0];
    const tsArr     = result?.timestamp as number[] | undefined;
    const closesArr = result?.indicators?.quote?.[0]?.close as (number | null)[] | undefined;
    if (!tsArr || !closesArr || tsArr.length === 0) return empty;
    const ts: number[]          = tsArr;
    const closes: (number | null)[] = closesArr;

    function closeNear(targetIso: string, direction: 'forward' | 'backward'): number | null {
      const target = new Date(targetIso).getTime() / 1000;
      if (direction === 'forward') {
        // First close at or after target
        for (let i = 0; i < ts.length; i++) {
          if (ts[i] >= target && closes[i] != null) return closes[i]!;
        }
      } else {
        // Last close at or before target
        for (let i = ts.length - 1; i >= 0; i--) {
          if (ts[i] <= target && closes[i] != null) return closes[i]!;
        }
      }
      return null;
    }

    const current        = [...closes].reverse().find(c => c != null) ?? null;
    const ytdFromClose   = closeNear(ytdFromDate, 'forward');
    const ytdToClose     = closeNear(ytdToDate,   'backward');
    const alignedFromVal = closeNear(alignedFromDate, 'backward');
    const alignedToVal   = closeNear(alignedToDate,   'backward');

    const ytdPct = ytdFromClose != null && ytdToClose != null
      ? parseFloat(((ytdToClose - ytdFromClose) / ytdFromClose * 100).toFixed(2))
      : null;

    return {
      current, ytdPct, ytdFromDate, ytdToDate,
      alignedFromVal, alignedToVal,
      alignedFromDate, alignedToDate,
    };
  } catch { return empty; }
}

export async function fetchFtseAll(alignedFromDate: string, alignedToDate: string): Promise<FtseAll> {
  const [ftse100, ftse250] = await Promise.all([
    fetchFtseSeries('^FTSE', alignedFromDate, alignedToDate),
    fetchFtseSeries('^FTMC', alignedFromDate, alignedToDate),
  ]);
  return { ftse100, ftse250 };
}

// Macro now only fetches non-FTSE prices — FTSE values come from fetchFtseAll
// which is computed once from the YTD series.
export async function fetchMacroData(): Promise<MacroData> {
  const [gbpUsd, gbpEur, brent, gold] = await Promise.all([
    fetchYahooPrice('GBPUSD=X'),
    fetchYahooPrice('GBPEUR=X'),
    fetchYahooPrice('BZ=F'),
    fetchYahooPrice('GC=F'),
  ]);
  return { gbpUsd, gbpEur, brent, gold };
}
