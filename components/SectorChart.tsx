'use client';

import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { HoldingWithPrice } from '@/types';

interface SectorChartProps {
  holdings: HoldingWithPrice[];
}

const sectorColors: Record<string, string> = {
  Aerospace: '#4f46e5',
  Industrials: '#06b6d4',
  Materials: '#10b981',
  Energy: '#f59e0b',
  Technology: '#ef4444',
  Financials: '#8b5cf6',
  Consumer: '#ec489a',
  Utilities: '#14b8a6',
  Other: '#94a3b8',
};

export default function SectorChart({ holdings }: SectorChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!chartRef.current || holdings.length === 0) return;

    // Calculate sector allocation
    const sectorMap = new Map<string, number>();
    holdings.forEach(holding => {
      const sector = holding.sector;
      sectorMap.set(sector, (sectorMap.get(sector) || 0) + holding.currentValue);
    });

    const sectors = Array.from(sectorMap.keys());
    const values = Array.from(sectorMap.values());
    const backgroundColors = sectors.map(sector => sectorColors[sector] || sectorColors.Other);

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create new chart
    chartInstance.current = new Chart(chartRef.current, {
      type: 'doughnut',
      data: {
        labels: sectors,
        datasets: [
          {
            data: values,
            backgroundColor: backgroundColors,
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 12 },
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.raw as number;
                const total = values.reduce((a, b) => a + b, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return `${context.label}: £${value.toFixed(2)} (${percentage}%)`;
              },
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
  }, [holdings]);

  if (holdings.length === 0) {
    return (
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span>📊</span> Sector Allocation
        </h3>
        <div className="text-center text-slate-400 py-8">No data available</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
        <span>📊</span> Sector Allocation
      </h3>
      <canvas ref={chartRef} height="250" />
    </div>
  );
}