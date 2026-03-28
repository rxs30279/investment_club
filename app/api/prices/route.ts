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
    
    console.log(`Fetching prices for ${uniqueTickers.length} tickers:`, uniqueTickers);
    
    const prices: Record<string, number> = {};
    
    for (const ticker of uniqueTickers) {
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
          prices[ticker] = 0;
          continue;
        }
        
        const data = await response.json();
        
        if (data.chart?.result?.[0]?.meta?.regularMarketPrice) {
          const priceInPence = data.chart.result[0].meta.regularMarketPrice;
          prices[ticker] = priceInPence / 100;
        } else {
          prices[ticker] = 0;
        }
      } catch (error) {
        console.error(`Error fetching ${ticker}:`, error);
        prices[ticker] = 0;
      }
    }
    
    return NextResponse.json(prices);
  } catch (error) {
    console.error('Error in prices API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock prices' },
      { status: 500 }
    );
  }
}