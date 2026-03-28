'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Navigation from '@/components/Navigation';
import { PortfolioSummary, Position } from '@/types';
import { 
  getTransactions, 
  calculatePositions, 
  fetchPrices, 
  calculatePortfolioSummary,
  getHoldingsReference
} from '@/lib/portfolio';
import RefreshButton from '@/components/RefreshButton';

const formatCurrency = (value: number): string => {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Calculate position within 52-week range (0-100%)
const getRangePosition = (current: number, low: number, high: number): number => {
  if (high === low) return 50;
  return ((current - low) / (high - low)) * 100;
};

// Get color based on position in range
const getRangeColor = (position: number): string => {
  if (position >= 80) return '#10b981';
  if (position >= 60) return '#34d399';
  if (position >= 40) return '#eab308';
  if (position >= 20) return '#f97316';
  return '#ef4444';
};

// 52-Week Range Bar Component
const RangeBar = ({ current, low, high }: { current: number; low: number; high: number }) => {
  let lowInPounds = low;
  let highInPounds = high;
  
  if (low > 100 || high > 100) {
    lowInPounds = low / 100;
    highInPounds = high / 100;
  }
  
  const position = ((current - lowInPounds) / (highInPounds - lowInPounds)) * 100;
  const clampedPosition = Math.min(100, Math.max(0, position));
  const barColor = getRangeColor(position);
  
  const minWidth = 5;
  const displayWidth = clampedPosition < minWidth && clampedPosition > 0 ? minWidth : clampedPosition;
  
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>£{lowInPounds.toFixed(2)}</span>
        <span>£{highInPounds.toFixed(2)}</span>
      </div>
      <div className="relative w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          style={{ width: `${displayWidth}%`, backgroundColor: barColor }}
          className="absolute h-full rounded-full"
        />
      </div>
    </div>
  );
};

