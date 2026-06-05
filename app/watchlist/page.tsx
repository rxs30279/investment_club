'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import RefreshButton from '@/components/RefreshButton';
import RangeBar from '@/components/RangeBar';
import Sparkline from '@/components/Sparkline';
import {
  getWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  setTargetBuy,
  setNominatedBy,
} from '@/lib/watchlist';
import type { WatchlistItem, WatchlistQuote, WatchlistRnsItem, WatchlistNews } from '@/types';

// Investegate keys RNS by the bare ticker (no exchange suffix).
const bareTicker = (ticker: string) => ticker.toUpperCase().replace(/\.[A-Z]{1,2}$/, '');

// Recent items show a relative age ("today", "4d"); anything older than a week
// shows the actual date ("12 Feb") since "23d" stops being intuitive.
function relativeAge(date: string): string {
  if (!date || date === 'recent') return '·';
  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return '·';
  const days = Math.max(0, Math.floor((Date.now() - then.getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days <= 7) return `${days}d`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Describes the span a sparkline covers (~N daily closes → weeks/months).
function trendLabel(points: number): string {
  const weeks = Math.round(points / 5);
  const span = weeks >= 9 ? `~${Math.round(points / 21)} months` : `~${weeks} weeks`;
  return `Price trend over the last ${points} trading days (${span})`;
}

// Risk badge colour: low score = calm/green, high score = volatile/red.
function riskColor(score: number): string {
  if (score <= 0) return '#6b7280';
  if (score <= 2) return '#10b981';
  if (score <= 4) return '#84cc16';
  if (score <= 6) return '#eab308';
  if (score <= 8) return '#f97316';
  return '#ef4444';
}

interface SearchResult { symbol: string; name: string }

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, WatchlistQuote>>({});
  const [rnsByTicker, setRnsByTicker] = useState<Record<string, WatchlistRnsItem[]>>({});
  const [press, setPress] = useState<Record<string, WatchlistNews['press']>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-stock search box
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [nominator, setNominator] = useState('');
  const [pending, setPending] = useState<SearchResult | null>(null); // stock awaiting nominator + confirm

  // Target-buy inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Nominated-by inline edit
  const [editingNomId, setEditingNomId] = useState<number | null>(null);
  const [nomValue, setNomValue] = useState('');

  // Fetch press for one ticker on demand, caching the result.
  const loadPress = useCallback(async (item: WatchlistItem) => {
    if (press[item.ticker]) return;
    try {
      const res = await fetch(`/api/watchlist/news?ticker=${encodeURIComponent(item.ticker)}&name=${encodeURIComponent(item.name)}`);
      if (!res.ok) return;
      const data: WatchlistNews = await res.json();
      setPress(prev => ({ ...prev, [item.ticker]: data.press }));
    } catch { /* leave empty */ }
  }, [press]);

  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await getWatchlist();
      setItems(list);
      setSelected(prev => prev ?? (list[0]?.ticker ?? null));
      setLoading(false);

      if (list.length === 0) return;
      const tickers = list.map(i => i.ticker).join(',');

      // Quotes drive the whole table — await these.
      try {
        const qRes = await fetch(`/api/watchlist/quote?tickers=${encodeURIComponent(tickers)}`);
        if (qRes.ok) setQuotes(await qRes.json());
      } catch { /* table still renders names */ }

      // RNS (heavy Investegate scan) and press fill in asynchronously — never block.
      fetch(`/api/watchlist/rns?tickers=${encodeURIComponent(tickers)}`)
        .then(r => (r.ok ? r.json() : {}))
        .then(setRnsByTicker)
        .catch(() => {});

      for (const item of list) loadPress(item);
    } catch (e) {
      console.error('Error loading watchlist:', e);
      setError(e instanceof Error ? e.message : 'Failed to load watchlist. Please try again.');
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Debounced ticker search.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/watchlist/search?q=${encodeURIComponent(query.trim())}`);
        setResults(res.ok ? await res.json() : []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query]);

  // Picking a search result stages it — the stock isn't added until the user
  // enters the nominator and confirms, so there's time to attribute it.
  const handleSelect = (r: SearchResult) => {
    setQuery('');
    setResults([]);
    if (items.some(i => i.ticker === r.symbol)) return;
    setPending(r);
  };

  const cancelAdd = () => {
    setPending(null);
    setNominator('');
  };

  const handleConfirmAdd = async () => {
    if (!pending) return;
    const r = pending;
    setPending(null);
    try {
      await addWatchlistItem(r.symbol, r.name, nominator);
      setNominator('');
      await loadData();
    } catch (e) {
      console.error('Failed to add stock:', e);
      setError('Could not add that stock.');
    }
  };

  const saveNominator = async (item: WatchlistItem) => {
    const value = nomValue.trim() || null;
    setEditingNomId(null);
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, nominatedBy: value } : i)));
    try {
      await setNominatedBy(item.id, value);
    } catch (e) {
      console.error('Failed to save nominator:', e);
    }
  };

  const handleRemove = async (item: WatchlistItem) => {
    try {
      await removeWatchlistItem(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      if (selected === item.ticker) setSelected(items.find(i => i.id !== item.id)?.ticker ?? null);
    } catch (e) {
      console.error('Failed to remove stock:', e);
    }
  };

  const saveTarget = async (item: WatchlistItem) => {
    const trimmed = editValue.trim();
    const value = trimmed === '' ? null : parseFloat(trimmed);
    setEditingId(null);
    if (value !== null && Number.isNaN(value)) return;
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, targetBuy: value } : i)));
    try {
      await setTargetBuy(item.id, value);
    } catch (e) {
      console.error('Failed to save target:', e);
    }
  };

  const selectedItem = items.find(i => i.ticker === selected) ?? null;
  const selectedRns = selected ? rnsByTicker[bareTicker(selected)] ?? [] : [];
  const selectedPress = selected ? press[selected] ?? [] : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
              <p className="mt-4 text-gray-400">Loading watchlist...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Watchlist</h1>
            <p className="text-sm text-gray-400 mt-1">{items.length} share{items.length === 1 ? '' : 's'} the club is tracking</p>
          </div>
          <RefreshButton onRefresh={loadData} />
        </div>

        {/* Add stock */}
        <div className="mb-6 max-w-2xl">
          {!pending ? (
            <div className="relative">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="+ Add stock by ticker or name…"
                autoComplete="off"
                style={{ colorScheme: 'dark' }}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600"
              />
              {(results.length > 0 || searching) && query.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                  {searching && results.length === 0 && (
                    <div className="px-4 py-2 text-xs text-gray-500">Searching…</div>
                  )}
                  {results.map(r => (
                    <button
                      key={r.symbol}
                      onClick={() => handleSelect(r)}
                      className="w-full text-left px-4 py-2 hover:bg-gray-800 transition-colors flex items-center justify-between gap-3"
                    >
                      <span className="text-sm text-gray-200 truncate">{r.name}</span>
                      <span className="text-xs font-mono text-emerald-400 shrink-0">{r.symbol}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg p-2">
              <div className="px-2 min-w-0">
                <span className="text-sm text-white font-medium">{pending.name}</span>
                <span className="ml-2 text-xs font-mono text-gray-500">{bareTicker(pending.symbol)}</span>
              </div>
              <input
                autoFocus
                value={nominator}
                onChange={e => setNominator(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleConfirmAdd(); if (e.key === 'Escape') cancelAdd(); }}
                placeholder="Nominated by…"
                autoComplete="off"
                style={{ colorScheme: 'dark' }}
                className="flex-1 sm:max-w-[200px] px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600"
              />
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={handleConfirmAdd}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium"
                >
                  Add
                </button>
                <button
                  onClick={cancelAdd}
                  className="px-3 py-1.5 text-gray-400 hover:text-white border border-gray-700 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-400 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={loadData} className="shrink-0 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs">Try again</button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-10 text-center text-gray-400">
            {error ? 'Could not load the watchlist.' : 'Your watchlist is empty. Use the search box above to add a UK share.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
            {/* Table */}
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-900/80 border-b border-gray-800">
                    <tr className="text-left">
                      <th className="px-3 py-3 text-xs font-medium text-gray-400">Stock</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400">Price</th>
                      <th className="hidden sm:table-cell px-3 py-3 text-right text-xs font-medium text-gray-400">Day</th>
                      <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-400">Trend</th>
                      <th className="hidden lg:table-cell px-3 py-3 text-left min-w-[140px] text-xs font-medium text-gray-400">52W Range</th>
                      <th className="hidden sm:table-cell px-3 py-3 text-right text-xs font-medium text-gray-400">Target</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-400">News</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-400">Volatility</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {items.map(item => {
                      const q = quotes[item.ticker];
                      const isSelected = selected === item.ticker;
                      const rnsCount = (rnsByTicker[bareTicker(item.ticker)] ?? []).length;
                      const pressCount = (press[item.ticker] ?? []).length;
                      const belowTarget = q && item.targetBuy != null && q.price <= item.targetBuy;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelected(item.ticker)}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-emerald-500/5' : 'hover:bg-gray-800/50'}`}
                        >
                          {/* Stock */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={e => { e.stopPropagation(); handleRemove(item); }}
                                title="Remove from watchlist"
                                className="text-gray-600 hover:text-red-400 transition-colors text-sm leading-none"
                              >
                                ✕
                              </button>
                              <div className="min-w-0" onClick={e => e.stopPropagation()}>
                                {editingNomId === item.id ? (
                                  <input
                                    autoFocus
                                    autoComplete="off"
                                    style={{ colorScheme: 'dark' }}
                                    value={nomValue}
                                    onChange={e => setNomValue(e.target.value)}
                                    onBlur={() => saveNominator(item)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveNominator(item); if (e.key === 'Escape') setEditingNomId(null); }}
                                    placeholder="Nominated by…"
                                    className="w-32 px-1.5 py-0.5 mb-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-white focus:outline-none focus:border-emerald-600"
                                  />
                                ) : (
                                  <button
                                    onClick={() => { setEditingNomId(item.id); setNomValue(item.nominatedBy ?? ''); }}
                                    title="Edit who nominated this stock"
                                    className={`block text-xs truncate max-w-[160px] ${item.nominatedBy ? 'text-emerald-400' : 'text-gray-600 italic'}`}
                                  >
                                    {item.nominatedBy ?? '+ nominator'}
                                  </button>
                                )}
                                {/* Mobile: smaller name, capped at 15 chars to keep the table narrow */}
                                <p className="sm:hidden text-white font-medium text-xs truncate max-w-[110px]">
                                  {item.name.length > 15 ? `${item.name.slice(0, 15)}…` : item.name}
                                </p>
                                {/* sm and up: full name */}
                                <p className="hidden sm:block text-white font-medium truncate max-w-[160px]">{item.name}</p>
                                <a
                                  href={`https://uk.finance.yahoo.com/quote/${item.ticker}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-gray-500 hover:text-emerald-400 font-mono"
                                >
                                  {bareTicker(item.ticker)}
                                </a>
                              </div>
                            </div>
                          </td>
                          {/* Price */}
                          <td className="px-3 py-3 text-right font-mono text-gray-200">
                            {q && q.price ? `£${q.price.toFixed(2)}` : '—'}
                          </td>
                          {/* Day */}
                          <td className={`hidden sm:table-cell px-3 py-3 text-right font-medium ${q && q.dayChangePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {q && q.price ? `${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(2)}%` : '—'}
                          </td>
                          {/* Trend */}
                          <td className="hidden md:table-cell px-3 py-3">
                            {q && q.sparkline.length > 1 ? (
                              <span title={trendLabel(q.sparkline.length)} className="inline-block cursor-help">
                                <Sparkline data={q.sparkline} />
                              </span>
                            ) : <span className="text-gray-600">—</span>}
                          </td>
                          {/* 52W Range */}
                          <td className="hidden lg:table-cell px-3 py-3">
                            {q && q.high52 ? <RangeBar current={q.price} low={q.low52} high={q.high52} /> : <span className="text-gray-600">—</span>}
                          </td>
                          {/* Target */}
                          <td className="hidden sm:table-cell px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                            {editingId === item.id ? (
                              <input
                                autoFocus
                                inputMode="decimal"
                                autoComplete="off"
                                style={{ colorScheme: 'dark' }}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => saveTarget(item)}
                                onKeyDown={e => { if (e.key === 'Enter') saveTarget(item); if (e.key === 'Escape') setEditingId(null); }}
                                placeholder="£"
                                className="w-16 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-right text-white focus:outline-none focus:border-emerald-600"
                              />
                            ) : item.targetBuy != null ? (
                              <button
                                onClick={() => { setEditingId(item.id); setEditValue(String(item.targetBuy)); }}
                                className={`font-mono text-xs px-1.5 py-0.5 rounded ${belowTarget ? 'bg-emerald-900/40 text-emerald-400' : 'text-gray-300 hover:bg-gray-800'}`}
                                title={belowTarget ? 'At or below target' : 'Edit target'}
                              >
                                £{item.targetBuy.toFixed(2)}
                              </button>
                            ) : (
                              <button
                                onClick={() => { setEditingId(item.id); setEditValue(''); }}
                                className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-1.5 py-0.5"
                              >
                                set £
                              </button>
                            )}
                          </td>
                          {/* News */}
                          <td className="px-3 py-3 text-center">
                            {rnsCount + pressCount > 0 ? (
                              <div className="inline-flex flex-col items-start leading-tight text-xs text-gray-400">
                                <span>{rnsCount} RNS</span>
                                <span>{pressCount} press</span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-600">view ›</span>
                            )}
                          </td>
                          {/* Risk */}
                          <td className="px-3 py-3 text-center">
                            {q && q.riskScore > 0 ? (
                              <span
                                className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold text-white"
                                style={{ backgroundColor: riskColor(q.riskScore) }}
                                title="Volatility 1 (calm) – 10 (volatile), from 1-year price movement"
                              >
                                {q.riskScore}
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* News panel */}
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 lg:sticky lg:top-20">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <div className="text-xs font-medium text-gray-400">
                  NEWS{' '}
                  {selectedItem && (
                    <span className="text-gray-300">· {bareTicker(selectedItem.ticker)} · <span className="text-gray-500">{selectedItem.name}</span></span>
                  )}
                </div>
              </div>
              <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-800/70">
                {!selectedItem && <div className="px-4 py-6 text-sm text-gray-500">Select a stock to see its news.</div>}

                {selectedPress.map((n, i) => (
                  <a
                    key={`press-${i}`}
                    href={n.url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-3 hover:bg-gray-800/40 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 shrink-0">{n.source}</span>
                      <span className="text-[10px] text-gray-500 shrink-0">{relativeAge(n.date)}</span>
                    </div>
                    <p className="text-xs text-gray-300 leading-snug">{n.title}</p>
                  </a>
                ))}

                {selectedRns.map((n, i) => (
                  <a
                    key={`rns-${i}`}
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-3 hover:bg-gray-800/40 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">RNS</span>
                      <span className="text-[10px] text-gray-500">{relativeAge(n.date)}</span>
                    </div>
                    <p className="text-xs text-gray-300 leading-snug">{n.headline}</p>
                  </a>
                ))}

                {selectedItem && selectedRns.length === 0 && selectedPress.length === 0 && (
                  <div className="px-4 py-6 text-sm text-gray-500">No recent news found.</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-gray-500">
          Shared club watchlist · prices, trend &amp; volatility from Yahoo Finance · RNS from Investegate · press from Google News.
          Click a row to load its news. Volatility = 1-year price movement (1 calm – 10 volatile).
        </div>
      </div>
    </div>
  );
}
