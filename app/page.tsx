'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import RefreshButton from '@/components/RefreshButton';
import { PortfolioSummary, PriceResponse } from '@/types';
import { getTransactions, calculatePositions, fetchPrices, calculatePortfolioSummary } from '@/lib/portfolio';

// Helper function to format numbers with commas and currency
const formatCurrency = (value: number): string => {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercent = (value: number): string => {
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
};

export default function OverviewPage() {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
  setError(null);
  setLoading(true);
  try {
    // Get transactions from Supabase - need to await
    const transactions = await getTransactions();
    
    // Fetch current prices
    const prices = await fetchPrices();
    
    // Calculate positions from transactions using current prices
    const positions = await calculatePositions(transactions, prices);
    
    // Calculate portfolio summary
    const calculated = calculatePortfolioSummary(positions);
    
    setPortfolio(calculated);
    setLastUpdated(new Date());
  } catch (error) {
    console.error('Error fetching data:', error);
    setError('Failed to load portfolio data. Please try again.');
  } finally {
    setLoading(false);
  }
}, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate quick stats from positions
  const quickStats = portfolio ? {
    bestPerformer: portfolio.holdings.length > 0 ? {
      name: portfolio.holdings.reduce((best, current) => 
        current.pnlPercent > best.pnlPercent ? current : best
      ).name,
      return: portfolio.holdings.reduce((best, current) => 
        current.pnlPercent > best.pnlPercent ? current : best
      ).pnlPercent
    } : null,
    worstPerformer: portfolio.holdings.length > 0 ? {
      name: portfolio.holdings.reduce((worst, current) => 
        current.pnlPercent < worst.pnlPercent ? current : worst
      ).name,
      return: portfolio.holdings.reduce((worst, current) => 
        current.pnlPercent < worst.pnlPercent ? current : worst
      ).pnlPercent
    } : null,
    averageReturn: portfolio.holdings.reduce((sum, h) => sum + h.pnlPercent, 0) / (portfolio.holdings.length || 1),
    winningCount: portfolio.holdings.filter(h => h.pnlPercent > 0).length,
  } : null;

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

  if (error || !portfolio) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center">
            <p className="text-red-400">{error || 'Failed to load portfolio data'}</p>
            <button
              onClick={fetchData}
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
        {/* Header */}
        <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              MESI Investment Portfolio
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              UK stocks • Live prices from Yahoo Finance
            </p>
          </div>
          <RefreshButton onRefresh={fetchData} />
        </div>

        {/* Last Updated */}
        {lastUpdated && (
          <div className="text-right text-xs text-gray-500 mb-4">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Market Value</p>
            <p className="text-2xl font-bold text-white mt-1">{formatCurrency(portfolio.totalValue)}</p>
            <p className="text-xs text-gray-500 mt-1">{portfolio.holdingCount} holdings</p>
          </div>
          
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Cost Basis</p>
            <p className="text-2xl font-bold text-white mt-1">{formatCurrency(portfolio.totalCost)}</p>
            <p className="text-xs text-gray-500 mt-1">incl. estimated fees</p>
          </div>
          
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Overall Gain / Loss</p>
            <p className={`text-2xl font-bold mt-1 ${portfolio.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {portfolio.totalPnl >= 0 ? formatCurrency(portfolio.totalPnl) : `-${formatCurrency(Math.abs(portfolio.totalPnl))}`}
            </p>
            <p className={`text-xs mt-1 ${portfolio.totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPercent(portfolio.totalPnlPercent)}
            </p>
          </div>
          
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Best Performer</p>
            {quickStats?.bestPerformer ? (
              <>
                <p className="text-lg font-semibold text-white mt-1 truncate">{quickStats.bestPerformer.name}</p>
                <p className="text-xs text-emerald-400 mt-1">{formatPercent(quickStats.bestPerformer.return)}</p>
              </>
            ) : (
              <p className="text-lg font-semibold text-gray-400 mt-1">—</p>
            )}
          </div>
        </div>

        {/* Holdings Table */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden backdrop-blur-sm">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <span>📋</span> Holdings
            </h2>
            <p className="text-xs text-gray-500 mt-1">Detailed breakdown of all positions</p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/80">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Ticker</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Shares</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Avg Cost</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Current</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Value</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">P&L (£)</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">P&L (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {portfolio.holdings.map((holding) => (
                  <tr key={holding.holdingId} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-white">{holding.name}</td>
                    <td className="px-6 py-4">
                      <a
                        href={`https://uk.finance.yahoo.com/quote/${holding.ticker}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 font-mono text-xs hover:underline transition-colors"
                      >
                        {holding.ticker}
                      </a>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-300">{holding.shares.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-gray-300">{formatCurrency(holding.avgCost)}</td>
                    <td className="px-6 py-4 text-right font-mono text-gray-300">{formatCurrency(holding.currentPrice)}</td>
                    <td className="px-6 py-4 text-right text-gray-300">{formatCurrency(holding.currentValue)}</td>
                    <td className={`px-6 py-4 text-right font-medium ${holding.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {holding.pnl >= 0 ? '+' : ''}{formatCurrency(holding.pnl)}
                    </td>
                    <td className={`px-6 py-4 text-right font-medium ${holding.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatPercent(holding.pnlPercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-900 border-t border-gray-800">
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-right font-semibold text-gray-300">
                    Total Portfolio
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-white">
                    {formatCurrency(portfolio.totalValue)}
                  </td>
                  <td className={`px-6 py-4 text-right font-bold ${portfolio.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {portfolio.totalPnl >= 0 ? '+' : ''}{formatCurrency(portfolio.totalPnl)}
                  </td>
                  <td className={`px-6 py-4 text-right font-bold ${portfolio.totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatPercent(portfolio.totalPnlPercent)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer Note */}
        <div className="mt-6 text-center text-xs text-gray-500">
          Click any ticker to view on Yahoo Finance • Prices converted from pence to pounds
        </div>
      </div>
    </div>
  );
}