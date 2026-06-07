import { NextResponse } from 'next/server';
import type { WatchlistQuote } from '@/types';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const EMPTY = (ticker: string): WatchlistQuote => ({
  ticker, price: 0, prevClose: 0, dayChangePct: 0,
  sparkline: [], high52: 0, low52: 0, riskScore: 0, volatility: 0,
});

// Annualised volatility (decimal, e.g. 0.28) from daily log returns × √252.
// Scale-invariant, so the pence→pounds division on closes doesn't affect it.
// Returns 0 when there isn't enough data to be meaningful.
function annualizedVol(closes: number[]): number {
  if (closes.length < 10) return 0;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 5) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

// 1 (calm) .. 10 (wild), from annualised volatility.
// ~0.09 annualised vol maps to 1, ~0.90+ maps to 10 — covers blue chips to AIM small caps.
function computeRisk(closes: number[]): number {
  const vol = annualizedVol(closes);
  if (vol === 0) return 0;
  return Math.min(10, Math.max(1, Math.ceil(vol / 0.09)));
}

async function fetchQuote(ticker: string): Promise<WatchlistQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: YAHOO_HEADERS });
  if (!res.ok) return EMPTY(ticker);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return EMPTY(ticker);

  // UK stocks (.L) are quoted in pence on Yahoo — divide by 100 to get pounds.
  const scale = ticker.toUpperCase().endsWith('.L') ? 100 : 1;

  const rawCloses = (result.indicators?.quote?.[0]?.close ?? []) as (number | null)[];
  const closes = rawCloses.filter((c): c is number => c != null).map(c => c / scale);
  if (closes.length === 0) return EMPTY(ticker);

  const meta = result.meta ?? {};
  const price = meta.regularMarketPrice != null ? meta.regularMarketPrice / scale : closes[closes.length - 1];
  // NB: meta.chartPreviousClose on a range=1y query is the close *before the year*,
  // not yesterday's — so derive the prior close from the daily series instead.
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  const dayChangePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;

  return {
    ticker,
    price,
    prevClose,
    dayChangePct,
    sparkline: closes.slice(-30),
    high52: Math.max(...closes),
    low52: Math.min(...closes),
    riskScore: computeRisk(closes),
    volatility: Math.round(annualizedVol(closes) * 1000) / 10,
  };
}

// GET /api/watchlist/quote?tickers=REL.L,SRT.L
// Fetches all tickers in parallel; returns a map of ticker -> WatchlistQuote.
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
          return [ticker, await fetchQuote(ticker)] as const;
        } catch {
          return [ticker, EMPTY(ticker)] as const;
        }
      })
    );

    return NextResponse.json(Object.fromEntries(entries), {
      headers: {
        // Quotes update slowly enough for a watchlist — cache ~10 min.
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('Error fetching watchlist quotes:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
