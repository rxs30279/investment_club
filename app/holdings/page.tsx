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

// ── Treemap layout ─────────────────────────────────────────────────────────────
// Recursively splits a rectangle into blocks proportional to each item's weight.
// Alternates horizontal/vertical splits based on whichever keeps blocks squarer.

interface TreemapRect {
  holdingId: number;
  name: string;
  percentage: number;
  currentValue: number;
  x: number; // % from left
  y: number; // % from top
  w: number; // % width
  h: number; // % height
}

function buildTreemap(
  items: { holdingId: number; name: string; percentage: number; currentValue: number }[],
  x: number, y: number, w: number, h: number,
): TreemapRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];

  const total = items.reduce((s, i) => s + i.percentage, 0);

  // Find the split point that most evenly halves the area
  let runningSum = 0;
  let splitIdx = items.length - 1;
  for (let i = 0; i < items.length - 1; i++) {
    runningSum += items[i].percentage;
    if (runningSum >= total / 2) { splitIdx = i + 1; break; }
  }

  const ratio = items.slice(0, splitIdx).reduce((s, i) => s + i.percentage, 0) / total;

  if (w >= h) {
    const w1 = w * ratio;
    return [
      ...buildTreemap(items.slice(0, splitIdx), x,      y, w1,     h),
      ...buildTreemap(items.slice(splitIdx),     x + w1, y, w - w1, h),
    ];
  } else {
    const h1 = h * ratio;
    return [
      ...buildTreemap(items.slice(0, splitIdx), x, y,      w, h1),
      ...buildTreemap(items.slice(splitIdx),     x, y + h1, w, h - h1),
    ];
  }
}

