'use client';

// /income — Dividend income page (formerly the "Income Corner" section of the
// monthly brief). Live trailing-12m dividend data per holding from Yahoo Finance,
// rendered as a persistent page rather than a once-a-month AI snapshot.

import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import { getTransactions, calculatePositions, fetchPrices, getDividends } from '@/lib/portfolio';

interface DividendEvent { date: string; amount: number; }
interface IncomeHolding {
  ticker:       string;
  name:         string;
  currentValue: number | null;
  ownedSince:   string | null;
  lastExDiv:    string | null;
  lastAmount:   number | null;
  annualPence:  number | null;
  yieldPct:     number | null;
  divs:         DividendEvent[];
}

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) =>
  `£${v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

// Compact form for the dense history rows, e.g. "14 Mar 26".
function fmtShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  } catch { return iso; }
}

// Decide which Yahoo ex-dividend events the club has actually received, by
// pairing each recorded dividend payment (from the DB) to the most recent
// ex-div date on/before it. Payments land a few weeks after a share goes ex,
// so a recorded date falls AFTER its ex-div date (a small tolerance allows for
// records keyed to the ex-div date itself). Each recorded payment matches at
// most one ex-div event, so a holding with one payment never marks two ex-divs.
// Returns a set of "ticker|exDivDate" keys.
function computeReceivedSet(
  holdings: IncomeHolding[],
  recordedDatesByTicker: Map<string, string[]>,
): Set<string> {
  const WINDOW_DAYS = 120;   // a payment shouldn't trail its ex-div by more than ~4 months
  const TOLERANCE_DAYS = 7;  // recorded date may sit a few days before Yahoo's ex-div date
  const received = new Set<string>();

  for (const h of holdings) {
    const recs = (recordedDatesByTicker.get(h.ticker) ?? []).slice().sort();
    if (recs.length === 0) continue;
    const events = [...h.divs].sort((a, b) => a.date.localeCompare(b.date));
    const used = new Set<number>();

    for (const recDate of recs) {
      const recMs = new Date(recDate).getTime();
      let bestIdx = -1;
      for (let i = 0; i < events.length; i++) {
        if (used.has(i)) continue;
        const days = (recMs - new Date(events[i].date).getTime()) / 86_400_000;
        if (days >= -TOLERANCE_DAYS && days <= WINDOW_DAYS) bestIdx = i; // latest qualifying
      }
      if (bestIdx >= 0) {
        used.add(bestIdx);
        received.add(`${h.ticker}|${events[bestIdx].date}`);
      }
    }
  }
  return received;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string;
  accent?: 'green' | 'amber' | 'neutral';
}) {
  const cls = { green: 'text-emerald-400', amber: 'text-amber-400', neutral: 'text-white' }[accent ?? 'neutral'];
  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${cls}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IncomePage() {
  const [holdings, setHoldings]   = useState<IncomeHolding[]>([]);
  const [received, setReceived]   = useState<Set<string>>(new Set());
  const [ftseYield, setFtseYield] = useState(3.5);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const tx        = await getTransactions();
        const prices    = await fetchPrices();
        const positions = await calculatePositions(tx, prices);

        // Earliest buy date per holding — dividends that went ex before this
        // are filtered out server-side (the club didn't own the shares yet).
        const firstBuyByHid = new Map<number, string>();
        for (const t of tx) {
          if (t.type !== 'buy') continue;
          const cur = firstBuyByHid.get(t.holdingId);
          if (!cur || t.date < cur) firstBuyByHid.set(t.holdingId, t.date);
        }

        const res = await fetch('/api/income', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positions: positions.map(p => ({
              ticker:       p.ticker,
              name:         p.name,
              currentPrice: p.currentPrice,
              currentValue: p.currentValue,
              ownedSince:   firstBuyByHid.get(p.holdingId) ?? null,
            })),
          }),
        });
        if (!res.ok) throw new Error('Failed to load dividend data');
        const data = await res.json();
        const holdingsData: IncomeHolding[] = data.holdings ?? [];
        setHoldings(holdingsData);
        if (typeof data.ftseAvgYield === 'number') setFtseYield(data.ftseAvgYield);

        // Match the club's recorded dividend payments (DB) to these ex-div events.
        const recorded     = await getDividends();
        const tickerByHid  = new Map(positions.map(p => [p.holdingId, p.ticker]));
        const recByTicker  = new Map<string, string[]>();
        for (const r of recorded) {
          const ticker = tickerByHid.get(r.holdingId);
          if (!ticker) continue;
          const arr = recByTicker.get(ticker);
          if (arr) arr.push(r.date);
          else recByTicker.set(ticker, [r.date]);
        }
        setReceived(computeReceivedSet(holdingsData, recByTicker));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const payers = holdings
    .filter(h => h.divs.length > 0)
    .sort((a, b) => (b.yieldPct ?? -1) - (a.yieldPct ?? -1));

  // Widest payment count drives how many dividend columns the history table needs.
  const maxDivs = payers.reduce((m, h) => Math.max(m, h.divs.length), 0);

  const totalValue  = holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
  const annualIncome = payers.reduce(
    (s, h) => s + (h.currentValue && h.yieldPct ? (h.currentValue * h.yieldPct) / 100 : 0),
    0,
  );
  const portfolioYield = totalValue ? (annualIncome / totalValue) * 100 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Income</h1>
          <p className="text-sm text-gray-400 mt-1">
            Trailing 12-month dividends per holding — live from Yahoo Finance
          </p>
        </div>

        {loading && (
          <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto" />
            <p className="text-gray-500 text-sm mt-3">Loading dividend data…</p>
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-900/20 border border-red-700 rounded-xl p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
              <StatCard
                label="Est. portfolio yield"
                value={`${portfolioYield.toFixed(2)}%`}
                sub={`FTSE 100 avg ~${ftseYield}%`}
                accent={portfolioYield >= ftseYield ? 'green' : 'amber'}
              />
              <StatCard
                label="Est. annual income"
                value={fmtCurrency(annualIncome)}
                sub="On current holdings"
              />
            </div>

            {/* Table */}
            {payers.length === 0 ? (
              <div className="text-center py-10 text-gray-600 text-sm border border-dashed border-gray-800 rounded-xl">
                No dividend data found for the current holdings.
              </div>
            ) : (
              <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {[
                          { label: 'Company',     title: '' },
                          { label: 'Last Ex-Div', title: 'Most recent ex-dividend date in the last 12 months' },
                          { label: 'Amount (p)',  title: 'Most recent dividend, per share, in pence' },
                          { label: 'Annual (p)',  title: 'Total dividends per share over the last 12 months, in pence' },
                          { label: 'Yield',       title: 'Trailing 12-month dividends ÷ current share price' },
                        ].map((col, i) => (
                          <th
                            key={col.label}
                            title={col.title || undefined}
                            className={`text-gray-500 text-xs uppercase tracking-wider px-4 sm:px-6 py-3 font-medium whitespace-nowrap ${
                              i === 0 ? 'text-left' : 'text-right'
                            } ${col.title ? 'cursor-help' : ''}`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {payers.map(h => (
                        <tr key={h.ticker} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 sm:px-6 py-3">
                            <div className="text-white">{h.name}</div>
                            <div className="text-gray-500 text-xs">{h.ticker}</div>
                          </td>
                          <td className="px-4 sm:px-6 py-3 text-right whitespace-nowrap">
                            {h.lastExDiv && h.ownedSince && h.lastExDiv < h.ownedSince ? (
                              <span className="text-gray-600" title="Went ex before the club owned this holding">
                                {fmtDate(h.lastExDiv)} †
                              </span>
                            ) : h.lastExDiv && received.has(`${h.ticker}|${h.lastExDiv}`) ? (
                              <span className="text-emerald-400">
                                {fmtDate(h.lastExDiv)} <span title="Received by the club">✓</span>
                              </span>
                            ) : (
                              <span className="text-gray-300">{fmtDate(h.lastExDiv)}</span>
                            )}
                          </td>
                          <td className="px-4 sm:px-6 py-3 text-right text-gray-300 font-mono">
                            {h.lastAmount != null ? h.lastAmount.toFixed(2) : '—'}
                          </td>
                          <td className="px-4 sm:px-6 py-3 text-right text-gray-300 font-mono">
                            {h.annualPence != null ? h.annualPence.toFixed(2) : '—'}
                          </td>
                          <td className="px-4 sm:px-6 py-3 text-right text-white font-mono font-semibold">
                            {h.yieldPct != null ? `${h.yieldPct.toFixed(2)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {payers.length > 0 && (
              <p className="text-xs text-gray-500 mt-3">
                <span className="text-gray-400">{payers.length} of {holdings.length} holdings</span> pay a dividend.
                {' '}<span className="text-gray-400">Yield</span> is trailing 12-month dividends as a % of the current
                share price. A <span className="text-emerald-400">green ✓</span> on the last ex-div date means that
                payment is already recorded as received in the club&rsquo;s records.
              </p>
            )}

            {/* Per-holding 12-month history */}
            {payers.length > 0 && (
              <details className="mt-6 bg-gray-900/50 border border-gray-800 rounded-xl">
                <summary className="px-4 sm:px-6 py-3 cursor-pointer text-emerald-400 text-sm font-medium select-none">
                  Dividend history (last 12 months)
                </summary>
                <div className="px-4 sm:px-6 pb-4 pt-1 border-t border-gray-800">
                  <p className="text-gray-500 text-xs mb-3">
                    Each holding&rsquo;s ex-dividend payments over the last 12 months — amount paid per share
                    (pence), most recent first. These add up to the &ldquo;Annual (p)&rdquo; column above.
                    {' '}A <span className="text-emerald-400">green ✓</span> marks a payment matched to a dividend
                    already recorded as received in the club&rsquo;s records.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="text-gray-500 text-xs uppercase tracking-wider px-3 sm:px-4 py-2 font-medium text-left whitespace-nowrap">
                            Company
                          </th>
                          <th
                            colSpan={maxDivs}
                            className="text-gray-500 text-xs uppercase tracking-wider px-3 sm:px-4 py-2 font-medium text-right whitespace-nowrap"
                          >
                            Dividends (most recent → older)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {payers.map(h => (
                          <tr key={h.ticker} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                            <td className="px-3 sm:px-4 py-3 whitespace-nowrap align-top text-white">
                              {h.name}
                            </td>
                            {Array.from({ length: maxDivs }).map((_, i) => {
                              const d = h.divs[i];
                              const preOwned  = d && h.ownedSince ? d.date < h.ownedSince : false;
                              const isReceived = d && !preOwned ? received.has(`${h.ticker}|${d.date}`) : false;
                              return (
                                <td key={i} className="px-3 sm:px-4 py-3 text-right whitespace-nowrap align-top">
                                  {d ? (
                                    <>
                                      <div className="font-mono">
                                        <span
                                          className={preOwned ? 'text-gray-400' : isReceived ? 'text-emerald-400' : 'text-gray-300'}
                                          style={preOwned ? { textDecoration: 'line-through' } : undefined}
                                        >
                                          {d.amount.toFixed(2)}p
                                        </span>
                                        {preOwned && (
                                          <span className="text-gray-500 ml-1" title="Went ex before the club owned this holding">†</span>
                                        )}
                                        {isReceived && (
                                          <span className="text-emerald-400 ml-1" title="Received by the club">✓</span>
                                        )}
                                      </div>
                                      <div className={preOwned ? 'text-gray-700 text-xs' : 'text-gray-600 text-xs'}>{fmtShortDate(d.date)}</div>
                                    </>
                                  ) : (
                                    <span className="text-gray-700">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            )}

            <p className="text-xs text-gray-600 mt-6">
              <span className="text-gray-500">†</span> Greyed-out dividends went ex before the club owned the
              holding, so they were not received — they are shown for reference and still count towards the
              stock&rsquo;s trailing yield. <span className="text-emerald-400">✓</span> marks dividends recorded as
              received in the club&rsquo;s records.
            </p>
            <p className="text-xs text-gray-600 mt-2">
              Yields are estimates based on the last 12 months of declared dividends and the current share
              price. They are not forecasts and do not constitute financial advice.
            </p>
          </>
        )}

      </div>
    </div>
  );
}
