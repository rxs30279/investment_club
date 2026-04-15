import { NextResponse } from 'next/server';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

async function fetch52WeekRange(ticker: string) {
  // 1y is enough for a 52-week high/low — no need to fetch 2 years
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(url, { signal: controller.signal, headers: YAHOO_HEADERS });
  clearTimeout(timeoutId);
  if (!res.ok) {
    console.error(`Chart API failed for ${ticker}: ${res.status}`);
    return { high52Week: 0, low52Week: 0, currentPrice: 0 };
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    console.error(`No chart data for ${ticker}`);
    return { high52Week: 0, low52Week: 0, currentPrice: 0 };
  }

  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((c: number | null) => c != null);

  // UK stocks (.L suffix) are quoted in pence on Yahoo Finance — divide by 100 to get pounds
  const isPence = ticker.toUpperCase().endsWith('.L');
  const scale = isPence ? 100 : 1;

  return {
    high52Week:   closes.length ? Math.max(...closes) / scale : 0,
    low52Week:    closes.length ? Math.min(...closes) / scale : 0,
    currentPrice: (result.meta?.regularMarketPrice ?? 0) / scale,
  };
}

// GET /api/fundamentals?tickers=AAPL,MSFT,VOD.L
// Fetches all tickers in parallel and returns a map of ticker → { high52Week, low52Week, currentPrice }
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tickersParam = searchParams.get('tickers');
    if (!tickersParam) {
      return NextResponse.json({ error: 'tickers query param required' }, { status: 400 });
    }

    const tickers = tickersParam.split(',').map(s => s.trim()).filter(Boolean);

    const entries = await Promise.all(
      tickers.map(async ticker => {
        try {
          return [ticker, await fetch52WeekRange(ticker)] as const;
        } catch {
          return [ticker, { high52Week: 0, low52Week: 0, currentPrice: 0 }] as const;
        }
      })
    );

    return NextResponse.json(Object.fromEntries(entries), {
      headers: {
        // 52-week ranges change slowly — cache for 24 hours
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    console.error('Error fetching fundamentals:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
