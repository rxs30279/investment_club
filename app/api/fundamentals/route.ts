import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();
    
    console.log(`Fetching data for: ${ticker}`);
    
    // Get chart data for 52-week range (this works reliably)
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`;
    
    const chartResponse = await fetch(chartUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    
    if (!chartResponse.ok) {
      console.error(`Chart API failed for ${ticker}: ${chartResponse.status}`);
      return NextResponse.json({ high52Week: 0, low52Week: 0 });
    }
    
    const chartData = await chartResponse.json();
    
    if (!chartData?.chart?.result?.[0]) {
      console.error(`No chart data for ${ticker}`);
      return NextResponse.json({ high52Week: 0, low52Week: 0 });
    }
    
    const result = chartData.chart.result[0];
    const meta = result.meta;
    const indicators = result.indicators.quote[0];
    const closes = indicators.close.filter((c: number | null) => c !== null);
    
    const currentPrice = meta.regularMarketPrice;
    const high52Week = Math.max(...closes);
    const low52Week = Math.min(...closes);
    
    console.log(`52-week range for ${ticker}: high=${high52Week}, low=${low52Week}`);
    
    return NextResponse.json({
      high52Week,
      low52Week,
      currentPrice,
    });
  } catch (error) {
    console.error('Error fetching fundamentals:', error);
    return NextResponse.json({ high52Week: 0, low52Week: 0 });
  }
}