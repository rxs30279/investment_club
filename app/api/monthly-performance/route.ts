// app/api/monthly-performance/route.ts
//
// Returns each holding's % change for the current month
// by fetching start-of-month and current prices from Yahoo Finance.

import { NextResponse } from 'next/server';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

export async function POST(request: Request) {
  try {
    const { tickers } = await request.json();
    if (!tickers || !Array.isArray(tickers)) {
      return NextResponse.json({ error: 'tickers array required' }, { status: 400 });
    }

    // Start of current month at midnight
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromTs = Math.floor(startOfMonth.getTime() / 1000) - 86400 * 3; // 3 day buffer
    const toTs   = Math.floor(now.getTime() / 1000);

    const results: Record<string, { monthStart: number; current: number; changePercent: number }> = {};

    await Promise.all(
      tickers.map(async (ticker: string) => {
        try {
          const url =
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
            `?period1=${fromTs}&period2=${toTs}&interval=1d`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(url, { signal: controller.signal, headers: YAHOO_HEADERS });
          clearTimeout(timeoutId);
          if (!res.ok) return;

          const json = await res.json();
          const result = json?.chart?.result?.[0];
          if (!result) return;

          const closes: number[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];
          const validCloses = closes.filter((c: number) => c != null && c > 0);
          if (validCloses.length < 2) return;

          const monthStart = validCloses[0];
          const current    = validCloses[validCloses.length - 1];
          const changePercent = ((current - monthStart) / monthStart) * 100;

          results[ticker] = { monthStart, current, changePercent };
        } catch {
          // skip failed tickers
        }
      })
    );

    return NextResponse.json(results, {
      headers: {
        // Cache for 1 hour — monthly change data is stable within the trading day
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}