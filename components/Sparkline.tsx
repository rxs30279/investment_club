// Tiny inline trend chart for the watchlist table. Hand-rolled SVG polyline
// (same plain-SVG approach as the pie/treemap charts on the holdings page) so we
// don't pull a charting library into a row that renders dozens of times.

export default function Sparkline({
  data,
  width = 96,
  height = 28,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="flex items-center text-gray-600 text-xs">—</div>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;

  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  // Green when the window ends higher than it started, red otherwise.
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? '#34d399' : '#f87171';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
