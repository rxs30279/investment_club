'use client';

import { HoldingWithPrice } from '@/types';

interface HoldingsTableProps {
  holdings: HoldingWithPrice[];
}

export default function HoldingsTable({ holdings }: HoldingsTableProps) {
  if (holdings.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        No holdings found.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-5 py-3 text-left font-semibold text-slate-600">Company</th>
              <th className="px-5 py-3 text-left font-semibold text-slate-600">Ticker</th>
              <th className="px-5 py-3 text-right font-semibold text-slate-600">Shares</th>
              <th className="px-5 py-3 text-right font-semibold text-slate-600">Avg Cost</th>
              <th className="px-5 py-3 text-right font-semibold text-slate-600">Current</th>
              <th className="px-5 py-3 text-right font-semibold text-slate-600">Value</th>
              <th className="px-5 py-3 text-right font-semibold text-slate-600">P&L (£)</th>
              <th className="px-5 py-3 text-right font-semibold text-slate-600">P&L (%)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {holdings.map((holding) => (
              <tr key={holding.holdingId} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3 font-medium text-slate-800">{holding.name}</td>
                <td className="px-5 py-3 text-slate-500 font-mono text-xs">{holding.ticker}</td>
                <td className="px-5 py-3 text-right text-slate-700">{holding.shares.toLocaleString()}</td>
                <td className="px-5 py-3 text-right text-slate-700">£{holding.avgCost.toFixed(4)}</td>
                <td className="px-5 py-3 text-right font-mono text-slate-700">£{holding.currentPrice.toFixed(4)}</td>
                <td className="px-5 py-3 text-right text-slate-700">£{holding.currentValue.toFixed(2)}</td>
                <td className={`px-5 py-3 text-right font-medium ${holding.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  £{holding.pnl.toFixed(2)}
                </td>
                <td className={`px-5 py-3 text-right font-medium ${holding.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {holding.pnlPercent >= 0 ? '+' : ''}{holding.pnlPercent.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t border-slate-200">
            <tr>
              <td colSpan={5} className="px-5 py-3 text-right font-semibold text-slate-700">
                Totals
              </td>
              <td className="px-5 py-3 text-right font-semibold text-slate-800">
                £{holdings.reduce((sum, h) => sum + h.currentValue, 0).toFixed(2)}
              </td>
              <td className="px-5 py-3 text-right font-semibold text-slate-800">
                £{holdings.reduce((sum, h) => sum + h.pnl, 0).toFixed(2)}
              </td>
              <td className="px-5 py-3 text-right font-semibold text-slate-800">
                {(() => {
                  const totalCost = holdings.reduce((sum, h) => sum + h.costBasis, 0);
                  const totalPnl = holdings.reduce((sum, h) => sum + h.pnl, 0);
                  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
                  return `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%`;
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}