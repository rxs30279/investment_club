// app/api/income/route.ts
//
// Powers the standalone /income page (the old "Income Corner" from the monthly
// brief, now its own live-data page). The client computes positions and POSTs
// them here; we fetch the last 12 months of ex-dividend dates + amounts per
// holding from Yahoo Finance and compute a trailing-12m yield.
//
// Unit gotcha (same as the brief's formatter): Yahoo returns UK dividend amounts
// in PENCE, but Position.currentPrice is in POUNDS (/api/prices divides by 100).
// Convert to the same unit or the yield comes out 100× too large.

import { NextRequest } from 'next/server';
import { fetchDividendRows } from '@/lib/sources/yahoo';

export const maxDuration = 60;

// FTSE 100 trailing dividend yield, used as the comparison benchmark.
const FTSE_AVG_YIELD = 3.5;

interface IncomePosition {
  ticker:       string;
  name:         string;
  currentPrice: number;        // pounds
  currentValue: number | null; // pounds
  ownedSince:   string | null; // ISO date of the club's first purchase
}

export async function POST(request: NextRequest) {
  let positions: IncomePosition[];
  try {
    const body = await request.json();
    positions = Array.isArray(body?.positions) ? body.positions : [];
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (positions.length === 0) {
    return Response.json({ holdings: [], ftseAvgYield: FTSE_AVG_YIELD });
  }

  const rows = await fetchDividendRows(
    positions.map(p => ({ ticker: p.ticker, name: p.name }))
  );
  const byTicker = new Map(rows.map(r => [r.ticker, r]));

  const holdings = positions.map(p => {
    // Keep the stock's full 12-month history (so yield stays a true trailing
    // figure); the client greys out any dividend that went ex before the club
    // owned the shares, using ownedSince.
    const divs        = byTicker.get(p.ticker)?.divs ?? []; // already sorted newest-first
    const annualPence = divs.reduce((s, d) => s + d.amount, 0);
    const annualPence2dp = divs.length ? parseFloat(annualPence.toFixed(2)) : null;
    const yieldPct    = p.currentPrice
      ? parseFloat((annualPence / 100 / p.currentPrice * 100).toFixed(2))
      : null;
    return {
      ticker:       p.ticker,
      name:         p.name,
      currentValue: p.currentValue,
      ownedSince:   p.ownedSince,
      lastExDiv:    divs[0]?.date   ?? null,
      lastAmount:   divs[0]?.amount ?? null,
      annualPence:  annualPence2dp,
      yieldPct,
      divs,
    };
  });

  return Response.json({ holdings, ftseAvgYield: FTSE_AVG_YIELD });
}
