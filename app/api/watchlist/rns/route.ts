import { NextResponse } from 'next/server';
import { fetchInvestegateRnsByTicker } from '@/lib/sources/investegate';

// GET /api/watchlist/rns?tickers=REL.L,SRT.L
// Returns a map of BARE ticker (no .L suffix) -> RnsItem[], from a single
// Investegate scan of the whole list. Heavy (dozens of page fetches), so the
// page calls this once and caches aggressively; the table renders without it.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tickersParam = searchParams.get('tickers');
    if (!tickersParam) {
      return NextResponse.json({ error: 'tickers query param required' }, { status: 400 });
    }
    const tickers = tickersParam.split(',').map(s => s.trim()).filter(Boolean);

    const byTicker = await fetchInvestegateRnsByTicker(tickers);

    return NextResponse.json(byTicker, {
      headers: {
        // Expensive scan + RNS is low-frequency — cache ~1 hour.
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Error fetching watchlist RNS:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