// Portfolio Weighting Heat Map Component
const WeightingHeatMap = ({ holdings, totalValue }: { holdings: Position[]; totalValue: number }) => {
  const sorted = [...holdings]
    .sort((a, b) => b.currentValue - a.currentValue)
    .map(h => ({
      holdingId:    h.holdingId,
      name:         h.name,
      percentage:   (h.currentValue / totalValue) * 100,
      currentValue: h.currentValue,
    }));

  const rects = buildTreemap(sorted, 0, 0, 100, 100);

  const getColor = (pct: number) => {
    if (pct >= 15) return '#dc2626';
    if (pct >= 11) return '#ea580c';
    if (pct >= 8)  return '#d97706';
    if (pct >= 5)  return '#eab308';
    if (pct >= 3)  return '#16a34a';
    return '#15803d';
  };

  return (
    <div className="mt-6">
      <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
        <span>🎯</span> Portfolio Weighting
        <span className="text-xs text-gray-500 font-normal">(block size = portfolio weight)</span>
      </h3>

      {/* Treemap container — fixed height, blocks positioned absolutely */}
      <div className="relative w-full rounded-lg overflow-hidden" style={{ height: '340px' }}>
        {rects.map(rect => {
          const areaApprox = rect.w * rect.h;

          return (
            <div
              key={rect.holdingId}
              className="absolute transition-all hover:brightness-110 cursor-help flex items-center justify-center"
              style={{
                left:            `calc(${rect.x}% + 2px)`,
                top:             `calc(${rect.y}% + 2px)`,
                width:           `calc(${rect.w}% - 4px)`,
                height:          `calc(${rect.h}% - 4px)`,
                backgroundColor: getColor(rect.percentage),
                borderRadius:    '6px',
              }}
              title={`${rect.name}: ${rect.percentage.toFixed(1)}% · ${formatCurrency(rect.currentValue)}`}
            >
              {areaApprox > 40 && (
                <p className="text-center px-2 text-sm font-bold text-white leading-tight w-full truncate">
                  {rect.name.split(' ')[0]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        {[
          { color: '#dc2626', label: '>15%' },
          { color: '#ea580c', label: '11–15%' },
          { color: '#d97706', label: '8–11%' },
          { color: '#eab308', label: '5–8%' },
          { color: '#16a34a', label: '3–5%' },
          { color: '#15803d', label: '<3%' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};

// Color palette for sectors
const sectorColors: Record<string, string> = {
  Technology:  '#ef4444',  // red
  Energy:      '#f97316',  // orange
  Industrials: '#eab308',  // yellow
  Utilities:   '#84cc16',  // lime
  Materials:   '#22c55e',  // green
  Healthcare:  '#14b8a6',  // teal
  Aerospace:   '#3b82f6',  // blue
  Financials:  '#a855f7',  // purple
  Consumer:    '#ec4899',  // pink
  Other:       '#94a3b8',  // slate
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
      
      // Fetch 52-week ranges for all holdings in one batch request
      const ranges: Record<string, { high: number; low: number }> = {};
      const tickers = calculated.holdings.map((h: Position) => h.ticker).filter(Boolean);
      if (tickers.length > 0) {
        try {
          const response = await fetch(`/api/fundamentals?tickers=${tickers.join(',')}`);
          const data = await response.json();
          for (const holding of calculated.holdings) {
            const d = data[holding.ticker];
            ranges[holding.ticker] = d?.high52Week
              ? { high: d.high52Week, low: d.low52Week }
              : { high: holding.currentPrice * 1.3, low: holding.currentPrice * 0.7 };
          }
        } catch {
          for (const holding of calculated.holdings) {
            ranges[holding.ticker] = { high: holding.currentPrice * 1.3, low: holding.currentPrice * 0.7 };
          }
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
  const sectors = useMemo(() => ['All', ...new Set(portfolio?.holdings.map(h => h.sector) || [])], [portfolio]);

  const getRangePos = (ticker: string, currentPrice: number) => {
    let { low, high } = stockRanges[ticker] || { low: 0, high: 0 };
    if (low > 100 || high > 100) { low /= 100; high /= 100; }
    if (high === low) return 50;
    return Math.min(100, Math.max(0, ((currentPrice - low) / (high - low)) * 100));
  };

  const groupedHoldings = useMemo(() => {
    const holdings = selectedSector === 'All'
      ? (portfolio?.holdings ?? [])
      : (portfolio?.holdings ?? []).filter(h => h.sector === selectedSector);
    const map = new Map<string, Position[]>();
    for (const h of holdings) {
      if (!map.has(h.sector)) map.set(h.sector, []);
      map.get(h.sector)!.push(h);
    }
    // Sort holdings within each group by 52-week position descending
    for (const [, group] of map) {
      group.sort((a, b) => getRangePos(b.ticker, b.currentPrice) - getRangePos(a.ticker, a.currentPrice));
    }
    // Sort groups by their average 52-week position descending
    return Array.from(map.entries()).sort(([, a], [, b]) => {
      const avgA = a.reduce((s, h) => s + getRangePos(h.ticker, h.currentPrice), 0) / a.length;
      const avgB = b.reduce((s, h) => s + getRangePos(h.ticker, h.currentPrice), 0) / b.length;
      return avgB - avgA;
    });
  }, [portfolio, selectedSector, stockRanges]);

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
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">How Our Stocks Sit in Their 52-Week Range</h1>
            <p className="text-sm text-gray-400 mt-1">Stocks grouped by sector</p>
          </div>
          <RefreshButton onRefresh={loadData} />
        </div>

        {/* Sector Filter */}
        <div className="flex gap-1.5 sm:gap-2 mb-4 flex-wrap">
          {sectors.map(sector => {
            const color = sector === 'All' ? '#10b981' : (sectorColors[sector] ?? '#6b7280');
            const isActive = selectedSector === sector;
            return (
              <button
                key={sector}
                onClick={() => setSelectedSector(sector)}
                style={isActive ? { backgroundColor: color, borderColor: color, color: '#fff' } : { borderColor: color + '66', color }}
                className={`px-2.5 py-1 text-xs sm:px-4 sm:py-1.5 sm:text-sm rounded-full border transition-colors ${isActive ? '' : 'bg-transparent hover:opacity-80'} ${sector === 'Technology' ? 'ml-3 sm:ml-0' : ''}`}
              >
                {sector} {sector !== 'All' && `(${portfolio.holdings.filter(h => h.sector === sector).length})`}
              </button>
            );
          })}
        </div>

        {/* Holdings Table */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-gray-900/80 border-b border-gray-800">
        <tr className="text-left">
          <th className="w-1 p-0" />
          <th className="px-4 py-3 text-xs font-medium text-gray-400">Company</th>
          <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Price</th>
          <th className="px-4 py-3 text-left min-w-[180px] text-xs font-medium text-gray-400">52-Week Range</th>
          <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-400">Value</th>
          <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-400">P&L</th>
          <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-400">Return</th>
          <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-400">Shares</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-800">
        {groupedHoldings.map(([sector, holdings]) => {
          const color = sectorColors[sector] ?? '#6b7280';
          return holdings.map((holding, idx) => {
            const range = getRange(holding.ticker);
            return (
              <tr key={holding.holdingId} className="hover:bg-gray-800/50 transition-colors">
                <td className="p-0 w-1">
                  <div style={{ width: '4px', backgroundColor: color, height: '100%', minHeight: '52px' }} />
                </td>
                <td className="px-4 py-3">
                  <p className="text-white font-medium">{holding.name}</p>
                  <a
                    href={`https://uk.finance.yahoo.com/quote/${holding.ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs hover:underline"
                    style={{ color }}
                  >
                    {holding.ticker}
                  </a>
                  {idx === 0 && (
                    <p className="text-xs mt-0.5 font-medium" style={{ color }}>{sector}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-300 font-mono">
                  £{holding.currentPrice.toFixed(2)}
                </td>
                <td className="px-4 py-3">
                  <RangeBar current={holding.currentPrice} low={range.low} high={range.high} />
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-300">
                  £{holding.currentValue.toFixed(2)}
                </td>
                <td className={`hidden sm:table-cell px-4 py-3 text-right font-medium ${holding.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {holding.pnl >= 0 ? '+' : ''}{formatCurrency(holding.pnl)}
                </td>
                <td className={`hidden sm:table-cell px-4 py-3 text-right font-medium ${holding.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {holding.pnlPercent >= 0 ? '+' : ''}{holding.pnlPercent.toFixed(2)}%
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-300">
                  {holding.shares.toLocaleString()}
                </td>
              </tr>
            );
          });
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