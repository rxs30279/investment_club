import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Define the structure of holdings data
interface Holding {
  id: number;
  name: string;
  ticker: string;
  sector: string;
}

interface HoldingsData {
  holdings: Holding[];
}

export async function GET() {
  try {
    // Read holdings from JSON file
    const holdingsPath = path.join(process.cwd(), 'app', 'data', 'holdings-reference.json');
    const holdingsData = fs.readFileSync(holdingsPath, 'utf8');
    const parsedData: HoldingsData = JSON.parse(holdingsData);
    const holdings = parsedData.holdings || [];
    const tickers = holdings.map((h: Holding) => h.ticker);
    
    // Remove duplicates
    const uniqueTickers = [...new Set(tickers)];
    
    const entries = await Promise.all(
      uniqueTickers.map(async (ticker) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
            },
          });

          if (!response.ok) {
            console.warn(`Failed to fetch ${ticker}: ${response.status}`);
            return [ticker, 0] as const;
          }

          const data = await response.json();
          const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
          return [ticker, price ? price / 100 : 0] as const;
        } catch (error) {
          console.error(`Error fetching ${ticker}:`, error);
          return [ticker, 0] as const;
        }
      })
    );

    return NextResponse.json(Object.fromEntries(entries), {
      headers: {
        // Cache for 1 hour — current prices don't need to be real-time for this dashboard
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error in prices API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock prices' },
      { status: 500 }
    );
  }
}