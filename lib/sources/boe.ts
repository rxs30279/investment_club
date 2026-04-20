import type { BoeMacro } from '../monthly-brief/types';

// BoE IADB API returns multi-series CSV; most-recent row is the latest value.
// ONS generator returns annual CSV; last quoted row is the latest month.

/** Parse latest value from BoE IADB multi-series CSV.
 *  Format after header block: DATE,COL1,COL2,...  */
function parseBoeCsv(csv: string, colIndex: number): number | null {
  const lines = csv.split('\n').filter(l => l.trim());
  let dataStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{2}\s+[A-Z][a-z]{2}\s+\d{4}/.test(lines[i])) { dataStart = i; break; }
  }
  if (dataStart === -1) return null;
  for (let i = lines.length - 1; i >= dataStart; i--) {
    const parts = lines[i].split(',');
    const val = parts[colIndex]?.trim();
    if (val && val !== '') {
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    }
  }
  return null;
}

/** Parse latest value + period label from ONS generator CSV.
 *  Period formats seen: "YYYY MON" (monthly, e.g. "2026 FEB"),
 *  "YYYY QN" (quarterly, e.g. "2025 Q4"). Values may be negative. */
function parseOnsCsv(csv: string): { value: number | null; period: string | null } {
  const lines = csv.split('\n').filter(l => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^"(\d{4}\s+[A-Z][A-Z0-9]+)","(-?[\d.]+)"/);
    if (m) return { value: parseFloat(m[2]), period: m[1] };
  }
  return { value: null, period: null };
}

export async function fetchBoeMacro(): Promise<BoeMacro> {
  const boeFetch = fetch(
    'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp' +
    '?csv.x=yes&SeriesCodes=IUDBEDR,IUDMNPY&CSVF=TT&UsingCodes=Y&Datefrom=01/Jan/2025&Dateto=now',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    }
  );

  // ONS CPI annual rate (D7G7 from MM23 dataset)
  const onsFetch = fetch(
    'https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/d7g7/mm23',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    }
  );

  // ONS GDP quarterly growth rate (IHYQ Q/Q %, QNA dataset)
  const gdpFetch = fetch(
    'https://www.ons.gov.uk/generator?format=csv&uri=/economy/grossdomesticproductgdp/timeseries/ihyq/qna',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(10000),
    }
  );

  const [boeRes, onsRes, gdpRes] = await Promise.allSettled([boeFetch, onsFetch, gdpFetch]);

  let bankRate: number | null = null;
  let giltYield10yr: number | null = null;
  if (boeRes.status === 'fulfilled' && boeRes.value.ok) {
    const csv = await boeRes.value.text();
    bankRate      = parseBoeCsv(csv, 1);
    giltYield10yr = parseBoeCsv(csv, 2);
  }

  let ukCpi: number | null = null;
  let ukCpiDate: string | null = null;
  if (onsRes.status === 'fulfilled' && onsRes.value.ok) {
    const csv = await onsRes.value.text();
    const parsed = parseOnsCsv(csv);
    ukCpi     = parsed.value;
    ukCpiDate = parsed.period;
  }

  let ukGdpQoQ: number | null = null;
  let ukGdpDate: string | null = null;
  if (gdpRes.status === 'fulfilled' && gdpRes.value.ok) {
    const csv = await gdpRes.value.text();
    const parsed = parseOnsCsv(csv);
    ukGdpQoQ = parsed.value;
    ukGdpDate = parsed.period;
  }

  return { bankRate, giltYield10yr, ukCpi, ukCpiDate, ukGdpQoQ, ukGdpDate };
}
