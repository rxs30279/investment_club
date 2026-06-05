// Shared 52-week range bar. Shows where the current price sits between the
// year's low and high, colour-graded from red (near low) to green (near high).
// Extracted from the holdings page so the watchlist can reuse it.

export function getRangePosition(current: number, low: number, high: number): number {
  if (high === low) return 50;
  return ((current - low) / (high - low)) * 100;
}

export function getRangeColor(position: number): string {
  if (position >= 80) return '#10b981';
  if (position >= 60) return '#34d399';
  if (position >= 40) return '#eab308';
  if (position >= 20) return '#f97316';
  return '#ef4444';
}

export default function RangeBar({ current, low, high }: { current: number; low: number; high: number }) {
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
}
