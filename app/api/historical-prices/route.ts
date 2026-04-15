import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface Holding {
  id: number;
  name: string;
  ticker: string;
  sector: string;
}

interface HoldingsData {
  holdings: Holding[];
}

// Fetches the closing price of each ticker on (or nearest trading day to) a given date.
// Usage: GET /api/historical-prices?date=2026-01-02
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');

  if (!dateParam) {
    return NextResponse.json({ error: 'Missing ?date=YYYY-MM-DD param' }, { status: 400 });
  }

  // Convert date to Unix timestamps — fetch a 5-day window around the target date
  // so we always get a trading day close even if the exact date was a weekend/holiday.
  const targetDate = new Date(dateParam);
  const windowStart = new Date(targetDate);
  windowStart.setDate(windowStart.getDate() - 4); // go back 4 days to catch any gaps
  const windowEnd = new Date(targetDate);
  windowEnd.setDate(windowEnd.getDate() + 1); // day after, as Yahoo end is exclusive

  const period1 = Math.floor(windowStart.getTime() / 1000);
  const period2 = Math.floor(windowEnd.getTime() / 1000);

  try {
    const holdingsPath = path.join(process.cwd(), 'app', 'data', 'holdings-reference.json');
    const holdingsData = fs.readFileSync(holdingsPath, 'utf8');
    const parsedData: HoldingsData = JSON.parse(holdingsData);
    const holdings = parsedData.holdings || [];
    const uniqueTickers = [...new Set(holdings.map((h) => h.ticker))];

    const targetTs = targetDate.getTime() / 1000;

    const entries = await Promise.all(
      uniqueTickers.map(async (ticker): Promise<[string, number]> => {
        try {
          const url =
            `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}` +
            `?period1=${period1}&period2=${period2}&interval=1d`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Accept: 'application/json',
            },
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            console.warn(`Failed to fetch historical ${ticker}: ${response.status}`);
            return [ticker, 0];
          }

          const data = await response.json();
          const result = data.chart?.result?.[0];
          if (!result) return [ticker, 0];

          const timestamps: number[] = result.timestamps ?? result.timestamp ?? [];
          const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
          if (timestamps.length === 0 || closes.length === 0) return [ticker, 0];

          // Find the close price on the last trading day on or before the target date
          let bestPrice = 0;
          let bestTs = -Infinity;
          for (let i = 0; i < timestamps.length; i++) {
            const ts = timestamps[i];
            const close = closes[i];
            if (close == null) continue;
            if (ts <= targetTs + 86400 && ts > bestTs) {
              bestTs = ts;
              bestPrice = close;
            }
          }

          // Yahoo returns prices in pence for UK stocks — convert to pounds
          return [ticker, bestPrice > 0 ? bestPrice / 100 : 0];
        } catch (error) {
          console.error(`Error fetching historical ${ticker}:`, error);
          return [ticker, 0];
        }
      })
    );

    return NextResponse.json(Object.fromEntries(entries));
  } catch (error) {
    console.error('Error in historical-prices API:', error);
    return NextResponse.json({ error: 'Failed to fetch historical prices' }, { status: 500 });
  }
}