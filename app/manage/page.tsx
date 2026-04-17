'use client';

import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import PasswordProtect from '@/components/PasswordProtect';
import { Transaction, Position } from '@/types';
import {
  getTransactions,
  getHoldingsReference,
  calculatePositions,
  fetchPrices,
  calculatePortfolioSummary,
  saveTransactions,
  saveHolding
} from '@/lib/portfolio';
import { getUnitValues, fetchBenchmarkData } from '@/lib/performance';
import { supabase } from '@/lib/supabase';

// Helper for formatting
const formatCurrency = (value: number): string => {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function ManagePageContent() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [holdingsRef, setHoldingsRef] = useState<any[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSellForm, setShowSellForm] = useState<number | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [nextId, setNextId] = useState(22);
  const [loading, setLoading] = useState(true);
  
  const [newTransaction, setNewTransaction] = useState({
    name: '',
    ticker: '',
    type: 'buy' as 'buy' | 'sell',
    shares: 0,
    pricePerShare: 0,
    date: new Date().toISOString().split('T')[0],
    sector: 'Other',
    holdingId: 0,
  });
  
  const [sellTransaction, setSellTransaction] = useState({
    holdingId: 0,
    shares: 0,
    pricePerShare: 0,
    date: new Date().toISOString().split('T')[0],
  });

  const [editTransaction, setEditTransaction] = useState({
    shares: 0,
    pricePerShare: 0,
    date: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const tx = await getTransactions();
      const holdings = await getHoldingsReference();
      setTransactions(tx);
      setHoldingsRef(holdings);
      setNextId(Math.max(...tx.map(t => t.id), 0) + 1);
      
      const prices = await fetchPrices();
      const calculatedPositions = await calculatePositions(tx, prices);
      setPositions(calculatedPositions);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getCompanyName = (holdingId: number): string => {
    const holding = holdingsRef.find(h => h.id === holdingId);
    return holding?.name || `Holding ${holdingId}`;
  };

  const manualRefresh = async () => {
    const prices = await fetchPrices();
    const calculatedPositions = await calculatePositions(transactions, prices);
    setPositions(calculatedPositions);
    alert(`Positions refreshed! ${calculatedPositions.length} active positions found.`);
  };

  const handleAddTransaction = async () => {
    if (newTransaction.type === 'sell') {
      if (!newTransaction.name || newTransaction.shares <= 0 || newTransaction.pricePerShare <= 0) {
        alert('Please select a stock and fill all fields correctly');
        return;
      }
      
      const existingPosition = positions.find(p => p.name === newTransaction.name);
      if (!existingPosition) {
        alert('Selected stock not found in portfolio');
        return;
      }
      
      if (newTransaction.shares > existingPosition.shares) {
        alert(`Cannot sell more than you own. You have ${existingPosition.shares} shares.`);
        return;
      }
      
      const totalCost = newTransaction.shares * newTransaction.pricePerShare;
      
      const transaction: Transaction = {
        id: nextId,
        holdingId: existingPosition.holdingId,
        type: 'sell',
        date: newTransaction.date,
        shares: newTransaction.shares,
        pricePerShare: newTransaction.pricePerShare,
        totalCost,
        commission: 5,
      };
      
      const updatedTransactions = [...transactions, transaction];
      await saveTransactions(updatedTransactions);
      setTransactions(updatedTransactions);
      setNextId(nextId + 1);
      setShowAddForm(false);
      
      const prices = await fetchPrices();
      const calculatedPositions = await calculatePositions(updatedTransactions, prices);
      setPositions(calculatedPositions);
      
      alert(`Sale recorded! Sold ${newTransaction.shares} shares of ${newTransaction.name}`);
      
      setNewTransaction({
        name: '',
        ticker: '',
        type: 'buy',
        shares: 0,
        pricePerShare: 0,
        date: new Date().toISOString().split('T')[0],
        sector: 'Other',
        holdingId: 0,
      });
      return;
    }
    
    // For buys
    if (!newTransaction.name || !newTransaction.ticker || newTransaction.shares <= 0 || newTransaction.pricePerShare <= 0) {
      alert('Please fill all fields correctly');
      return;
    }

    const holdingId = nextId;
    const totalCost = newTransaction.shares * newTransaction.pricePerShare;
    
    const transaction: Transaction = {
      id: nextId,
      holdingId,
      type: newTransaction.type,
      date: newTransaction.date,
      shares: newTransaction.shares,
      pricePerShare: newTransaction.pricePerShare,
      totalCost,
      commission: 5,
    };
    
    const newHolding = {
      id: holdingId,
      name: newTransaction.name,
      ticker: newTransaction.ticker,
      sector: newTransaction.sector,
    };
    
    const updatedTransactions = [...transactions, transaction];
    const updatedHoldings = [...holdingsRef, newHolding];
    
    // Save to Supabase
    await saveTransactions(updatedTransactions);
    await saveHolding(newHolding);
    
    setTransactions(updatedTransactions);
    setHoldingsRef(updatedHoldings);
    setNextId(nextId + 1);
    setShowAddForm(false);
    
    const prices = await fetchPrices();
    const calculatedPositions = await calculatePositions(updatedTransactions, prices);
    setPositions(calculatedPositions);
    
    alert(`Added ${newTransaction.type.toUpperCase()} transaction successfully!`);
    
    setNewTransaction({
      name: '',
      ticker: '',
      type: 'buy',
      shares: 0,
      pricePerShare: 0,
      date: new Date().toISOString().split('T')[0],
      sector: 'Other',
      holdingId: 0,
    });
  };

  const handleSell = async () => {
    if (!sellTransaction.holdingId || sellTransaction.shares <= 0 || sellTransaction.pricePerShare <= 0) {
      alert('Please fill all fields correctly');
      return;
    }
    
    const position = positions.find(p => p.holdingId === sellTransaction.holdingId);
    if (!position) {
      alert('Holding not found');
      return;
    }
    
    if (sellTransaction.shares > position.shares) {
      alert(`Cannot sell more than you own. You have ${position.shares} shares.`);
      return;
    }
    
    const confirmMessage = `Confirm Sale:\n\n` +
      `Company: ${position.name}\n` +
      `Holding ID: ${position.holdingId}\n` +
      `Current shares: ${position.shares}\n` +
      `Shares to sell: ${sellTransaction.shares}\n` +
      `Price: £${sellTransaction.pricePerShare.toFixed(4)}\n` +
      `New shares after sale: ${position.shares - sellTransaction.shares}`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    const totalCost = sellTransaction.shares * sellTransaction.pricePerShare;
    
    const newTransaction: Transaction = {
      id: nextId,
      holdingId: position.holdingId,
      type: 'sell',
      date: sellTransaction.date,
      shares: sellTransaction.shares,
      pricePerShare: sellTransaction.pricePerShare,
      totalCost,
      commission: 5,
    };
    
    const updatedTransactions = [...transactions, newTransaction];
    
    await saveTransactions(updatedTransactions);
    
    setTransactions(updatedTransactions);
    setNextId(nextId + 1);
    setShowSellForm(null);
    
    setSellTransaction({
      holdingId: 0,
      shares: 0,
      pricePerShare: 0,
      date: new Date().toISOString().split('T')[0],
    });
    
    const prices = await fetchPrices();
    const calculatedPositions = await calculatePositions(updatedTransactions, prices);
    setPositions(calculatedPositions);
    
    const updatedPosition = calculatedPositions.find(p => p.holdingId === position.holdingId);
    const newShareCount = updatedPosition ? updatedPosition.shares : 0;
    
    alert(`Sale completed!\n\nSold: ${sellTransaction.shares} shares\nRemaining: ${newShareCount} shares`);
  };

  const handleDeleteTransaction = async (transactionId: number) => {
    const transactionToDelete = transactions.find(t => t.id === transactionId);
    if (!transactionToDelete) return;
    
    const confirmMessage = `Delete this ${transactionToDelete.type.toUpperCase()} transaction?\n\n` +
      `Company: ${getCompanyName(transactionToDelete.holdingId)}\n` +
      `Date: ${transactionToDelete.date}\n` +
      `Shares: ${transactionToDelete.shares}\n` +
      `Price: £${transactionToDelete.pricePerShare.toFixed(4)}\n\n` +
      `This will recalculate your positions. This action cannot be undone.`;
    
    if (confirm(confirmMessage)) {
      const updatedTransactions = transactions.filter(t => t.id !== transactionId);
      await saveTransactions(updatedTransactions);
      setTransactions(updatedTransactions);
      
      const prices = await fetchPrices();
      const calculatedPositions = await calculatePositions(updatedTransactions, prices);
      setPositions(calculatedPositions);
      
      alert('Transaction deleted. Positions recalculated.');
    }
  };

  const handleEditTransaction = async () => {
    if (!editingTransaction) return;
    
    if (editTransaction.shares <= 0 || editTransaction.pricePerShare <= 0 || !editTransaction.date) {
      alert('Please fill all fields correctly');
      return;
    }
    
    const totalCost = editTransaction.shares * editTransaction.pricePerShare;
    
    const updatedTransaction: Transaction = {
      ...editingTransaction,
      shares: editTransaction.shares,
      pricePerShare: editTransaction.pricePerShare,
      totalCost,
      date: editTransaction.date,
    };
    
    const updatedTransactions = transactions.map(t => 
      t.id === editingTransaction.id ? updatedTransaction : t
    );
    
    await saveTransactions(updatedTransactions);
    setTransactions(updatedTransactions);
    setEditingTransaction(null);
    
    const prices = await fetchPrices();
    const calculatedPositions = await calculatePositions(updatedTransactions, prices);
    setPositions(calculatedPositions);
    
    alert('Transaction updated successfully!');
  };

  const startEditing = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditTransaction({
      shares: transaction.shares,
      pricePerShare: transaction.pricePerShare,
      date: transaction.date,
    });
  };

  // ── Monthly Brief generation ───────────────────────────────────────────────
  type BriefStatus = 'idle' | 'fetching' | 'generating' | 'done' | 'error';
  const [briefStatus, setBriefStatus] = useState<BriefStatus>('idle');
  const [briefError,  setBriefError]  = useState<string | null>(null);

  function reportMonthLabel() {
    return new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  function currentDateLabel() {
    return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  async function generateBrief() {
    setBriefStatus('fetching');
    setBriefError(null);
    try {
      const [tx, prices, unitValues] = await Promise.all([
        getTransactions(), fetchPrices(), getUnitValues(),
      ]);
      const pos = await calculatePositions(tx, prices);
      const tickers = pos.map((p: any) => p.ticker).filter(Boolean);

      // Load member articles from the last 2 months for inclusion in the brief
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 2);
      const { data: articlesData } = await supabase
        .from('member_articles')
        .select('contributor_name, title, body')
        .gte('added_at', cutoff.toISOString())
        .order('added_at', { ascending: false });
      const userArticles: string = articlesData?.length
        ? articlesData.map((a: any) => `[${a.contributor_name}] "${a.title}"\n${a.body}`).join('\n\n---\n\n')
        : '';

      const [mpRes, benchmarks] = await Promise.all([
        fetch('/api/monthly-performance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers }),
        }),
        fetchBenchmarkData((() => {
          const d = new Date(); d.setMonth(d.getMonth() - 3);
          return d.toISOString().split('T')[0];
        })()),
      ]);
      const monthlyPerf = mpRes.ok ? await mpRes.json() : {};
      setBriefStatus('generating');
      const res = await fetch('/api/monthly-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positions: pos, monthlyPerf, unitValues,
          ftse100: benchmarks.ftse100, ftse250: benchmarks.ftse250,
          reportMonth: reportMonthLabel(), currentDate: currentDateLabel(),
          userArticles,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `Request failed: ${res.status}`);
      }
      const { html, error: reportError, dbError } = await res.json();
      if (reportError) throw new Error(reportError);
      if (!html) throw new Error('No HTML content returned.');
      if (dbError) console.warn('[monthly-brief] Report generated but DB save failed:', dbError);
      setBriefStatus('done');
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : String(err));
      setBriefStatus('error');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
              <p className="mt-4 text-gray-400">Loading portfolio data...</p>
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
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Portfolio Management</h1>
            <p className="text-sm text-gray-400 mt-1">
              Add, edit, or delete transactions • All changes automatically recalculate positions
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + New Transaction
          </button>
        </div>

        {/* Edit Modal */}
        {editingTransaction && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
              <h3 className="text-white font-semibold mb-4">
                Edit Transaction: {getCompanyName(editingTransaction.holdingId)}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Type</label>
                  <div className="text-white bg-gray-700/50 rounded-lg px-4 py-2">
                    {editingTransaction.type.toUpperCase()}
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Shares</label>
                  <input
                    type="number"
                    value={editTransaction.shares}
                    onChange={(e) => setEditTransaction({ ...editTransaction, shares: parseFloat(e.target.value) })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                    step="1"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Price per Share (£)</label>
                  <input
                    type="number"
                    value={editTransaction.pricePerShare}
                    onChange={(e) => setEditTransaction({ ...editTransaction, pricePerShare: parseFloat(e.target.value) })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Date</label>
                  <input
                    type="date"
                    value={editTransaction.date}
                    onChange={(e) => setEditTransaction({ ...editTransaction, date: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleEditTransaction}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setEditingTransaction(null)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Transaction Form */}
        {showAddForm && (
          <div className="bg-gray-800/80 rounded-xl border border-gray-700 p-6 mb-6">
            <h3 className="text-white font-semibold mb-4">Record New Transaction</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <select
                value={newTransaction.type}
                onChange={(e) => {
                  const newType = e.target.value as 'buy' | 'sell';
                  setNewTransaction({ ...newTransaction, type: newType, name: '', ticker: '', holdingId: 0 });
                }}
                className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
              >
                <option value="buy">Buy / Add Shares</option>
                <option value="sell">Sell Shares</option>
              </select>
              
              {newTransaction.type === 'sell' ? (
                <select
                  value={newTransaction.name}
                  onChange={(e) => {
                    const selectedHolding = positions.find(p => p.name === e.target.value);
                    if (selectedHolding) {
                      setNewTransaction({
                        ...newTransaction,
                        name: selectedHolding.name,
                        ticker: selectedHolding.ticker,
                        holdingId: selectedHolding.holdingId,
                        sector: selectedHolding.sector,
                      });
                    }
                  }}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                >
                  <option value="">Select a stock to sell...</option>
                  {positions.map(pos => (
                    <option key={pos.holdingId} value={pos.name}>
                      {pos.name} (Own: {pos.shares} shares)
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Company Name"
                    value={newTransaction.name}
                    onChange={(e) => setNewTransaction({ ...newTransaction, name: e.target.value })}
                    className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500"
                  />
                  <input
                    type="text"
                    placeholder="Ticker (e.g., BA.L)"
                    value={newTransaction.ticker}
                    onChange={(e) => setNewTransaction({ ...newTransaction, ticker: e.target.value })}
                    className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500"
                  />
                </>
              )}
              
              <input
                type="number"
                placeholder="Number of Shares"
                value={newTransaction.shares || ''}
                onChange={(e) => setNewTransaction({ ...newTransaction, shares: parseFloat(e.target.value) })}
                className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500"
              />
              <input
                type="number"
                placeholder="Price per Share (£)"
                value={newTransaction.pricePerShare || ''}
                onChange={(e) => setNewTransaction({ ...newTransaction, pricePerShare: parseFloat(e.target.value) })}
                className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500"
                step="0.01"
              />
              <input
                type="date"
                placeholder="Transaction Date"
                value={newTransaction.date}
                onChange={(e) => setNewTransaction({ ...newTransaction, date: e.target.value })}
                className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
              />
              
              {newTransaction.type === 'buy' && (
                <select
                  value={newTransaction.sector}
                  onChange={(e) => setNewTransaction({ ...newTransaction, sector: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                >
                  <option>Aerospace</option>
                  <option>Industrials</option>
                  <option>Materials</option>
                  <option>Energy</option>
                  <option>Technology</option>
                  <option>Financials</option>
                  <option>Consumer</option>
                  <option>Other</option>
                </select>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleAddTransaction}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm"
              >
                Record Transaction
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Sell Form Modal */}
        {showSellForm !== null && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
              <h3 className="text-white font-semibold mb-4">
                Sell Shares: {getCompanyName(showSellForm)}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Number of Shares to Sell</label>
                  <input
                    type="number"
                    placeholder="Shares"
                    value={sellTransaction.shares || ''}
                    onChange={(e) => setSellTransaction({ ...sellTransaction, shares: parseFloat(e.target.value) })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Sell Price (£)</label>
                  <input
                    type="number"
                    placeholder="Price per share"
                    value={sellTransaction.pricePerShare || ''}
                    onChange={(e) => setSellTransaction({ ...sellTransaction, pricePerShare: parseFloat(e.target.value) })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Transaction Date</label>
                  <input
                    type="date"
                    value={sellTransaction.date}
                    onChange={(e) => setSellTransaction({ ...sellTransaction, date: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleSell}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm"
                >
                  Confirm Sale
                </button>
                <button
                  onClick={() => setShowSellForm(null)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Current Positions */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-white">Current Positions</h2>
            <button
              onClick={manualRefresh}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-900/80 border-b border-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Company</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Ticker</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Shares</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Avg Cost</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Current Value</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {positions.map((pos) => (
                    <tr key={pos.holdingId} className="hover:bg-gray-800/50">
                      <td className="px-6 py-4 text-white">{pos.name}</td>
                      <td className="px-6 py-4 text-emerald-400 font-mono text-xs">{pos.ticker}</td>
                      <td className="px-6 py-4 text-right text-gray-300">{pos.shares.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right text-gray-300">{formatCurrency(pos.avgCost)}</td>
                      <td className="px-6 py-4 text-right text-gray-300">{formatCurrency(pos.currentValue)}</td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => {
                            setSellTransaction({ ...sellTransaction, holdingId: pos.holdingId });
                            setShowSellForm(pos.holdingId);
                          }}
                          className="px-3 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-xs transition-colors"
                        >
                          Sell
                        </button>
                      </td>
                    </tr>
                  ))}
                  {positions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                        No active positions. Add a transaction to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Transaction History */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Transaction History</h2>
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-900/80 border-b border-gray-800">
                  <tr className="text-left">
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Company</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Shares</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Price</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Fees</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Total</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {[...transactions].reverse().map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-800/50">
                      <td className="px-6 py-3 text-gray-300">{tx.date}</td>
                      <td className="px-6 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          tx.type === 'buy' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'
                        }`}>
                          {tx.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-white">{getCompanyName(tx.holdingId)}</td>
                      <td className="px-6 py-3 text-right text-gray-300">{tx.shares.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right text-gray-300">£{tx.pricePerShare.toFixed(4)}</td>
                      <td className="px-6 py-3 text-right text-gray-300">
                        {tx.commission ? `£${tx.commission.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-300">£{tx.totalCost.toFixed(2)}</td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => startEditing(tx)}
                            className="text-blue-400 hover:text-blue-300 text-xs"
                            title="Edit transaction"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteTransaction(tx.id)}
                            className="text-red-400 hover:text-red-300 text-xs"
                            title="Delete transaction"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-gray-800/30 rounded-lg border border-gray-800">
          <p className="text-xs text-gray-400">
            💡 <span className="font-semibold">Rollback Guide:</span> To fix a mistake, find the transaction in the list below and click{' '}
            <span className="text-blue-400">Edit</span> to correct the details, or{' '}
            <span className="text-red-400">Delete</span> to remove it entirely.{' '}
            All positions are automatically recalculated after any change. Use <span className="text-emerald-400">Sell</span> buttons to record partial sales.
          </p>
        </div>

        {/* Monthly Brief Generation */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-white mb-4">Monthly Intelligence Briefing</h2>
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex-1">
                <p className="text-white font-medium text-sm">{reportMonthLabel()} Briefing</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  Generates the full AI report using live portfolio data and saves it for all members to view.
                </p>
                {briefStatus === 'fetching' && (
                  <p className="text-blue-400 text-xs mt-2 flex items-center gap-2">
                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
                    Fetching portfolio data...
                  </p>
                )}
                {briefStatus === 'generating' && (
                  <p className="text-blue-400 text-xs mt-2 flex items-center gap-2">
                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
                    DeepSeek is writing the report — allow 3-4 minutes...
                  </p>
                )}
                {briefStatus === 'done' && (
                  <p className="text-emerald-400 text-xs mt-2">
                    ✓ Report generated and saved. Members can view it on the Monthly Brief page.
                  </p>
                )}
                {briefStatus === 'error' && briefError && (
                  <p className="text-red-400 text-xs mt-2 break-words">✗ {briefError}</p>
                )}
              </div>
              <button
                onClick={generateBrief}
                disabled={briefStatus === 'fetching' || briefStatus === 'generating'}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex-shrink-0 ${
                  briefStatus === 'fetching' || briefStatus === 'generating'
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {briefStatus === 'done' ? 'Regenerate' : 'Generate Brief'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ManagePage() {
  return (
    <PasswordProtect pageName="Portfolio Management">
      <ManagePageContent />
    </PasswordProtect>
  );
}