'use client';

import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { HoldingWithPrice } from '@/types';

interface StockPerformanceChartProps {
  holdings: HoldingWithPrice[];
  title: string;
}

export default function StockPerformanceChart({ holdings, title }: StockPerformanceChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState<number>(400);

  useEffect(() => {
    // Calculate height based on number of bars
    const barCount = Math.min(holdings.length, 16);
    const calculatedHeight = Math.max(300, barCount * 28);
    setChartHeight(calculatedHeight);
  }, [holdings]);

  useEffect(() => {
    if (!chartRef.current || holdings.length === 0) return;

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }

    // Sort by performance percentage
    const sorted = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent);
    
    // Take top 8 and bottom 8 for readability
    const topPerformers = sorted.slice(0, 8);
    const bottomPerformers = sorted.slice(-8).reverse();
    
    const displayHoldings = [...topPerformers, ...bottomPerformers];
    
    const labels = displayHoldings.map(h => {
      let name = h.name;
      if (name.length > 25) name = name.substring(0, 23) + '...';
      return name;
    });
    
    const returns = displayHoldings.map(h => h.pnlPercent);
    const colors = returns.map(r => r >= 0 ? '#10b981' : '#ef4444');

    // Create chart with proper sizing
    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Return since purchase (%)',
            data: returns,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.8,
            categoryPercentage: 0.9,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.raw as number;
                return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
              },
              afterBody: (context) => {
                const holding = displayHoldings[context[0].dataIndex];
                return [
                  `Current: £${holding.currentPrice.toFixed(2)}`,
                  `Avg Cost: £${holding.avgCost.toFixed(2)}`,
                  `Shares: ${holding.shares.toLocaleString()}`,
                ];
              },
            },
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 8,
          },
          legend: {
            display: false,
          },
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(75, 85, 99, 0.2)',
            },
            ticks: {
              color: '#9ca3af',
              callback: (value) => `${value}%`,
              font: { size: 11 },
            },
            title: {
              display: true,
              text: 'Return (%)',
              color: '#9ca3af',
              font: { size: 12 },
            },
          },
          y: {
            grid: {
              display: false,
            },
            ticks: {
              color: '#9ca3af',
              font: { size: 11 },
              autoSkip: false,
            },
          },
        },
        layout: {
          padding: {
            left: 10,
            right: 20,
            top: 10,
            bottom: 10,
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [holdings]);

  // Calculate winners and losers
  const winners = holdings.filter(h => h.pnlPercent > 0);
  const losers = holdings.filter(h => h.pnlPercent < 0);
  const bestPerformer = holdings.reduce((best, current) => 
    current.pnlPercent > best.pnlPercent ? current : best, holdings[0]);
  const worstPerformer = holdings.reduce((worst, current) => 
    current.pnlPercent < worst.pnlPercent ? current : worst, holdings[0]);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <h2 className="text-white font-semibold text-base">{title}</h2>
        <div className="flex gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full"></div>
            <span className="text-gray-400">Winners: {winners.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
            <span className="text-gray-400">Losers: {losers.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-400">Best:</span>
            <span className="text-emerald-400 font-medium">{bestPerformer?.pnlPercent.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-400">Worst:</span>
            <span className="text-red-400 font-medium">{worstPerformer?.pnlPercent.toFixed(1)}%</span>
          </div>
        </div>
      </div>
      
      <div 
        ref={containerRef}
        className="w-full"
        style={{ height: `${chartHeight}px`, minHeight: '300px' }}
      >
        <canvas 
          ref={chartRef} 
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
      
      <div className="mt-3 text-center text-xs text-gray-500">
        📊 <span className="font-semibold">Performance since purchase</span> — Average cost vs current price
      </div>
    </div>
  );
}