// SVG Pie Chart Component
const PieChart = ({ data }: { data: { sector: string; value: number; color: string }[] }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const center = 110;
  const radius = 100;
  
  const segments = data.reduce<{ path: string; color: string; sector: string; value: number; percentage: number }[]>(
    (acc, item) => {
      const previousAngle = acc.reduce((sum, seg) => sum + (seg.value / total) * 360, 0);
      const angle = (item.value / total) * 360;
      const startAngle = previousAngle;
      const endAngle = previousAngle + angle;
      
      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;
      
      const x1 = center + radius * Math.cos(startRad);
      const y1 = center + radius * Math.sin(startRad);
      const x2 = center + radius * Math.cos(endRad);
      const y2 = center + radius * Math.sin(endRad);
      
      const largeArcFlag = angle > 180 ? 1 : 0;
      
      const pathData = [
        `M ${center} ${center}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
        'Z',
      ].join(' ');
      
      acc.push({
        path: pathData,
        color: item.color,
        sector: item.sector,
        value: item.value,
        percentage: (item.value / total) * 100,
      });
      
      return acc;
    },
    []
  );

  return (
    <div className="flex flex-col md:flex-row items-center gap-8">
      <svg width="220" height="220" viewBox="0 0 220 220" className="flex-shrink-0">
        {segments.map((segment, idx) => (
          <path
            key={idx}
            d={segment.path}
            fill={segment.color}
            stroke="#1f2937"
            strokeWidth="1.5"
            className="transition-opacity hover:opacity-80 cursor-pointer"
          >
            <title>{`${segment.sector}: ${formatCurrency(segment.value)} (${segment.percentage.toFixed(1)}%)`}</title>
          </path>
        ))}
        <circle cx={center} cy={center} r="50" fill="#1f2937" stroke="#374151" strokeWidth="1.5" />
        <text x={center} y={center + 5} textAnchor="middle" fill="#9ca3af" fontSize="12" fontWeight="bold">
          {data.length} Sectors
        </text>
      </svg>
      
      <div className="flex-1 grid grid-cols-2 gap-3">
        {segments.map((segment, idx) => (
          <div key={idx} className="flex items-center gap-2 p-2 bg-gray-800/30 rounded-lg">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: segment.color }} />
            <span className="text-gray-300 text-sm flex-1">{segment.sector}</span>
            <span className="text-white text-sm font-medium">{segment.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Portfolio Weighting Heat Map Component
const WeightingHeatMap = ({ holdings, totalValue }: { holdings: Position[]; totalValue: number }) => {
  // Sort by value descending
  const sorted = [...holdings].sort((a, b) => b.currentValue - a.currentValue);
  
  // Calculate color intensity based on percentage
  const getColorIntensity = (percentage: number): string => {
    if (percentage >= 20) return 'bg-red-600';
    if (percentage >= 15) return 'bg-red-500';
    if (percentage >= 10) return 'bg-orange-500';
    if (percentage >= 5) return 'bg-yellow-600';
    if (percentage >= 2) return 'bg-emerald-500';
    return 'bg-emerald-400';
  };
  
  // Calculate text color based on background
  const getTextColor = (percentage: number): string => {
    if (percentage >= 10) return 'text-white';
    return 'text-gray-800';
  };
  
  return (
    <div className="mt-6">
      <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
        <span>🎯</span> Portfolio Weighting
        <span className="text-xs text-gray-500 font-normal">(by current value)</span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {sorted.map((holding) => {
          const percentage = (holding.currentValue / totalValue) * 100;
          const colorClass = getColorIntensity(percentage);
          const textColor = getTextColor(percentage);
          
          return (
            <div
              key={holding.holdingId}
              className={`${colorClass} rounded-lg p-2 transition-all hover:scale-105 cursor-help`}
              title={`${holding.name}: ${percentage.toFixed(1)}% of portfolio`}
            >
              <div className="text-center">
                <p className={`text-xs font-medium truncate ${textColor}`}>
                  {holding.name.split(' ').slice(0, 2).join(' ')}
                </p>
                <p className={`text-lg font-bold ${textColor}`}>
                  {percentage.toFixed(1)}%
                </p>
                <p className={`text-[10px] ${textColor} opacity-80`}>
                  {formatCurrency(holding.currentValue)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-600 rounded"></div>
          <span>&gt;20%</span>
          <div className="w-3 h-3 bg-red-500 rounded ml-2"></div>
          <span>15-20%</span>
          <div className="w-3 h-3 bg-orange-500 rounded ml-2"></div>
          <span>10-15%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-yellow-600 rounded"></div>
          <span>5-10%</span>
          <div className="w-3 h-3 bg-emerald-500 rounded ml-2"></div>
          <span>2-5%</span>
          <div className="w-3 h-3 bg-emerald-400 rounded ml-2"></div>
          <span>&lt;2%</span>
        </div>
      </div>
    </div>
  );
};

// Color palette for sectors
const sectorColors: Record<string, string> = {
  Aerospace: '#4f46e5',
  Industrials: '#06b6d4',
  Materials: '#10b981',
  Energy: '#f59e0b',
  Technology: '#ef4444',
  Financials: '#8b5cf6',
  Consumer: '#ec489a',
  Utilities: '#14b8a6',
  Healthcare: '#f97316',
  Other: '#6b7280',
};

export default function HoldingsPage() {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string>('All');
  const [stockRanges, setStockRanges] = useState<Record<string, { high: number; low: number }>>({});

  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const transactions = await getTransactions();
      const prices = await fetchPrices();
      const positions = await calculatePositions(transactions, prices);
      const calculated = calculatePortfolioSummary(positions);
      setPortfolio(calculated);
      
      // Fetch 52-week ranges for each stock
      const ranges: Record<string, { high: number; low: number }> = {};
      for (const holding of calculated.holdings) {
        try {
          const response = await fetch('/api/fundamentals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: holding.ticker }),
          });
          const data = await response.json();
          ranges[holding.ticker] = { high: data.high52Week || 0, low: data.low52Week || 0 };
        } catch (err) {
          console.error(`Error fetching range for ${holding.ticker}:`, err);
          ranges[holding.ticker] = { high: holding.currentPrice * 1.3, low: holding.currentPrice * 0.7 };
        }
      }
      setStockRanges(ranges);
    } catch (error) {
      console.error('Error loading holdings:', error);
      setError('Failed to load holdings data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Prepare pie chart data
  const pieData = useMemo(() => {
    if (!portfolio) return [];
    const allocation: Record<string, number> = {};
    portfolio.holdings.forEach((holding: Position) => {
      allocation[holding.sector] = (allocation[holding.sector] || 0) + holding.currentValue;
    });
    return Object.entries(allocation).map(([sector, value]) => ({
      sector,
      value,
      color: sectorColors[sector] || sectorColors.Other,
    }));
  }, [portfolio]);

  const sectorAllocation = useMemo(() => {
    const allocation: Record<string, number> = {};
    portfolio?.holdings.forEach((holding: Position) => {
      allocation[holding.sector] = (allocation[holding.sector] || 0) + holding.currentValue;
    });
    return allocation;
  }, [portfolio]);

  const sectors = useMemo(() => ['All', ...new Set(portfolio?.holdings.map(h => h.sector) || [])], [portfolio]);
  const filteredHoldings = useMemo(() => 
    selectedSector === 'All' 
      ? portfolio?.holdings 
      : portfolio?.holdings.filter(h => h.sector === selectedSector),
    [portfolio, selectedSector]
  );

  const getRange = (ticker: string) => {
    return stockRanges[ticker] || { high: 0, low: 0 };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
              <p className="mt-4 text-gray-400">Loading holdings data...</p>
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
            <p className="text-red-400">{error || 'Failed to load holdings data'}</p>
            <button onClick={loadData} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Try Again</button>
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
            <h1 className="text-2xl font-bold text-white">Holdings Analysis</h1>
            <p className="text-sm text-gray-400 mt-1">Sector allocation and 52-week range analysis</p>
          </div>
          <RefreshButton onRefresh={loadData} />
        </div>

        {/* Sector Allocation Chart + Heat Map */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 mb-8">
          <h2 className="text-white font-semibold mb-4">Sector Allocation</h2>
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="w-full md:w-1/2">
              {pieData.length > 0 ? (
                <PieChart data={pieData} />
              ) : (
                <div className="text-center text-gray-400 py-8">No sector data available</div>
              )}
            </div>
            <div className="w-full md:w-1/2">
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(sectorAllocation).map(([sector, value]) => {
                  const total = Object.values(sectorAllocation).reduce((a, b) => a + b, 0);
                  const percentage = (value / total) * 100;
                  return (
                    <div key={sector} className="bg-gray-800/50 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">{sector}</p>
                      <p className="text-white font-semibold">{formatCurrency(value)}</p>
                      <p className="text-emerald-400 text-sm">{percentage.toFixed(1)}%</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          
          {/* Portfolio Weighting Heat Map */}
          <WeightingHeatMap holdings={portfolio.holdings} totalValue={portfolio.totalValue} />
        </div>

        {/* Sector Filter */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {sectors.map(sector => (
            <button
              key={sector}
              onClick={() => setSelectedSector(sector)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                selectedSector === sector ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {sector} {sector !== 'All' && `(${portfolio.holdings.filter(h => h.sector === sector).length})`}
            </button>
          ))}
        </div>

        {/* Holdings Table */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-gray-900/80 border-b border-gray-800">
        <tr className="text-left">
          <th className="px-4 py-3 text-xs font-medium text-gray-400">Company</th>
          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Price</th>
          <th className="px-4 py-3 text-left min-w-[180px] text-xs font-medium text-gray-400">52-Week Range</th>
          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Value</th>
          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">P&L</th>
          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Return</th>
          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Shares</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-800">
        {filteredHoldings?.map((holding) => {
          const range = getRange(holding.ticker);
          return (
            <tr key={holding.holdingId} className="hover:bg-gray-800/50 transition-colors">
              <td className="px-4 py-3">
                <p className="text-white font-medium">{holding.name}</p>
                <a 
                  href={`https://uk.finance.yahoo.com/quote/${holding.ticker}`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-emerald-400 text-xs hover:underline"
                >
                  {holding.ticker}
                </a>
              </td>
              <td className="px-4 py-3 text-right text-gray-300 font-mono">
                £{holding.currentPrice.toFixed(2)}
              </td>
              <td className="px-4 py-3">
                <RangeBar 
                  current={holding.currentPrice} 
                  low={range.low} 
                  high={range.high} 
                />
              </td>
              <td className="px-4 py-3 text-right text-gray-300">
                £{holding.currentValue.toFixed(2)}
              </td>
              <td className={`px-4 py-3 text-right font-medium ${holding.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {holding.pnl >= 0 ? '+' : ''}{formatCurrency(holding.pnl)}
              </td>
              <td className={`px-4 py-3 text-right font-medium ${holding.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {holding.pnlPercent >= 0 ? '+' : ''}{holding.pnlPercent.toFixed(2)}%
              </td>
              <td className="px-4 py-3 text-right text-gray-300">
                {holding.shares.toLocaleString()}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
</div>

        <div className="mt-6 text-center text-xs text-gray-500">
          📊 <span className="font-semibold">52-week range bars</span> show where current price sits within the year's high and low. 
          The <span className="font-semibold">portfolio weighting heat map</span> shows allocation by value - red = overweight, green = underweight.
          Click any ticker for detailed charts on Yahoo Finance.
        </div>
      </div>
    </div>
  );
}