import { supabase } from './supabase';
import type { WatchlistItem } from '@/types';

// Data access for the shared, club-wide watchlist. Mutations write directly via
// the Supabase client (same pattern as app/manage/page.tsx) since the site uses
// a single shared password rather than per-user accounts.

interface WatchlistRow {
  id: number;
  ticker: string;
  name: string;
  nominated_by: string | null;
  target_buy: number | null;
  created_at: string;
}

function mapRow(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    nominatedBy: row.nominated_by ?? null,
    targetBuy: row.target_buy,
    createdAt: row.created_at,
  };
}

// Supabase error objects don't subclass Error, so they render as "{}" in the
// dev overlay / console. Wrap them so failures surface a real message + code.
function asError(error: { message?: string; code?: string; hint?: string } | null, context: string): Error {
  const parts = [error?.message, error?.code && `(${error.code})`, error?.hint].filter(Boolean);
  return new Error(`${context}: ${parts.join(' ') || 'unknown Supabase error'}`);
}

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw asError(error, 'Could not load watchlist');
  return (data ?? []).map(mapRow);
}

export async function addWatchlistItem(ticker: string, name: string, nominatedBy?: string | null): Promise<WatchlistItem> {
  // Normalise to upper-case with a .L suffix so UK tickers de-dupe cleanly.
  const normalised = ticker.trim().toUpperCase();
  const nominator = nominatedBy?.trim() || null;
  const { data, error } = await supabase
    .from('watchlist')
    .insert({ ticker: normalised, name: name.trim(), nominated_by: nominator })
    .select('*')
    .single();
  if (error) throw asError(error, 'Could not add stock');
  return mapRow(data);
}

export async function removeWatchlistItem(id: number): Promise<void> {
  const { error } = await supabase.from('watchlist').delete().eq('id', id);
  if (error) throw asError(error, 'Could not remove stock');
}

export async function setTargetBuy(id: number, targetBuy: number | null): Promise<void> {
  const { error } = await supabase
    .from('watchlist')
    .update({ target_buy: targetBuy })
    .eq('id', id);
  if (error) throw asError(error, 'Could not save target price');
}

export async function setNominatedBy(id: number, nominatedBy: string | null): Promise<void> {
  const { error } = await supabase
    .from('watchlist')
    .update({ nominated_by: nominatedBy?.trim() || null })
    .eq('id', id);
  if (error) throw asError(error, 'Could not save nominator');
}
