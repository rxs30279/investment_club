import { createClient } from '@supabase/supabase-js';
import type { HoldingMetaRow } from '../monthly-brief/holdings-meta';

// Pulls (ticker, index_group, revenue_mix) from the Supabase `holdings` table.
// Returns [] if the table or columns are missing so the route can still render
// (every holding will fall back to index='Other').
export async function fetchHoldingsMeta(): Promise<HoldingMetaRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[holdings-meta] Supabase env not configured; index breakdown will fall back to "Other".');
    return [];
  }
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('holdings')
    .select('ticker, index_group, revenue_mix');
  if (error) {
    console.warn('[holdings-meta] Supabase query failed:', error.message,
      '— run migrations/add_holdings_meta.sql to populate index_group/revenue_mix.');
    return [];
  }
  return (data ?? []) as HoldingMetaRow[];
}
