// app/api/ftse100/route.ts
//
// Fetches FTSE 100 (^FTSE) daily closing prices from Yahoo Finance
// covering the last 2 years so monthly returns can be calculated
// for the full range of treasurer unit value data.

import { NextResponse } from 'next/server';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

export async function GET() {
  try {
    // 2 years back from today
    const toDate   = new Date();
    const fromDate = new Date();
    fromDate.setFullYear(fromDate.getFullYear() - 2);

    const fromTs = Math.floor(fromDate.getTime() / 1000);
    const toTs   = Math.floor(toDate.getTime() / 1000);

    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/%5EFTSE` +
      `?period1=${fromTs}&period2=${toTs}&interval=1d`;

    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('No data returned from Yahoo Finance');

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[]     = result.indicators?.adjclose?.[0]?.adjclose ?? [];

    const data = timestamps
      .map((ts, i) => ({
        date:  new Date(ts * 1000).toISOString().split('T')[0],
        value: closes[i],
      }))
      .filter(p => p.value != null && p.value > 0);

    return NextResponse.json(data, {
      headers: {
        // Cache for 4 hours — daily data doesn't need to be real-time
        'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    console.error('Failed to fetch FTSE100:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}