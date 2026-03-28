'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import StockPerformanceChart from '@/components/StockPerformanceChart';
import { PortfolioSummary, Dividend } from '@/types';
import { 
  getTransactions, 
  getHoldingsReference, 
  calculatePositions, 
  fetchPrices, 
  calculatePortfolioSummary,
  getDividends,
  saveDividends,
  fetchFTSE100Data
} from '@/lib/portfolio';
import RefreshButton from '@/components/RefreshButton';

const formatCurrency = (value: number): string => {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercent = (value: number): string => {
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
};

export default function PerformancePage() {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDividend, setShowAddDividend] = useState(false);
  const [ftseCurrentPrice, setFtseCurrentPrice] = useState<number | null>(null);
  const [ftseYTDReturn, setFtseYTDReturn] = useState<number | null>(null);
  const [portfolioValueJan1, setPortfolioValueJan1] = useState<number | null>(null);
  const [ftseStartDate, setFtseStartDate] = useState<string | null>(null);
  const [ftseLoading, setFtseLoading] = useState(true);
  const [newDividend, setNewDividend] = useState({
    holdingId: 0,
    date: new Date().toISOString().split('T')[0],
    amount: 0,
    notes: '',
  });

  // Fetch FTSE data and calculate YTD return
  const fetchFTSE = async () => {
    setFtseLoading(true);
    try {
      const data = await fetchFTSE100Data();
      
      if (data && data.length > 0) {
        const latest = data[data.length - 1];
        
        const startDate = data.find(d => d.date === '2026-01-02') || 
                          data.find(d => d.date === '2026-01-05') ||
                          data.find(d => d.date >= '2026-01-01');
        
        setFtseCurrentPrice(latest?.value);
        
        if (startDate && latest) {
          setFtseStartDate(startDate.date);
          const ytd = ((latest.value - startDate.value) / startDate.value) * 100;
          setFtseYTDReturn(ytd);
        }
      }
    } catch (error) {
      console.error('Error fetching FTSE data:', error);
    } finally {
      setFtseLoading(false);
    }
  };

  // Calculate portfolio value on Jan 1, 2026
  const calculatePortfolioValueOnDate = async (date: string) => {
    try {
      const transactions = getTransactions();
      const holdings = getHoldingsReference();
      const currentPrices = await fetchPrices();
      const holdingInfo = new Map();
      holdings.forEach(h => {
        holdingInfo.set(h.id, { ticker: h.ticker });
      });
      
      const relevantTransactions = transactions.filter(t => t.date <= date);
      const positionMap = new Map<number, { shares: number; totalCost: number; ticker: string }>();
      
      const sortedTransactions = [...relevantTransactions].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      for (const tx of sortedTransactions) {
        const info = holdingInfo.get(tx.holdingId);
        if (!info) continue;
        
        let pos = positionMap.get(tx.holdingId);
        if (!pos) {
          pos = { shares: 0, totalCost: 0, ticker: info.ticker };
          positionMap.set(tx.holdingId, pos);
        }
        
        if (tx.type === 'buy') {
          pos.shares += tx.shares;
          pos.totalCost += tx.totalCost;
        } else if (tx.type === 'sell') {
          const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
          pos.shares -= tx.shares;
          pos.totalCost -= avgCost * tx.shares;
        }
      }
      
      let totalValue = 0;
      for (const [_, pos] of positionMap) {
        if (pos.shares <= 0) continue;
        const price = currentPrices[pos.ticker] || 0;
        totalValue += price * pos.shares;
      }
      
      return totalValue;
    } catch (error) {
      console.error('Error calculating portfolio value:', error);
      return 0;
    }
  };

  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const transactions = getTransactions();
      const holdings = getHoldingsReference();
      const divs = getDividends();
      const prices = await fetchPrices();
      const positions = calculatePositions(transactions, prices);
      const calculated = calculatePortfolioSummary(positions);
      
      setPortfolio(calculated);
      setDividends(divs);
      
      const jan1Value = await calculatePortfolioValueOnDate('2026-01-01');
      setPortfolioValueJan1(jan1Value);
      
      await fetchFTSE();
      
    } catch (error) {
      console.error('Error loading performance data:', error);
      setError('Failed to load performance data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddDividend = () => {
    if (!newDividend.holdingId || newDividend.amount <= 0) {
      alert('Please select a holding and enter a valid amount');
      return;
    }
    
    const dividend: Dividend = {
      id: Math.max(...dividends.map(d => d.id), 0) + 1,
      holdingId: newDividend.holdingId,
      date: newDividend.date,
      amount: newDividend.amount,
      currency: 'GBP',
      notes: newDividend.notes,
    };
    
    const updatedDividends = [...dividends, dividend];
    setDividends(updatedDividends);
    saveDividends(updatedDividends);
    setShowAddDividend(false);
    setNewDividend({ holdingId: 0, date: new Date().toISOString().split('T')[0], amount: 0, notes: '' });
    loadData();
    alert('Dividend added successfully!');
  };

  const handleDeleteDividend = (id: number) => {
    if (confirm('Delete this dividend record?')) {
      const updatedDividends = dividends.filter(d => d.id !== id);
      setDividends(updatedDividends);
      saveDividends(updatedDividends);
      loadData();
    }
  };

  const getCompanyName = (holdingId: number): string => {
    const holdings = getHoldingsReference();
    const holding = holdings.find(h => h.id === holdingId);
    return holding?.name || `Holding ${holdingId}`;
  };

  const totalDividends = dividends.reduce((sum, d) => sum + d.amount, 0);
  const totalReturnWithDividends = (portfolio?.totalPnl || 0) + totalDividends;
  const totalReturnPercentWithDividends = portfolio?.totalCost 
    ? (totalReturnWithDividends / portfolio.totalCost) * 100 
    : 0;
  
  const currentValue = portfolio?.totalValue || 0;
  const ytdReturn = portfolioValueJan1 && portfolioValueJan1 > 0 
    ? ((currentValue - portfolioValueJan1) / portfolioValueJan1) * 100 
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
              <p className="mt-4 text-gray-400">Loading performance data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !portfolio) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center">
            <p className="text-red-400">{error || 'Failed to load performance data'}</p>
            <button
              onClick={loadData}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
            >
              Try Again
            </button>
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
            <h1 className="text-2xl font-bold text-white">Performance Profile</h1>
            <p className="text-sm text-gray-400 mt-1">
              Year-to-date performance • From January 1, 2026
            </p>
          </div>
          <RefreshButton onRefresh={loadData} />
        </div>

        {/* Performance Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wide">YTD Return</p>
            <p className={`text-2xl font-bold mt-1 ${ytdReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPercent(ytdReturn)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Since Jan 1, 2026</p>
          </div>
          
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Portfolio Return</p>
            <p className={`text-2xl font-bold mt-1 ${portfolio.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPercent(portfolio.totalPnlPercent)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Total return (since inception)</p>
          </div>
          
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total Dividends</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(totalDividends)}</p>
            <p className="text-xs text-gray-500 mt-1">From {dividends.length} payments</p>
          </div>
          
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total Return (with Divs)</p>
            <p className={`text-2xl font-bold mt-1 ${totalReturnWithDividends >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPercent(totalReturnPercentWithDividends)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Including dividends</p>
          </div>
          
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wide">FTSE 100</p>
            {ftseLoading ? (
              <div className="mt-1">
                <div className="animate-pulse h-8 w-24 bg-gray-700 rounded"></div>
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold text-blue-400 mt-1">
                  {ftseCurrentPrice ? `${ftseCurrentPrice.toFixed(2)}` : '—'}
                </p>
                <p className={`text-xs mt-1 ${ftseYTDReturn && ftseYTDReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  YTD: {ftseYTDReturn !== null ? formatPercent(ftseYTDReturn) : '—'}
                  {ftseStartDate && ` (since ${ftseStartDate})`}
                </p>
              </>
            )}
          </div>
        </div>

        {/* YTD Performance Comparison */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 mb-8">
          <h2 className="text-white font-semibold mb-4">Year-to-Date Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-800/30 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-2">Portfolio Performance</p>
              <div className="flex justify-between items-baseline">
                <span className="text-3xl font-bold text-white">{formatCurrency(currentValue)}</span>
                <span className={`text-lg font-semibold ${ytdReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPercent(ytdReturn)}
                </span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Started Jan 1: {formatCurrency(portfolioValueJan1 || 0)}
              </div>
            </div>
            
            <div className="bg-gray-800/30 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-2">FTSE 100 Performance</p>
              <div className="flex justify-between items-baseline">
                <span className="text-3xl font-bold text-white">{ftseCurrentPrice?.toFixed(2) || '—'}</span>
                <span className={`text-lg font-semibold ${ftseYTDReturn && ftseYTDReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {ftseYTDReturn !== null ? formatPercent(ftseYTDReturn) : '—'}
                </span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {ftseStartDate ? `Started ${ftseStartDate}` : 'Starting date unavailable'}
              </div>
              <div className="mt-1 text-xs">
                <a 
                  href="https://finance.yahoo.com/quote/%5EFTSE/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  View FTSE 100 on Yahoo Finance →
                </a>
              </div>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Outperformance vs FTSE 100:</span>
              <span className={`text-lg font-bold ${ytdReturn > (ftseYTDReturn || 0) ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatPercent(ytdReturn - (ftseYTDReturn || 0))}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-500">
              Your portfolio has {ytdReturn > (ftseYTDReturn || 0) ? 'outperformed' : 'underperformed'} the FTSE 100 this year
            </div>
          </div>
        </div>

        {/* Individual Stock Performance Chart */}
        {portfolio.holdings.length > 0 && (
          <div className="mb-8">
            <StockPerformanceChart 
              holdings={portfolio.holdings}
              title="Individual Stock Performance"
            />
          </div>
        )}

        {/* Dividends Section */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden mb-8">
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-800">
            <h2 className="text-white font-semibold">Dividend Income</h2>
            <button
              onClick={() => setShowAddDividend(!showAddDividend)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs"
            >
              + Add Dividend
            </button>
          </div>
          
          {showAddDividend && (
            <div className="p-6 border-b border-gray-800 bg-gray-800/30">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <select
                  value={newDividend.holdingId}
                  onChange={(e) => setNewDividend({ ...newDividend, holdingId: parseInt(e.target.value) })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                >
                  <option value={0}>Select Holding</option>
                  {portfolio.holdings.map(h => (
                    <option key={h.holdingId} value={h.holdingId}>{h.name}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newDividend.date}
                  onChange={(e) => setNewDividend({ ...newDividend, date: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                />
                <input
                  type="number"
                  placeholder="Amount (£)"
                  value={newDividend.amount || ''}
                  onChange={(e) => setNewDividend({ ...newDividend, amount: parseFloat(e.target.value) })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                  step="0.01"
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={newDividend.notes}
                  onChange={(e) => setNewDividend({ ...newDividend, notes: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500"
                />
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleAddDividend}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm"
                >
                  Save Dividend
                </button>
                <button
                  onClick={() => setShowAddDividend(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/80 border-b border-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Company</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400">Notes</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-400">Actions</th>
                  </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {[...dividends].reverse().map((div) => (
                  <tr key={div.id} className="hover:bg-gray-800/50">
                    <td className="px-6 py-3 text-gray-300">{div.date}</td>
                    <td className="px-6 py-3 text-white">{getCompanyName(div.holdingId)}</td>
                    <td className="px-6 py-3 text-right text-emerald-400">{formatCurrency(div.amount)}</td>
                    <td className="px-6 py-3 text-gray-400">{div.notes || '-'}</td>
                    <td className="px-6 py-3 text-center">
                      <button
                        onClick={() => handleDeleteDividend(div.id)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {dividends.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No dividend payments recorded. Click "Add Dividend" to start tracking.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-gray-900 border-t border-gray-800">
                <tr>
                  <td colSpan={2} className="px-6 py-3 text-right font-semibold text-gray-300">Total Dividends</td>
                  <td className="px-6 py-3 text-right font-bold text-emerald-400">{formatCurrency(totalDividends)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          💡 YTD return calculated from portfolio value on January 1, 2026. 
          Dividends are recorded as received and included in total return.
          The chart above shows individual stock performance since purchase.
        </div>
      </div>
    </div>
  );
}