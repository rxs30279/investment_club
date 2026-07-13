import type { IndexGroup, MetaLookup } from './holdings-meta';
import type {
  BoeMacro, DividendRow, FtseAll, MacroData,
  MonthlyPerfEntry, Position, UnitValue,
} from './types';

// The request body arrives as untrusted JSON — a field typed `number` can be
// null, undefined, NaN or a string at runtime. Every arithmetic path below
// goes through these guards so bad data degrades to null/'N/A' in the prompt
// instead of crashing generation.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round(v: unknown, dp: number): number | null {
  const n = finiteNum(v);
  return n === null ? null : parseFloat(n.toFixed(dp));
}

// Trailing 12-month dividend yield from the dividend data we already fetch.
// Unit gotcha: Yahoo returns dividend amounts in PENCE for UK tickers (e.g. 2.43
// for a 2.43p dividend), but Position.currentPrice is in POUNDS because
// /api/prices divides Yahoo's pence price by 100. Without converting to the
// same unit the yield comes out 100× too large.
function trailingYieldPct(ticker: string, currentPriceGbp: number, divs: DividendRow[]): number | null {
  const price = finiteNum(currentPriceGbp);
  if (!price || price <= 0) return null;
  const row = divs.find(d => d.ticker === ticker);
  if (!row || row.divs.length === 0) return null;
  const annualPence  = row.divs.reduce((s, d) => s + (finiteNum(d.amount) ?? 0), 0);
  const annualPounds = annualPence / 100;
  return round(annualPounds / price * 100, 2);
}

export function buildPortfolioJSON(
  positions:   Position[],
  monthlyPerf: Record<string, MonthlyPerfEntry>,
  dividends:   DividendRow[],
  lookupMeta:  MetaLookup,
): string {
  const totalValue = positions.reduce((s, p) => s + (finiteNum(p.currentValue) ?? 0), 0);
  const items = positions.map(p => {
    const mp    = monthlyPerf[p.ticker];
    const meta  = lookupMeta(p.ticker);
    const yld   = trailingYieldPct(p.ticker, p.currentPrice, dividends);
    const value = finiteNum(p.currentValue);
    return {
      company:                p.name,
      ticker:                 p.ticker,
      sector:                 p.sector,
      weighting:              totalValue > 0 && value !== null ? round(value / totalValue * 100, 2) : 0,
      purchase_price:         round(p.avgCost, 4),
      current_price:          round(p.currentPrice, 4),
      month_start_price:      round(mp?.monthStart, 4),
      index_membership:       meta.index,
      revenue_geographic_mix: meta.revenueMix ?? '[approximate from your knowledge]',
      dividend_yield_pct:     yld ?? '[no dividend data — approximate from your knowledge]',
      market_cap_millions:    '[approximate from your knowledge]',
      monthly_change_pct:     round(mp?.changePercent, 2),
      unrealised_pnl_pct:     round(p.pnlPercent, 2),
      current_value_gbp:      round(p.currentValue, 2),
    };
  });
  return JSON.stringify(items, null, 2);
}

export interface IndexBreakdownGroup {
  index:        IndexGroup;
  holdingCount: number;
  weighting:    number;     // sum of weightings %
  avgMonthly:   number | null;
  tickers:      string[];
  companies:    string[];
}

// Aggregate per-stock monthly moves into FTSE100 / FTSE250 / AIM / Other groups
// so DeepSeek doesn't have to do the arithmetic. Weighting is by current value
// (apples-to-apples with portfolio weighting); monthly is a simple value-weighted
// average within the group.
export function buildIndexBreakdown(
  positions:   Position[],
  monthlyPerf: Record<string, MonthlyPerfEntry>,
  lookupMeta:  MetaLookup,
): IndexBreakdownGroup[] {
  const totalValue = positions.reduce((s, p) => s + (finiteNum(p.currentValue) ?? 0), 0);
  const groups: Record<IndexGroup, {
    holdings: { ticker: string; company: string; value: number; monthly: number | null }[];
  }> = {
    FTSE100: { holdings: [] },
    FTSE250: { holdings: [] },
    AIM:     { holdings: [] },
    Other:   { holdings: [] },
  };

  for (const p of positions) {
    const idx = lookupMeta(p.ticker).index;
    const mp  = monthlyPerf[p.ticker];
    groups[idx].holdings.push({
      ticker:  p.ticker,
      company: p.name,
      value:   finiteNum(p.currentValue) ?? 0,
      monthly: finiteNum(mp?.changePercent),
    });
  }

  return (Object.keys(groups) as IndexGroup[]).map(index => {
    const hs = groups[index].holdings;
    const groupValue = hs.reduce((s, h) => s + h.value, 0);
    const withMonthly = hs.filter(h => h.monthly !== null) as typeof hs;
    const monthlyValueSum = withMonthly.reduce((s, h) => s + h.value, 0);
    const avgMonthly = withMonthly.length === 0 || monthlyValueSum === 0
      ? null
      : round(
          withMonthly.reduce((s, h) => s + (h.monthly! * h.value), 0) / monthlyValueSum,
          2,
        );
    return {
      index,
      holdingCount: hs.length,
      weighting:    totalValue > 0 ? parseFloat((groupValue / totalValue * 100).toFixed(2)) : 0,
      avgMonthly,
      tickers:      hs.map(h => h.ticker),
      companies:    hs.map(h => h.company),
    };
  }).filter(g => g.holdingCount > 0);
}

export function buildIndexBreakdownJSON(groups: IndexBreakdownGroup[]): string {
  return JSON.stringify(groups, null, 2);
}

