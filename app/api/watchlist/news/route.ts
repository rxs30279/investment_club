import { NextResponse } from 'next/server';
import { fetchCompanyNews } from '@/lib/sources/rss';
import type { WatchlistNews } from '@/types';

// GET /api/watchlist/news?ticker=REL.L&name=RELX%20PLC
// Returns press coverage (Google News RSS) for one stock. RNS is served
// separately by /api/watchlist/rns (batched for the whole list, since the
// Investegate scan is heavy) and merged client-side.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker')?.trim();
    const name = searchParams.get('name')?.trim();
    if (!ticker || !name) {
      return NextResponse.json({ error: 'ticker and name query params required' }, { status: 400 });
    }

    const items = await fetchCompanyNews(name);
    const press = items.map(i => {
      // Google News leaves a " - Source" suffix on the title when it also supplies
      // a <source> tag — drop it so the panel doesn't show the source twice.
      const suffix = ` - ${i.source}`;
      const title = i.title.endsWith(suffix) ? i.title.slice(0, -suffix.length).trim() : i.title;
      return { title, source: i.source, date: i.date, url: i.url };
    });

    const body: WatchlistNews = { ticker, press, rns: [] };
    return NextResponse.json(body, {
      headers: {
        // Press changes through the day but not minute-to-minute — cache ~30 min.
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('Error fetching watchlist news:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
