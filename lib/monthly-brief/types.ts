export interface Position {
  name: string; ticker: string; sector: string;
  shares: number; avgCost: number; totalCost: number;
  currentPrice: number; currentValue: number;
  pnl: number; pnlPercent: number;
}

export interface MonthlyPerfEntry { monthStart: number; current: number; changePercent: number; }
export interface UnitValue      { valuation_date: string; unit_value: number; }

export interface RequestBody {
  positions:    Position[];
  monthlyPerf:  Record<string, MonthlyPerfEntry>;
  unitValues:   UnitValue[];
  reportMonth:  string;
  currentDate:  string;
  userArticles?: string;
}

export interface BoeMacro {
  bankRate:      number | null;
  giltYield10yr: number | null;
  ukCpi:         number | null;
  ukCpiDate:     string | null;
  ukGdpQoQ:      number | null;
  ukGdpDate:     string | null;
}

export interface DividendEvent { date: string; amount: number; }
export interface DividendRow   { ticker: string; name: string; divs: DividendEvent[]; }

// All FTSE figures derived from one Yahoo call per index, covering the YTD
// window so current price, YTD %, and the MESI-aligned monthly window are
// all extracted from the same series.
export interface FtseSeries {
  current:        number | null;
  ytdPct:         number | null;
  ytdFromDate:    string;
  ytdToDate:      string;
  alignedFromVal: number | null;
  alignedToVal:   number | null;
  alignedFromDate: string;
  alignedToDate:   string;
}

export interface FtseAll {
  ftse100: FtseSeries;
  ftse250: FtseSeries;
}

export interface RnsItem { date: string; ticker: string; headline: string; url: string; }

export interface InvestegateData {
  rnsData:      string;
  directorData: string;
  materialData: string;
}

export interface EtfRow {
  rank:  number;
  theme: string;
  ytd:   string;
  m1:    string;
  m3:    string;
  y1:    string;
  y3:    string;
  count: string;
}

export interface NewsItem {
  company: string;
  title:   string;
  source:  string;
  date:    string;
}

export interface MacroData {
  gbpUsd: number | null;
  gbpEur: number | null;
  brent:  number | null;
  gold:   number | null;
}
