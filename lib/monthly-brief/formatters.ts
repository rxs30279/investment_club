import type { IndexGroup, MetaLookup } from './holdings-meta';
import type {
  BoeMacro, DividendRow, FtseAll, MacroData,
  MonthlyPerfEntry, Position, UnitValue,
} from './types';

// Trailing 12-month dividend yield from the dividend data we already fetch.
// Unit gotcha: Yahoo returns dividend amounts in PENCE for UK tickers (e.g. 2.43
// for a 2.43p dividend), but Position.currentPrice is in POUNDS because
// /api/prices divides Yahoo's pence price by 100. Without converting to the
// same unit the yield comes out 100× too large.
function trailingYieldPct(ticker: string, currentPriceGbp: number, divs: DividendRow[]): number | null {
  if (!currentPriceGbp) return null;
  const row = divs.find(d => d.ticker === ticker);
  if (!row || row.divs.length === 0) return null;
  const annualPence  = row.divs.reduce((s, d) => s + d.amount, 0);
  const annualPounds = annualPence / 100;
  return parseFloat((annualPounds / currentPriceGbp * 100).toFixed(2));
}

export function buildPortfolioJSON(
  positions:   Position[],
  monthlyPerf: Record<string, MonthlyPerfEntry>,
  dividends:   DividendRow[],
  lookupMeta:  MetaLookup,
): string {
  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
  const items = positions.map(p => {
    const mp    = monthlyPerf[p.ticker];
    const meta  = lookupMeta(p.ticker);
    const yld   = trailingYieldPct(p.ticker, p.currentPrice, dividends);
    return {
      company:                p.name,
      ticker:                 p.ticker,
      sector:                 p.sector,
      weighting:              totalValue > 0 ? parseFloat((p.currentValue / totalValue * 100).toFixed(2)) : 0,
      purchase_price:         parseFloat(p.avgCost.toFixed(4)),
      current_price:          parseFloat(p.currentPrice.toFixed(4)),
      month_start_price:      mp ? parseFloat(mp.monthStart.toFixed(4)) : null,
      index_membership:       meta.index,
      revenue_geographic_mix: meta.revenueMix ?? '[approximate from your knowledge]',
      dividend_yield_pct:     yld ?? '[no dividend data — approximate from your knowledge]',
      market_cap_millions:    '[approximate from your knowledge]',
      monthly_change_pct:     mp ? parseFloat(mp.changePercent.toFixed(2)) : null,
      unrealised_pnl_pct:     parseFloat(p.pnlPercent.toFixed(2)),
      current_value_gbp:      parseFloat(p.currentValue.toFixed(2)),
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
  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
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
      value:   p.currentValue,
      monthly: mp ? mp.changePercent : null,
    });
  }

  return (Object.keys(groups) as IndexGroup[]).map(index => {
    const hs = groups[index].holdings;
    const groupValue = hs.reduce((s, h) => s + h.value, 0);
    const withMonthly = hs.filter(h => h.monthly !== null) as typeof hs;
    const avgMonthly = withMonthly.length === 0 || groupValue === 0
      ? null
      : parseFloat(
          (withMonthly.reduce((s, h) => s + (h.monthly! * h.value), 0) /
            withMonthly.reduce((s, h) => s + h.value, 0)
          ).toFixed(2)
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

  const monthlyReturn = latest && prev
    ? ((latest.unit_value - prev.unit_value) / prev.unit_value * 100).toFixed(2)
    : 'N/A';

  const inceptionReturn = latest && inception
    ? ((latest.unit_value - inception.unit_value) / inception.unit_value * 100).toFixed(2)
    : 'N/A';

  // YTD: compare latest unit value to the last valuation of the previous calendar year
  const currentYear = new Date().getFullYear();
  const prevYearEnd = [...sorted].reverse().find(
    v => new Date(v.valuation_date).getFullYear() < currentYear
  );
  const ytdBase = prevYearEnd ?? (latest !== inception ? inception : null);
  const ytdReturn = latest && ytdBase
    ? ((latest.unit_value - ytdBase.unit_value) / ytdBase.unit_value * 100).toFixed(2)
    : 'N/A';

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
    if (from == null || to == null) return '[DATA NEEDED — use your knowledge]';
    return `${((to - from) / from * 100).toFixed(2)}% (${window})`;
  }

  const aligned100 = pctLabel(
    ftse.ftse100.alignedFromVal, ftse.ftse100.alignedToVal,
    `${ftse.ftse100.alignedFromDate} to ${ftse.ftse100.alignedToDate} — same window as MESI monthly return`,
  );
  const aligned250 = pctLabel(
    ftse.ftse250.alignedFromVal, ftse.ftse250.alignedToVal,
    `${ftse.ftse250.alignedFromDate} to ${ftse.ftse250.alignedToDate} — same window as MESI monthly return`,
  );

  const ytd100Label = ftse.ftse100.ytdPct !== null
    ? `${ftse.ftse100.ytdPct}% (${ftse.ftse100.ytdFromDate} to ${ftse.ftse100.ytdToDate}, Yahoo Finance daily closes)`
    : '[DATA NEEDED — use your knowledge]';
  const ytd250Label = ftse.ftse250.ytdPct !== null
    ? `${ftse.ftse250.ytdPct}% (${ftse.ftse250.ytdFromDate} to ${ftse.ftse250.ytdToDate}, Yahoo Finance daily closes)`
    : '[DATA NEEDED — use your knowledge]';

  const cpiLabel = boe.ukCpi !== null
    ? `${boe.ukCpi}% (${boe.ukCpiDate ?? 'recent'}, CPI annual rate, ONS)`
    : '[DATA NEEDED]';

  const gdpLabel = boe.ukGdpQoQ !== null
    ? `${boe.ukGdpQoQ}% (${boe.ukGdpDate ?? 'recent'}, Q/Q GDP growth, ONS)`
    : '[DATA NEEDED — use your knowledge for report month]';

  return JSON.stringify({
    report_month:                    reportMonth,
    gbp_usd:                         macro.gbpUsd  ?? '[DATA NEEDED]',
    gbp_eur:                         macro.gbpEur  ?? '[DATA NEEDED]',
    oil_price_brent:                 macro.brent   ?? '[DATA NEEDED]',
    gold_price_usd:                  macro.gold    ?? '[DATA NEEDED]',
    ftse100_current:                 ftse.ftse100.current ?? '[DATA NEEDED]',
    ftse250_current:                 ftse.ftse250.current ?? '[DATA NEEDED]',
    ftse100_monthly_return_pct:      aligned100,
    ftse250_monthly_return_pct:      aligned250,
    ftse100_ytd_return_pct:          ytd100Label,
    ftse250_ytd_return_pct:          ytd250Label,
    bank_of_england_base_rate:       boe.bankRate        ?? '[DATA NEEDED]',
    gilt_yield_10yr:                 boe.giltYield10yr   ?? '[DATA NEEDED]',
    uk_cpi_latest:                   cpiLabel,
    uk_gdp_quarterly_growth:         gdpLabel,
    boe_rate_cuts_expected_next_12m: '[use your knowledge for report month]',
    uk_takeover_activity_index:      '[use your knowledge for report month]',
  }, null, 2);
}
