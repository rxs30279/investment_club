import type { EtfRow } from '../monthly-brief/types';

// Both pages serve full table data in static HTML (Angular SSR).
// Row text format after stripping tags:
//   [AssetClass] [Region] [Sector?] [IndexName] [YTD%] [1M%] [3M%] [1Y%] [3Y%] [N ETF(s)]
// We parse each row by matching the trailing numeric tokens, leaving everything
// before the first percentage as the theme description.

const ROW_RE = /^(.*?)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+([-\d.]+%|-)\s+(\d+\s+ETFs?)$/;

function parseEtfRows(html: string): EtfRow[] {
  const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rows: EtfRow[] = [];
  let rank = 0;
  for (const tr of trMatches) {
    const text = tr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const m = ROW_RE.exec(text);
    if (!m) continue;
    rank++;
    rows.push({
      rank,
      theme: m[1].trim(),
      ytd:   m[2],
      m1:    m[3],
      m3:    m[4],
      y1:    m[5],
      y3:    m[6],
      count: m[7],
    });
  }
  return rows;
}

function formatEtfTable(label: string, rows: EtfRow[]): string {
  if (rows.length === 0) return `${label}: no data parsed`;
  const header = 'Rank | Theme / Index                                                      | YTD    | 1M     | 3M     | 1Y     | 3Y     | ETFs';
  const sep    = '-----|--------------------------------------------------------------------|--------|--------|--------|--------|--------|------';
  const lines  = rows.map(r =>
    `${String(r.rank).padStart(4)} | ${r.theme.substring(0, 66).padEnd(66)} | ${r.ytd.padStart(6)} | ${r.m1.padStart(6)} | ${r.m3.padStart(6)} | ${r.y1.padStart(6)} | ${r.y3.padStart(6)} | ${r.count}`
  );
  return [label, header, sep, ...lines].join('\n');
}

export async function fetchJustEtf(): Promise<string> {
  const pages = [
    { url: 'https://www.justetf.com/uk/market-overview/the-best-etfs.html',        label: '=== JustETF: Best ETFs (all categories, ranked by YTD) ===' },
    { url: 'https://www.justetf.com/uk/market-overview/the-best-sector-etfs.html', label: '=== JustETF: Best Sector ETFs (ranked by YTD) ===' },
  ];
  const results: string[] = [];

  for (const { url, label } of pages) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const rows = parseEtfRows(html);
      if (rows.length > 0) {
        results.push(formatEtfTable(label, rows));
      }
    } catch { /* ignore network errors — AI falls back to training knowledge */ }
  }

  return results.length > 0
    ? results.join('\n\n')
    : '[JustETF data unavailable — use training knowledge of current ETF flow themes for the report month]';
}
