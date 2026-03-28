'use client';

interface KpiCardsProps {
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  holdingCount: number;
  topPerformer?: {
    name: string;
    return: number;
  };
}

export default function KpiCards({
  totalValue,
  totalCost,
  totalPnl,
  totalPnlPercent,
  holdingCount,
  topPerformer,
}: KpiCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
      {/* Market Value */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-xs text-slate-500 uppercase tracking-wide">Market Value</p>
        <p className="text-2xl font-bold text-slate-800 mt-1">£{totalValue.toFixed(2)}</p>
        <p className="text-xs text-slate-400 mt-1">{holdingCount} holdings</p>
      </div>
      
      {/* Cost Basis */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-xs text-slate-500 uppercase tracking-wide">Cost Basis</p>
        <p className="text-2xl font-bold text-slate-800 mt-1">£{totalCost.toFixed(2)}</p>
        <p className="text-xs text-slate-400 mt-1">incl. estimated fees</p>
      </div>
      
      {/* Overall Gain/Loss */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-xs text-slate-500 uppercase tracking-wide">Overall Gain / Loss</p>
        <p className={`text-2xl font-bold mt-1 ${totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {totalPnl >= 0 ? '£' : '-£'}{Math.abs(totalPnl).toFixed(2)}
        </p>
        <p className={`text-xs mt-1 ${totalPnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
        </p>
      </div>
      
      {/* Top Performer */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <p className="text-xs text-slate-500 uppercase tracking-wide">Top Performer</p>
        <p className="text-lg font-semibold text-slate-800 mt-1 truncate">
          {topPerformer?.name || '—'}
        </p>
        {topPerformer && (
          <p className={`text-xs mt-1 ${topPerformer.return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {topPerformer.return >= 0 ? '+' : ''}{topPerformer.return.toFixed(2)}%
          </p>
        )}
      </div>
    </div>
  );
}