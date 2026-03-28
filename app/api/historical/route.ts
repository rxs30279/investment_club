import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { symbol, interval = '1d', range = '2y' } = await request.json();
    
    // Fetch historical data from Yahoo Finance
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch historical data for ${symbol}`);
    }
    
    const data = await response.json();
    
    if (!data.chart?.result?.[0]) {
      return NextResponse.json([]);
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    const closes = quotes.close;
    
    // Build the data array
    const historicalData = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i]) {
        const isUKStock = symbol.endsWith('.L');
        const conversion = isUKStock ? 100 : 1;
        
        historicalData.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          price: closes[i] / conversion,
        });
      }
    }
    
    return NextResponse.json(historicalData);
  } catch (error) {
    console.error('Error fetching historical data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch historical data' },
      { status: 500 }
    );
  }
}