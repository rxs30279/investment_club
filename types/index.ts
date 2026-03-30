// Basic holding structure
export interface Holding {
  id: number;
  name: string;
  ticker: string;
  shares: number;
  avgCost: number;
  sector: string;
  purchaseDate: string;
}

export interface Transaction {
  id: number;
  holdingId: number;
  type: 'buy' | 'sell';
  date: string;
  shares: number;
  pricePerShare: number;
  totalCost: number;
  commission?: number;
  feeBreakdown?: {
    fixedFee: number;
    percentageFee: number;
    percentageAmount: number;
    totalFees: number;
  };
}

// Current position
export interface Position {
  holdingId: number;
  name: string;
  ticker: string;
  sector: string;
  shares: number;
  avgCost: number;
  totalCost: number;
  costBasis: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
}

// Holding with price
export interface HoldingWithPrice extends Position {
  costBasis: number;
}

// Portfolio summary
export interface PortfolioSummary {
  holdings: HoldingWithPrice[];
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  holdingCount: number;
}

// API response for prices
export interface PriceResponse {
  [ticker: string]: number;
}

// Quick stats
export interface QuickStats {
  bestPerformer: { name: string; return: number } | null;
  worstPerformer: { name: string; return: number } | null;
  averageReturn: number;
  winningCount: number;
  totalCount: number;
}

// Performance data
export interface PerformanceData {
  dates: string[];
  portfolioValues: number[];
  ftse100Values: number[];
  ftse250Values: number[];
  cumulativeReturns: number[];
  cumulativeFtse100Returns: number[];
}

// Dividend record
export interface Dividend {
  id: number;
  holdingId: number;
  date: string;
  amount: number;
  currency: string;
  notes?: string;
}
// Stock fundamentals data
export interface StockFundamentals {
  price: number;
  high52Week: number;
  low52Week: number;
  percent52Week: number;
  exDividendDate: string;
  nextEarnings: string;
  dividend: number;
  dividendYield: number;
  peTTM: number;
  forwardPE: number;
  beta: number;
  marketCap: number;
}