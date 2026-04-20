import type { BoeMacro, FtseAligned, MacroData, MonthlyPerfEntry, Position, UnitValue } from './types';

export function buildPortfolioJSON(
  positions: Position[],
  monthlyPerf: Record<string, MonthlyPerfEntry>
): string {
  const totalValue = positions.reduce((s, p) => s + p.currentValue, 0);
  const items = positions.map(p => {
    const mp = monthlyPerf[p.ticker];
    return {
      company:                p.name,
      ticker:                 p.ticker,
      sector:                 p.sector,
      weighting:              totalValue > 0 ? parseFloat((p.currentValue / totalValue * 100).toFixed(2)) : 0,
      purchase_price:         parseFloat(p.avgCost.toFixed(4)),
      current_price:          parseFloat(p.currentPrice.toFixed(4)),
      month_start_price:      mp ? parseFloat(mp.monthStart.toFixed(4)) : null,
      index_membership:       '[determine from your knowledge — FTSE100 / FTSE250 / AIM]',
      revenue_geographic_mix: '[determine from your knowledge — Global / Domestic / Mixed]',
      dividend_yield:         '[determine from your knowledge]',
      market_cap_millions:    '[determine from your knowledge]',
      monthly_change_pct:     mp ? parseFloat(mp.changePercent.toFixed(2)) : null,
      unrealised_pnl_pct:     parseFloat(p.pnlPercent.toFixed(2)),
      current_value_gbp:      parseFloat(p.currentValue.toFixed(2)),
    };
  });
  return JSON.stringify(items, null, 2);
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
  ftseYtd:     { ftse100Ytd: number | null; ftse250Ytd: number | null },
  ftseAligned: FtseAligned,
  reportMonth: string
): string {
  const ftse100Monthly = ftseAligned.ftse100From && ftseAligned.ftse100To
    ? ((ftseAligned.ftse100To - ftseAligned.ftse100From) / ftseAligned.ftse100From * 100).toFixed(2)
    : null;
  const ftse250Monthly = ftseAligned.ftse250From && ftseAligned.ftse250To
    ? ((ftseAligned.ftse250To - ftseAligned.ftse250From) / ftseAligned.ftse250From * 100).toFixed(2)
    : null;

  const alignedWindow = `${ftseAligned.fromDate} to ${ftseAligned.toDate} — same window as MESI monthly return`;

  const ftse100MonthlyLabel = ftse100Monthly !== null
    ? `${ftse100Monthly}% (${alignedWindow})`
    : '[DATA NEEDED — use your knowledge]';
  const ftse250MonthlyLabel = ftse250Monthly !== null
    ? `${ftse250Monthly}% (${alignedWindow})`
    : '[DATA NEEDED — use your knowledge]';

  const ytdFromDate = `${new Date().getFullYear()}-01-01`;
  const ytdToDate   = new Date().toISOString().slice(0, 10);

  const ftse100YtdLabel = ftseYtd.ftse100Ytd !== null
    ? `${ftseYtd.ftse100Ytd}% (${ytdFromDate} to ${ytdToDate}, Yahoo Finance daily closes)`
    : '[DATA NEEDED — use your knowledge]';

  const ftse250YtdLabel = ftseYtd.ftse250Ytd !== null
    ? `${ftseYtd.ftse250Ytd}% (${ytdFromDate} to ${ytdToDate}, Yahoo Finance daily closes)`
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
    ftse100_current:                 macro.ftse100 ?? '[DATA NEEDED]',
    ftse250_current:                 macro.ftse250 ?? '[DATA NEEDED]',
    ftse100_monthly_return_pct:      ftse100MonthlyLabel,
    ftse250_monthly_return_pct:      ftse250MonthlyLabel,
    ftse100_ytd_return_pct:          ftse100YtdLabel,
    ftse250_ytd_return_pct:          ftse250YtdLabel,
    bank_of_england_base_rate:       boe.bankRate        ?? '[DATA NEEDED]',
    gilt_yield_10yr:                 boe.giltYield10yr   ?? '[DATA NEEDED]',
    uk_cpi_latest:                   cpiLabel,
    uk_gdp_quarterly_growth:         gdpLabel,
    boe_rate_cuts_expected_next_12m: '[use your knowledge for report month]',
    uk_takeover_activity_index:      '[use your knowledge for report month]',
  }, null, 2);
}
