// Per-holding reference data the monthly brief needs but is not derivable from
// transactions or live prices. Sourced from the Supabase `holdings` table
// (columns `index_group` and `revenue_mix` — see migrations/add_holdings_meta.sql).
// Edit per-holding values in the Supabase dashboard; no code change required.

export type IndexGroup = 'FTSE100' | 'FTSE250' | 'AIM' | 'Other';
export type RevenueMix = 'Global' | 'Domestic' | 'Mixed';

export interface HoldingMeta {
  index:       IndexGroup;
  revenueMix?: RevenueMix;
}

export interface HoldingMetaRow {
  ticker:       string;
  index_group:  string | null;
  revenue_mix:  string | null;
}

export type MetaLookup = (ticker: string) => HoldingMeta;

function normaliseTicker(ticker: string): string {
  return ticker.toUpperCase().replace(/\.[A-Z]{1,2}$/, '').replace(/[^A-Z0-9]/g, '');
}

function coerceIndex(v: string | null | undefined): IndexGroup {
  switch ((v ?? '').toUpperCase()) {
    case 'FTSE100': return 'FTSE100';
    case 'FTSE250': return 'FTSE250';
    case 'AIM':     return 'AIM';
    default:        return 'Other';
  }
}

function coerceMix(v: string | null | undefined): RevenueMix | undefined {
  switch ((v ?? '').toLowerCase()) {
    case 'global':   return 'Global';
    case 'domestic': return 'Domestic';
    case 'mixed':    return 'Mixed';
    default:         return undefined;
  }
}

// Builds a lookup function from Supabase rows. Tickers may be stored with or
// without the exchange suffix (BA vs BA.L); the normaliser strips it so both
// match.
export function buildMetaLookup(rows: HoldingMetaRow[]): MetaLookup {
  const byTicker: Record<string, HoldingMeta> = {};
  for (const r of rows) {
    if (!r.ticker) continue;
    byTicker[normaliseTicker(r.ticker)] = {
      index:      coerceIndex(r.index_group),
      revenueMix: coerceMix(r.revenue_mix),
    };
  }
  return (ticker: string) => byTicker[normaliseTicker(ticker)] ?? { index: 'Other' };
}
