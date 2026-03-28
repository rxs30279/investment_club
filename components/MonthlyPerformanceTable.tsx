'use client';

import { useState } from 'react';

interface MonthlyData {
  month: string;
  portfolioReturn: number;
  ftseReturn: number;
  bestStock?: string;
  bestReturn?: number;
  worstStock?: string;
  worstReturn?: number;
}

interface MonthlyPerformanceTableProps {
  data: MonthlyData[];
}

export default function MonthlyPerformanceTable({ data }: MonthlyPerformanceTableProps) {
  const [view, setView] = useState<'portfolio' | 'ftse'>('portfolio');

  const formatPercent = (value: number): string => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getColorClass = (value: number): string => {
    return value >= 0 ? 'text-emerald-400' : 'text-red-400';
  };

  const getBgColorClass = (value: number): string => {
    return value >= 0 
      ? 'bg-emerald-500/10 border-l-2 border-emerald-500' 
      : 'bg-red-500/10 border-l-2 border-red-500';
  };

  // Calculate compound total return (multiplicative, not additive)
  const calculateCompoundReturn = (returns: number[]): number => {
    let product = 1;
    for (const r of returns) {
      product = product * (1 + r / 100);
    }
    return (product - 1) * 100;
  };

  const portfolioReturns = data.map(d => d.portfolioReturn);
  const totalReturn = calculateCompoundReturn(portfolioReturns);
  
  const winningMonths = data.filter(d => d.portfolioReturn > 0).length;
  const losingMonths = data.filter(d => d.portfolioReturn < 0).length;

  // Find best and worst months
  const bestMonth = data.reduce((best, current) => 
    current.portfolioReturn > best.portfolioReturn ? current : best, data[0]);
  const worstMonth = data.reduce((worst, current) => 
    current.portfolioReturn < worst.portfolioReturn ? current : worst, data[0]);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h2 className="text-white font-semibold text-lg">Monthly Performance</h2>
            <p className="text-xs text-gray-500 mt-1">2026 Year-to-date performance by month</p>
          </div>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
              <span className="text-gray-400">Winning: {winningMonths}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <span className="text-gray-400">Losing: {losingMonths}</span>
            </div>
            <div className="flex items-center gap-2 border-l border-gray-700 pl-3">
              <span className="text-gray-400">YTD Total:</span>
              <span className={`font-medium ${getColorClass(totalReturn)}`}>
                {formatPercent(totalReturn)}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setView('portfolio')}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              view === 'portfolio' 
                ? 'bg-emerald-600 text-white' 
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Portfolio Returns
          </button>
          <button
            onClick={() => setView('ftse')}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              view === 'ftse' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            FTSE 100 Returns
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {data.map((item, idx) => (
            <div
              key={idx}
              className={`rounded-lg p-3 transition-all hover:scale-105 ${getBgColorClass(
                view === 'portfolio' ? item.portfolioReturn : item.ftseReturn
              )}`}
            >
              <div className="text-center">
                <p className="text-gray-400 text-xs uppercase font-medium">{item.month}</p>
                <p className={`text-xl font-bold mt-1 ${getColorClass(
                  view === 'portfolio' ? item.portfolioReturn : item.ftseReturn
                )}`}>
                  {formatPercent(view === 'portfolio' ? item.portfolioReturn : item.ftseReturn)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 py-3 border-t border-gray-800 bg-gray-800/30">
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-500">Year-to-Date Summary</span>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Total Return:</span>
              <span className={`font-semibold ${getColorClass(totalReturn)}`}>
                {formatPercent(totalReturn)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Best Month:</span>
              <span className="text-emerald-400">
                {bestMonth?.month} {formatPercent(bestMonth?.portfolioReturn)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Worst Month:</span>
              <span className="text-red-400">
                {worstMonth?.month} {formatPercent(worstMonth?.portfolioReturn)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}