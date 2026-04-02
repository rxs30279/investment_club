'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { Dividend, Transaction, PortfolioSummary } from '@/types';
import {
  getTransactions,
  calculatePositions,
  fetchPrices,
  calculatePortfolioSummary,
  getDividends,
  saveDividends,
} from '@/lib/portfolio';

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) =>
  `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Cost calculations ─────────────────────────────────────────────────────────

const DEALING_FEE = 9;
const STAMP_DUTY  = 0.005;

function calcYTDCosts(
  transactions: Transaction[],
  stampDutyEnabled: boolean,
  stampDutyExclusions: Set<number>
): { dealing: number; stampDuty: number; total: number } {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const ytd = transactions.filter(tx => new Date(tx.date) >= yearStart);
  let dealing = 0, stampDuty = 0;
  for (const tx of ytd) {
    dealing += DEALING_FEE;
    if (tx.type === 'buy' && stampDutyEnabled && !stampDutyExclusions.has(tx.holdingId))
      stampDuty += tx.totalCost * STAMP_DUTY;
  }
  return { dealing, stampDuty, total: dealing + stampDuty };
}

function calcYTDDividends(dividends: Dividend[]): number {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  return dividends.filter(d => new Date(d.date) >= yearStart).reduce((s, d) => s + d.amount, 0);
}

function calcYTDCustodyFee(portfolioValue: number): { quartersElapsed: number; total: number } {
  const month = new Date().getMonth();
  const quartersElapsed = Math.floor(month / 3) + 1;
  const feePerQuarter = portfolioValue * 0.0005;
  return { quartersElapsed, total: feePerQuarter * quartersElapsed };
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent, className }: {
  label: string; value: string; sub?: string;
  accent?: 'green' | 'red' | 'blue' | 'amber' | 'neutral';
  className?: string;
}) {
  const cls = { green: 'text-emerald-400', red: 'text-red-400', blue: 'text-blue-400',
    amber: 'text-amber-400', neutral: 'text-white' }[accent ?? 'neutral'];
  return (
    <div className={`bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-4 sm:px-5 sm:py-5 ${className ?? ''}`}>
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${cls}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PortfolioFeesPage() {
  const [portfolio,           setPortfolio]           = useState<PortfolioSummary | null>(null);
  const [transactions,        setTransactions]        = useState<Transaction[]>([]);
  const [dividends,           setDividends]           = useState<Dividend[]>([]);
  const [loading,             setLoading]             = useState(true);
  const [error,               setError]               = useState<string | null>(null);

  const [stampDutyEnabled,    setStampDutyEnabled]    = useState(true);
  const [stampDutyExclusions, setStampDutyExclusions] = useState<Set<number>>(new Set());
  const [showStampDuty,       setShowStampDuty]       = useState(false);

  const [showAddDividend, setShowAddDividend] = useState(false);
  const [newDividend, setNewDividend] = useState({
    holdingId: 0, date: new Date().toISOString().split('T')[0], amount: 0, notes: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [txs, divs, prices] = await Promise.all([getTransactions(), getDividends(), fetchPrices()]);
      const positions = await calculatePositions(txs, prices);
      const summary   = calculatePortfolioSummary(positions);
      setTransactions(txs); setDividends(divs); setPortfolio(summary);
    } catch (err) {
      console.error(err);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const custodyFee     = calcYTDCustodyFee(portfolio?.totalValue ?? 0);
  const ytdDividends   = calcYTDDividends(dividends);
  const ytdCosts       = calcYTDCosts(transactions, stampDutyEnabled, stampDutyExclusions);
  const totalDividends = dividends.reduce((s, d) => s + d.amount, 0);

  const handleAddDividend = async () => {
    if (!newDividend.holdingId || newDividend.amount <= 0) {
      alert('Please select a holding and enter a valid amount'); return;
    }
    const div: Dividend = {
      id: Math.max(...dividends.map(d => d.id), 0) + 1,
      holdingId: newDividend.holdingId, date: newDividend.date,
      amount: newDividend.amount, currency: 'GBP', notes: newDividend.notes,
    };
    const updated = [...dividends, div];
    await saveDividends(updated);
    setDividends(updated);
    setShowAddDividend(false);
    setNewDividend({ holdingId: 0, date: new Date().toISOString().split('T')[0], amount: 0, notes: '' });
  };

  const handleDeleteDividend = async (id: number) => {
    if (!confirm('Delete this dividend?')) return;
    const updated = dividends.filter(d => d.id !== id);
    await saveDividends(updated); setDividends(updated);
  };

  const toggleStampDutyExclusion = (holdingId: number) => {
    setStampDutyExclusions(prev => {
      const next = new Set(prev);
      next.has(holdingId) ? next.delete(holdingId) : next.add(holdingId);
      return next;
    });
  };

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto" />
          <p className="mt-3 text-gray-400 text-sm">Loading fees data...</p>
        </div>
      </div>
    </div>
  );

  if (error || !portfolio) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center">
          <p className="text-red-400">{error ?? 'Failed to load data'}</p>
          <button onClick={loadData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Try Again</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Fees &amp; Divs</h1>
          <p className="text-sm text-gray-400 mt-1">
            Dividends &amp; running costs · {new Date().getFullYear()} · Resets each January
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <StatCard
            label="YTD Dividends"
            value={fmtCurrency(ytdDividends)}
            sub={`${fmtCurrency(totalDividends)} all time`}
            accent="green"
          />
          <StatCard
            label="YTD Running Costs"
            value={fmtCurrency(ytdCosts.total)}
            sub={`Dealing ${fmtCurrency(ytdCosts.dealing)} · Stamp ${fmtCurrency(ytdCosts.stampDuty)}`}
            accent="amber"
          />
          <StatCard
            label="YTD Custody Fee (est.)"
            value={fmtCurrency(custodyFee.total)}
            sub={`${custodyFee.quartersElapsed}Q × ${fmtCurrency(portfolio.totalValue * 0.0005)} @ 0.2% p.a.`}
            accent="amber"
            className=""
          />
        </div>

        {/* Dividends */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden mb-6">
          <div className="flex justify-between items-center px-4 sm:px-6 py-4 border-b border-gray-800">
            <h2 className="text-white font-semibold">Dividend Income</h2>
            <button onClick={() => setShowAddDividend(!showAddDividend)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs">
              + Add Dividend
            </button>
          </div>

          {showAddDividend && (
            <div className="p-4 sm:p-6 border-b border-gray-800 bg-gray-800/30">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <select value={newDividend.holdingId}
                  onChange={e => setNewDividend({ ...newDividend, holdingId: parseInt(e.target.value) })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm">
                  <option value={0}>Select Holding</option>
                  {portfolio.holdings.map(h => (
                    <option key={h.holdingId} value={h.holdingId}>{h.name}</option>
                  ))}
                </select>
                <input type="date" value={newDividend.date}
                  onChange={e => setNewDividend({ ...newDividend, date: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" />
                <input type="number" placeholder="Amount (£)" value={newDividend.amount || ''}
                  onChange={e => setNewDividend({ ...newDividend, amount: parseFloat(e.target.value) })}
                  step="0.01"
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" />
                <input type="text" placeholder="Notes (optional)" value={newDividend.notes}
                  onChange={e => setNewDividend({ ...newDividend, notes: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 text-sm" />
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleAddDividend}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm">
                  Save Dividend
                </button>
                <button onClick={() => setShowAddDividend(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Date', 'Company', 'Amount', 'Notes', 'Actions'].map((h, i) => (
                    <th key={h} className={`${i === 3 ? 'hidden sm:table-cell' : ''} text-gray-500 text-xs uppercase tracking-wider px-4 sm:px-6 py-3 font-medium ${
                      i === 2 ? 'text-right' : i === 4 ? 'text-center' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dividends]
                  .filter(d => new Date(d.date) >= new Date(new Date().getFullYear(), 0, 1))
                  .reverse()
                  .map(div => (
                  <tr key={div.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 sm:px-6 py-3 text-gray-300">{div.date}</td>
                    <td className="px-4 sm:px-6 py-3 text-white">
                      {portfolio.holdings.find(h => h.holdingId === div.holdingId)?.name ?? `Holding ${div.holdingId}`}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-right text-emerald-400 font-mono">{fmtCurrency(div.amount)}</td>
                    <td className="hidden sm:table-cell px-4 sm:px-6 py-3 text-gray-400">{div.notes || '—'}</td>
                    <td className="px-4 sm:px-6 py-3 text-center">
                      <button onClick={() => handleDeleteDividend(div.id)}
                        className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
                {ytdDividends === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 text-sm">
                      No dividends recorded for {new Date().getFullYear()} — click &quot;+ Add Dividend&quot; to start tracking.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t border-gray-800">
                <tr>
                  <td colSpan={2} className="px-4 sm:px-6 py-3 text-right text-gray-400 text-sm font-medium">{new Date().getFullYear()} Total</td>
                  <td className="px-4 sm:px-6 py-3 text-right font-bold text-emerald-400 font-mono">{fmtCurrency(ytdDividends)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Stamp Duty Settings */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 mb-6">
          <button
            onClick={() => setShowStampDuty(v => !v)}
            className="w-full flex justify-between items-center px-4 sm:px-6 py-4 text-left"
          >
            <h2 className="text-white font-semibold text-sm">Stamp Duty Settings</h2>
            <span className="text-gray-400 text-xs">{showStampDuty ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {showStampDuty && (
            <div className="px-4 sm:px-6 pb-4 border-t border-gray-800 pt-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <p className="text-gray-400 text-xs">Enable or disable stamp duty (0.5%) on buy transactions</p>
                <label className="flex items-center gap-2 cursor-pointer" onClick={() => setStampDutyEnabled(v => !v)}>
                  <div className={`w-10 h-5 rounded-full transition-colors relative ${stampDutyEnabled ? 'bg-emerald-600' : 'bg-gray-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${stampDutyEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <span className="text-gray-300 text-xs">Stamp Duty (0.5%) on buys</span>
                </label>
              </div>

              {stampDutyEnabled && (
                <div className="mb-3">
                  <p className="text-gray-500 text-xs mb-2">Click a holding to exclude it from stamp duty (e.g. ETFs, Investment Trusts):</p>
                  <div className="flex flex-wrap gap-2">
                    {portfolio.holdings.map(h => {
                      const excluded = stampDutyExclusions.has(h.holdingId);
                      return (
                        <button key={h.holdingId} onClick={() => toggleStampDutyExclusion(h.holdingId)}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            excluded
                              ? 'border-gray-600 text-gray-500'
                              : 'border-emerald-600 text-emerald-400 bg-emerald-600/10'
                          }`}>
                          {excluded ? '✕ ' : '✓ '}{h.name.length > 18 ? h.name.slice(0, 16) + '…' : h.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs pt-3 border-t border-gray-800">
                <div>
                  <span className="text-gray-500">Dealing fee</span>
                  <p className="text-white font-medium mt-0.5">£9 per buy &amp; sell</p>
                </div>
                <div>
                  <span className="text-gray-500">Stamp duty</span>
                  <p className="text-white font-medium mt-0.5">0.5% on buys</p>
                </div>
                <div>
                  <span className="text-gray-500">YTD transactions</span>
                  <p className="text-white font-medium mt-0.5">
                    {transactions.filter(tx =>
                      new Date(tx.date) >= new Date(new Date().getFullYear(), 0, 1)
                    ).length} trades
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Custody fee</span>
                  <p className="text-white font-medium mt-0.5">0.2% p.a. charged quarterly</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-xs text-gray-500 pb-4">
          £9 dealing fee per transaction · 0.5% stamp duty on buys (where applicable) · 0.2% p.a. custody fee (est.) · Resets each 1 January
        </div>
      </div>
    </div>
  );
}
