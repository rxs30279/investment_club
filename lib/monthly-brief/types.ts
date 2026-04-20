export interface Position {
  name: string; ticker: string; sector: string;
  shares: number; avgCost: number; totalCost: number;
  currentPrice: number; currentValue: number;
  pnl: number; pnlPercent: number;
}

export interface MonthlyPerfEntry { monthStart: number; current: number; changePercent: number; }
export interface UnitValue      { valuation_date: string; unit_value: number; }
export interface BenchmarkPoint { date: string; value: number; }

export interface RequestBody {
  positions:    Position[];
  monthlyPerf:  Record<string, MonthlyPerfEntry>;
  unitValues:   UnitValue[];
  ftse100:      BenchmarkPoint[];
  ftse250:      BenchmarkPoint[];
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

export interface FtseAligned {
  ftse100From:    number | null;
  ftse100To:      number | null;
  ftse250From:    number | null;
  ftse250To:      number | null;
  fromDate:       string;
  toDate:         string;
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
  ftse100: number | null;
  ftse250: number | null;
}
