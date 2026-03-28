import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    
    if (!apiKey) {
      console.error('Missing Alpha Vantage API key');
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }
    
    // Get fundamentals from Alpha Vantage
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}.L&apikey=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    // Check for API errors
    if (data.Note) {
      console.log('Alpha Vantage rate limit:', data.Note);
      return NextResponse.json({ error: 'Rate limit exceeded', note: data.Note }, { status: 429 });
    }
    
    if (data.Information) {
      console.log('Alpha Vantage info:', data.Information);
      return NextResponse.json({ error: 'API error', info: data.Information }, { status: 400 });
    }
    
    // Check if we got valid data
    if (!data.Symbol) {
      console.log('No data returned for ticker:', ticker);
      return NextResponse.json({ error: 'No data available' }, { status: 404 });
    }
    
    // Extract and format fundamentals
    const fundamentals = {
      price: parseFloat(data.Price) || 0,
      high52Week: parseFloat(data['52WeekHigh']) || 0,
      low52Week: parseFloat(data['52WeekLow']) || 0,
      percent52Week: 0,
      exDividendDate: data.ExDividendDate || 'N/A',
      nextEarnings: data.EarningsDate || 'N/A',
      dividend: parseFloat(data.DividendPerShare) || 0,
      dividendYield: data.DividendYield ? parseFloat(data.DividendYield) * 100 : 0,
      peTTM: parseFloat(data.PERatio) || 0,
      forwardPE: parseFloat(data.ForwardPE) || 0,
      beta: parseFloat(data.Beta) || 0,
      marketCap: parseInt(data.MarketCapitalization) || 0,
    };
    
    // Calculate percent from 52-week low
    if (fundamentals.low52Week > 0 && fundamentals.price > 0) {
      fundamentals.percent52Week = ((fundamentals.price - fundamentals.low52Week) / fundamentals.low52Week) * 100;
    }
    
    console.log(`Alpha Vantage data for ${ticker}:`, {
      price: fundamentals.price,
      peTTM: fundamentals.peTTM,
      dividendYield: fundamentals.dividendYield,
      beta: fundamentals.beta,
      marketCap: fundamentals.marketCap,
    });
    
    return NextResponse.json(fundamentals);
  } catch (error) {
    console.error('Alpha Vantage API error:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}