export function buildUnitValueStats(unitValues: UnitValue[]): string {
  const sorted = [...unitValues].sort(
    (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
  );
  const latest    = sorted.at(-1);
  const prev      = sorted.at(-2);
  const inception = sorted[0];

  // 'N/A' when either endpoint is missing or the base is 0 (division by zero).
  function pctBetween(from: UnitValue | null | undefined, to: UnitValue | null | undefined): string {
    const f = finiteNum(from?.unit_value);
    const t = finiteNum(to?.unit_value);
    return f && t !== null ? ((t - f) / f * 100).toFixed(2) : 'N/A';
  }

  const monthlyReturn   = pctBetween(prev, latest);
  const inceptionReturn = pctBetween(inception, latest);

  // YTD: compare latest unit value to the last valuation of the previous calendar year
  const currentYear = new Date().getFullYear();
  const prevYearEnd = [...sorted].reverse().find(
    v => new Date(v.valuation_date).getFullYear() < currentYear
  );
  const ytdBase = prevYearEnd ?? (latest !== inception ? inception : null);
  const ytdReturn = pctBetween(ytdBase, latest);

  return JSON.stringify({
    latest_unit_value:         latest?.unit_value,
    latest_date:               latest?.valuation_date,
    monthly_return_pct:        monthlyReturn,
    monthly_measured_from:     prev?.valuation_date ?? 'N/A',
    monthly_measured_to:       latest?.valuation_date ?? 'N/A',
    ytd_return_pct:            ytdReturn,
    ytd_measured_from:         ytdBase?.valuation_date ?? 'N/A',
    ytd_measured_to:           latest?.valuation_date ?? 'N/A',
    inception_return_pct:      inceptionReturn,
    inception_date:            inception?.valuation_date,
    note: 'monthly_return_pct and ytd_return_pct are AUTHORITATIVE — calculated from club unit values in Supabase. Use these figures in the Section 4 headline performance table. Show the measured_from and measured_to dates alongside each figure so readers can see the exact window. The per-stock monthly_change_pct values in PORTFOLIO are for the stock-by-stock dropdown detail only.',
  }, null, 2);
}

export function buildMacroJSON(
  macro:       MacroData,
  boe:         BoeMacro,
  ftse:        FtseAll,
  reportMonth: string,
): string {
  function pctLabel(from: number | null, to: number | null, window: string): string {
    const f = finiteNum(from);
    const t = finiteNum(to);
    if (!f || t === null) return '[DATA NEEDED — use your knowledge]';
    return `${((t - f) / f * 100).toFixed(2)}% (${window})`;
  }

  const aligned100 = pctLabel(
    ftse.ftse100.alignedFromVal, ftse.ftse100.alignedToVal,
    `${ftse.ftse100.alignedFromDate} to ${ftse.ftse100.alignedToDate} — same window as MESI monthly return`,
  );
  const aligned250 = pctLabel(
    ftse.ftse250.alignedFromVal, ftse.ftse250.alignedToVal,
    `${ftse.ftse250.alignedFromDate} to ${ftse.ftse250.alignedToDate} — same window as MESI monthly return`,
  );

  const ytd100Label = finiteNum(ftse.ftse100.ytdPct) !== null
    ? `${ftse.ftse100.ytdPct}% (${ftse.ftse100.ytdFromDate} to ${ftse.ftse100.ytdToDate}, Yahoo Finance daily closes)`
    : '[DATA NEEDED — use your knowledge]';
  const ytd250Label = finiteNum(ftse.ftse250.ytdPct) !== null
    ? `${ftse.ftse250.ytdPct}% (${ftse.ftse250.ytdFromDate} to ${ftse.ftse250.ytdToDate}, Yahoo Finance daily closes)`
    : '[DATA NEEDED — use your knowledge]';

  const cpiLabel = finiteNum(boe.ukCpi) !== null
    ? `${boe.ukCpi}% (${boe.ukCpiDate ?? 'recent'}, CPI annual rate, ONS)`
    : '[DATA NEEDED]';

  const gdpLabel = finiteNum(boe.ukGdpQoQ) !== null
    ? `${boe.ukGdpQoQ}% (${boe.ukGdpDate ?? 'recent'}, Q/Q GDP growth, ONS)`
    : '[DATA NEEDED — use your knowledge for report month]';

  return JSON.stringify({
    report_month:                    reportMonth,
    gbp_usd:                         finiteNum(macro.gbpUsd)  ?? '[DATA NEEDED]',
    gbp_eur:                         finiteNum(macro.gbpEur)  ?? '[DATA NEEDED]',
    oil_price_brent:                 finiteNum(macro.brent)   ?? '[DATA NEEDED]',
    gold_price_usd:                  finiteNum(macro.gold)    ?? '[DATA NEEDED]',
    ftse100_current:                 finiteNum(ftse.ftse100.current) ?? '[DATA NEEDED]',
    ftse250_current:                 finiteNum(ftse.ftse250.current) ?? '[DATA NEEDED]',
    ftse100_monthly_return_pct:      aligned100,
    ftse250_monthly_return_pct:      aligned250,
    ftse100_ytd_return_pct:          ytd100Label,
    ftse250_ytd_return_pct:          ytd250Label,
    bank_of_england_base_rate:       finiteNum(boe.bankRate)      ?? '[DATA NEEDED]',
    gilt_yield_10yr:                 finiteNum(boe.giltYield10yr) ?? '[DATA NEEDED]',
    uk_cpi_latest:                   cpiLabel,
    uk_gdp_quarterly_growth:         gdpLabel,
    boe_rate_cuts_expected_next_12m: '[use your knowledge for report month]',
    uk_takeover_activity_index:      '[use your knowledge for report month]',
  }, null, 2);
}
