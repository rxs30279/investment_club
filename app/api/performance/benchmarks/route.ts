// app/api/performance/benchmarks/route.ts
//
// Returns FTSE 100 (^FTSE) and FTSE 250 (^FTMC) historical data,
// rebased to 100 from the portfolio's earliest valuation date,
// so all three lines start at the same point on the chart.
//
// Query param:  ?from=YYYY-MM-DD   (earliest portfolio valuation date)
// Falls back to 1 year ago if not supplied.
//
// Uses the same Yahoo Finance approach as your existing /api/prices route.

import { NextResponse } from 'next/server';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

interface DataPoint {
  date: string;   // "YYYY-MM-DD"
  value: number;  // rebased — starts at 100 on `from` date
}

interface BenchmarkResult {
  ftse100: DataPoint[];
  ftse250: DataPoint[];
}

/** Fetch daily closing prices from Yahoo Finance v8 chart API */
async function fetchYahooHistory(
  ticker: string,
  fromTimestamp: number,
  toTimestamp: number
): Promise<{ date: string; close: number }[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${fromTimestamp}&period2=${toTimestamp}&interval=1mo`;

  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance error for ${ticker}: ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${ticker}`);

  const timestamps: number[]  = result.timestamp ?? [];
  const closes: number[]      = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  return timestamps.map((ts, i) => ({
    date:  new Date(ts * 1000).toISOString().split('T')[0],
    close: closes[i] ?? 0,
  })).filter(p => p.close > 0);
}

/** Rebase a series so the first value = 100 */
function rebase(series: { date: string; close: number }[]): DataPoint[] {
  if (series.length === 0) return [];
  const base = series[0].close;
  return series.map(p => ({
    date:  p.date,
    value: parseFloat(((p.close / base) * 100).toFixed(4)),
  }));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from'); // "YYYY-MM-DD"

    // Default: one year ago
    const fromDate = fromParam ? new Date(fromParam) : (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      return d;
    })();

    // Fetch up to today
    const toDate = new Date();

    // Add a small buffer before fromDate so Yahoo always has a closing
    // price on or just before the first portfolio valuation date
    const bufferedFrom = new Date(fromDate);
    bufferedFrom.setDate(bufferedFrom.getDate() - 10);

    const fromTs = Math.floor(bufferedFrom.getTime() / 1000);
    const toTs   = Math.floor(toDate.getTime() / 1000);

    const [raw100, raw250] = await Promise.all([
      fetchYahooHistory('^FTSE', fromTs, toTs),
      fetchYahooHistory('^FTMC', fromTs, toTs),
    ]);

    const result: BenchmarkResult = {
      ftse100: rebase(raw100),
      ftse250: rebase(raw250),
    };

    return NextResponse.json(result, {
      headers: {
        // Cache for 6 hours — benchmark data doesn't need to be real-time
        'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    console.error('[performance/benchmarks] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
