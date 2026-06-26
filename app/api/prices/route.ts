import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data: holdings, error } = await supabase
      .from('holdings')
      .select('ticker');

    if (error) {
      console.error('Supabase error loading holdings for prices:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const uniqueTickers = [...new Set((holdings ?? []).map(h => h.ticker).filter(Boolean))] as string[];
    
    const entries = await Promise.all(
      uniqueTickers.map(async (ticker) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
            },
          });
          clearTimeout(timeoutId);

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
        // Cache for 60s only. This response's cache key has no params, so it
        // doesn't change when holdings change — a long TTL meant a newly added
        // ticker was absent from the cached map and rendered as £0 until the
        // cache expired. A short TTL lets new holdings price within a minute.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
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