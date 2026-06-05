import { NextResponse } from 'next/server';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

interface YahooQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
}

// GET /api/watchlist/search?q=relx
// Searches Yahoo and returns UK-listed equities only ({ symbol, name }[]).
// The club invests in UK equities only, so non-.L results are filtered out.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    if (!q || q.length < 2) return NextResponse.json([]);

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: YAHOO_HEADERS });
    if (!res.ok) return NextResponse.json([]);

    const json = await res.json();
    const quotes = (json?.quotes ?? []) as YahooQuote[];

    const results = quotes
      .filter(q => q.symbol?.toUpperCase().endsWith('.L') && q.quoteType === 'EQUITY')
      .map(q => ({ symbol: q.symbol!.toUpperCase(), name: q.longname || q.shortname || q.symbol! }));

    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('Error searching tickers:', err);
    return NextResponse.json([]);
  }
}
