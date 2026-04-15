// app/api/performance/benchmarks/route.ts
//
// Returns FTSE 100 (^FTSE) and FTSE 250 (^FTMC) closing prices for each
// portfolio valuation date, rebased to 100 from the first date.
//
// Query params:
//   ?dates=YYYY-MM-DD,YYYY-MM-DD,...  (portfolio valuation dates — preferred)
//   ?from=YYYY-MM-DD                  (fallback: earliest date, returns all daily data)

import { NextResponse } from 'next/server';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

interface DataPoint {
  date: string;   // "YYYY-MM-DD" — matches the portfolio valuation date exactly
  value: number;  // rebased — starts at 100 on the first date
}

interface BenchmarkResult {
  ftse100: DataPoint[];
  ftse250: DataPoint[];
}

/** Fetch daily closes from Yahoo Finance, returned as a date→close map */
async function fetchDailyCloses(
  ticker: string,
  fromTimestamp: number,
  toTimestamp: number,
): Promise<Map<string, number>> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${fromTimestamp}&period2=${toTimestamp}&interval=1d`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(url, { signal: controller.signal, headers: YAHOO_HEADERS });
  clearTimeout(timeoutId);
  if (!res.ok) throw new Error(`Yahoo Finance error for ${ticker}: ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${ticker}`);

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[]     = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  const map = new Map<string, number>();
  timestamps.forEach((ts, i) => {
    if (closes[i] != null && closes[i] > 0) {
      map.set(new Date(ts * 1000).toISOString().split('T')[0], closes[i]);
    }
  });
  return map;
}

/**
 * For a target date (which may fall on a weekend or holiday), walk back up to
 * 5 days to find the most recent prior trading day close.
 */
function closestPriorClose(map: Map<string, number>, targetDate: string): number | null {
  const d = new Date(targetDate);
  for (let i = 0; i <= 5; i++) {
    const key = new Date(d.getTime() - i * 86400_000).toISOString().split('T')[0];
    const val = map.get(key);
    if (val != null) return val;
  }
  return null;
}

/** Pick closes for the requested dates and rebase so first = 100 */
function buildSeries(dates: string[], closeMap: Map<string, number>): DataPoint[] {
  const points = dates
    .map(date => ({ date, close: closestPriorClose(closeMap, date) }))
    .filter((p): p is { date: string; close: number } => p.close !== null);

  if (points.length === 0) return [];
  const base = points[0].close;
  return points.map(p => ({
    date:  p.date,
    value: parseFloat(((p.close / base) * 100).toFixed(4)),
  }));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const datesParam = searchParams.get('dates');
    const fromParam  = searchParams.get('from');

    const portfolioDates: string[] = datesParam
      ? datesParam.split(',').map(s => s.trim()).filter(Boolean).sort()
      : [];

    const earliest = portfolioDates[0] ?? fromParam ?? null;
    const fromDate = earliest ? new Date(earliest) : (() => {
      const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d;
    })();

    // Buffer so Yahoo has daily data slightly before the first valuation date
    const bufferedFrom = new Date(fromDate);
    bufferedFrom.setDate(bufferedFrom.getDate() - 10);

    const fromTs = Math.floor(bufferedFrom.getTime() / 1000);
    const toTs   = Math.floor(Date.now() / 1000);

    const [map100, map250] = await Promise.all([
      fetchDailyCloses('^FTSE', fromTs, toTs),
      fetchDailyCloses('^FTMC', fromTs, toTs),
    ]);

    // If specific dates were supplied use them; otherwise return all available dates
    const dates = portfolioDates.length > 0
      ? portfolioDates
      : Array.from(map100.keys()).sort();

    const result: BenchmarkResult = {
      ftse100: buildSeries(dates, map100),
      ftse250: buildSeries(dates, map250),
    };

    return NextResponse.json(result, {
      headers: {
        // Cache for 6 hours — data only needs to refresh once per trading day
        'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    console.error('[performance/benchmarks] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
