// app/api/monthly-performance/route.ts
//
// Returns each holding's % change over a rolling 30-day lookback window
// (not the calendar month) by fetching the close ~30 days ago and the latest
// close from Yahoo Finance.

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

    // Rolling 30-day lookback window
    const now = new Date();
    const LOOKBACK_DAYS = 30;
    const periodStart = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
    const fromTs = Math.floor(periodStart.getTime() / 1000) - 86400 * 5; // buffer so a trading day exists at/just before the boundary
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

          const ts: number[] = result.timestamp ?? [];
          const closes: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];
          if (ts.length === 0 || closes.length === 0) return;

          // Baseline = first valid close ON/AFTER the 30-day boundary. The buffer
          // above only exists to guarantee data near the boundary; we select by the
          // boundary timestamp so buffer days before it are ignored.
          const startSec = Math.floor(periodStart.getTime() / 1000);
          const valid = (i: number) => closes[i] != null && closes[i]! > 0;

          let startIdx = -1;
          for (let i = 0; i < ts.length; i++) {
            if (valid(i) && ts[i] >= startSec) { startIdx = i; break; }
          }
          let curIdx = -1;
          for (let i = ts.length - 1; i >= 0; i--) {
            if (valid(i)) { curIdx = i; break; }
          }
          if (startIdx === -1) {
            // Nothing on/after the boundary — fall back to the last close before it.
            for (let i = ts.length - 1; i >= 0; i--) {
              if (valid(i) && ts[i] < startSec) { startIdx = i; break; }
            }
          }
          if (startIdx === -1 || curIdx === -1) return;

          const monthStart = closes[startIdx]!;
          const current    = closes[curIdx]!;
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