import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Fetch FTSE 100 data from Yahoo Finance (server-side, no CORS)
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EFTSE?interval=1d&range=6mo';
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance returned ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.chart?.result?.[0]) {
      return NextResponse.json([]);
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    const closes = quotes.close;
    
    const ftseData = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i]) {
        ftseData.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          value: closes[i],
        });
      }
    }
    
    return NextResponse.json(ftseData);
  } catch (error) {
    console.error('Error fetching FTSE data:', error);
    return NextResponse.json([]);
  }
}