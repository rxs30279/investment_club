'use client';

import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { PerformanceData, Position } from '@/types';

interface PerformanceChartProps {
  data: PerformanceData;
  portfolioReturn: number;
  ftseReturn: number;
  ftseCurrentPrice?: number;
}

const formatPercent = (value: number): string => {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

export default function PerformanceChart({ data, portfolioReturn, ftseReturn, ftseCurrentPrice }: PerformanceChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!chartRef.current || !data.dates.length) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Format dates for display
    const step = Math.max(1, Math.floor(data.dates.length / 8));
    const labels = data.dates.map((date, i) => {
      if (i % step === 0 || i === data.dates.length - 1) {
        return new Date(date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
      }
      return '';
    });

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Portfolio (with dividends)',
            data: data.cumulativeReturns,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.05)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#10b981',
          },
          {
            label: 'FTSE 100',
            data: data.cumulativeFtse100Returns,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#3b82f6',
            borderDash: [5, 5],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.raw as number;
                return `${context.dataset.label}: ${formatPercent(value)}`;
              },
            },
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#ccc',
          },
          legend: {
            position: 'top',
            labels: {
              color: '#9ca3af',
              usePointStyle: true,
              boxWidth: 10,
              padding: 15,
            },
          },
        },
        scales: {
          y: {
            grid: {
              color: 'rgba(75, 85, 99, 0.2)',
            },
            ticks: {
              color: '#9ca3af',
              callback: (value) => `${value}%`,
            },
            title: {
              display: true,
              text: 'Cumulative Return (%)',
              color: '#9ca3af',
              font: { size: 11 },
            },
          },
          x: {
            grid: {
              display: false,
            },
            ticks: {
              color: '#9ca3af',
              maxRotation: 45,
              minRotation: 45,
            },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [data]);

  const outperformance = portfolioReturn - ftseReturn;
  const isOutperforming = outperformance > 0;

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
        <div>
          <h2 className="text-white font-semibold">Performance vs FTSE 100</h2>
          <p className="text-xs text-gray-500 mt-1">Cumulative returns since January 1, 2026</p>
        </div>
        {ftseCurrentPrice && (
          <div className="bg-gray-800/70 rounded-lg px-3 py-1.5">
            <span className="text-xs text-gray-400">FTSE 100</span>
            <span className="ml-2 text-white font-mono font-medium">{ftseCurrentPrice.toFixed(2)}</span>
          </div>
        )}
      </div>
      
      <div className="w-full">
        <canvas ref={chartRef} />
      </div>
      
      <div className="mt-4 flex justify-between items-center text-xs text-gray-500 border-t border-gray-800 pt-4">
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
            <span>Portfolio: {formatPercent(portfolioReturn)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span>FTSE 100: {formatPercent(ftseReturn)}</span>
          </div>
          <div className={`flex items-center gap-2 ${isOutperforming ? 'text-emerald-400' : 'text-red-400'}`}>
            <span>Outperformance:</span>
            <span className="font-bold">{formatPercent(outperformance)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}