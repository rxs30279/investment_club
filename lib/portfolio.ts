import { Transaction, Position, PortfolioSummary, PriceResponse, Dividend, PerformanceData, StockFundamentals } from '@/types';
import holdingsReference from '@/app/data/holdings-reference.json';
import initialTransactions from '@/app/data/portfolio-data.json';
import dividendsData from '@/app/data/dividends.json';

// Storage keys
const STORAGE_KEY = 'investment-club-transactions';
const DIVIDENDS_STORAGE_KEY = 'investment-club-dividends';

// Cache for historical prices
let historicalPriceCache: Map<string, Map<string, number>> = new Map();

// ==================== TRANSACTIONS ====================
export function getTransactions(): Transaction[] {
  if (typeof window === 'undefined') {
    return initialTransactions.transactions;
  }
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  return initialTransactions.transactions;
}

export function saveTransactions(transactions: Transaction[]): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }
}

// ==================== DIVIDENDS ====================
export function getDividends(): Dividend[] {
  if (typeof window === 'undefined') {
    return dividendsData.dividends;
  }
  
  const stored = localStorage.getItem(DIVIDENDS_STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  return dividendsData.dividends;
}

export function saveDividends(dividends: Dividend[]): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(DIVIDENDS_STORAGE_KEY, JSON.stringify(dividends));
  }
}

// ==================== HOLDINGS REFERENCE ====================
// Get holdings reference from localStorage (with fallback to JSON file)
export function getHoldingsReference() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('investment-club-holdings-ref');
    if (stored) {
      return JSON.parse(stored);
    }
  }
  return holdingsReference.holdings;
}

// ==================== PRICES ====================
export async function fetchPrices(): Promise<PriceResponse> {
  try {
    const response = await fetch('/api/prices');
    if (!response.ok) {
      throw new Error('Failed to fetch prices from API');
    }
    const prices = await response.json();
    return prices;
  } catch (error) {
    console.error('Error fetching prices:', error);
    return {};
  }
}

// ==================== POSITIONS ====================
export function calculatePositions(transactions: Transaction[], currentPrices: PriceResponse): Position[] {
  const holdingInfo = new Map();
  holdingsReference.holdings.forEach(h => {
    holdingInfo.set(h.id, {
      name: h.name,
      ticker: h.ticker,
      sector: h.sector,
    });
  });
  
  const positionMap = new Map<number, { 
    shares: number; 
    totalCost: number; 
    name: string; 
    ticker: string; 
    sector: string;
    holdingId: number;
  }>();
  
  const sortedTransactions = [...transactions].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  for (const tx of sortedTransactions) {
    const info = holdingInfo.get(tx.holdingId);
    let position = positionMap.get(tx.holdingId);
    
    if (!position) {
      position = {
        shares: 0,
        totalCost: 0,
        name: info?.name || `Holding ${tx.holdingId}`,
        ticker: info?.ticker || '',
        sector: info?.sector || 'Other',
        holdingId: tx.holdingId,
      };
      positionMap.set(tx.holdingId, position);
    }
    
    if (tx.type === 'buy') {
      position.shares += tx.shares;
      position.totalCost += tx.totalCost;
    } else if (tx.type === 'sell') {
      const avgCost = position.shares > 0 ? position.totalCost / position.shares : 0;
      const costToRemove = avgCost * tx.shares;
      position.shares -= tx.shares;
      position.totalCost -= costToRemove;
    }
    
    positionMap.set(tx.holdingId, position);
  }
  
  const positions: Position[] = [];
  
  for (const [holdingId, pos] of positionMap) {
    if (pos.shares <= 0) continue;
    
    const currentPrice = currentPrices[pos.ticker] || 0;
    const currentValue = currentPrice * pos.shares;
    const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
    const pnl = currentValue - pos.totalCost;
    const pnlPercent = pos.totalCost > 0 ? (pnl / pos.totalCost) * 100 : 0;
    
    positions.push({
      holdingId,
      name: pos.name,
      ticker: pos.ticker,
      sector: pos.sector,
      shares: pos.shares,
      avgCost,
      totalCost: pos.totalCost,
      currentPrice,
      currentValue,
      pnl,
      pnlPercent,
    });
  }
  
  return positions;
}

// ==================== PORTFOLIO SUMMARY ====================
export function calculatePortfolioSummary(positions: Position[]): PortfolioSummary {
  let totalValue = 0;
  let totalCost = 0;
  
  positions.forEach(pos => {
    totalValue += pos.currentValue;
    totalCost += pos.totalCost;
  });
  
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  
  return {
    holdings: positions.map(p => ({ 
      ...p, 
      id: p.holdingId,
      avgCost: p.avgCost,
      currentPrice: p.currentPrice,
      currentValue: p.currentValue,
      costBasis: p.totalCost,
      pnl: p.pnl,
      pnlPercent: p.pnlPercent,
    })),
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPercent,
    holdingCount: positions.length,
  };
}

// ==================== QUICK STATS ====================
export function calculateQuickStats(holdings: Position[]): {
  bestPerformer: { name: string; return: number } | null;
  worstPerformer: { name: string; return: number } | null;
  averageReturn: number;
  winningCount: number;
} {
  if (holdings.length === 0) {
    return {
      bestPerformer: null,
      worstPerformer: null,
      averageReturn: 0,
      winningCount: 0,
    };
  }
  
  const sortedByReturn = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent);
  const bestPerformer = sortedByReturn[0];
  const worstPerformer = sortedByReturn[sortedByReturn.length - 1];
  
  const averageReturn = holdings.reduce((sum, h) => sum + h.pnlPercent, 0) / holdings.length;
  const winningCount = holdings.filter(h => h.pnlPercent > 0).length;
  
  return {
    bestPerformer: bestPerformer ? { name: bestPerformer.name, return: bestPerformer.pnlPercent } : null,
    worstPerformer: worstPerformer ? { name: worstPerformer.name, return: worstPerformer.pnlPercent } : null,
    averageReturn,
    winningCount,
  };
}

// ==================== ALPHA VANTAGE ====================
export async function fetchAlphaVantageFundamentals(ticker: string): Promise<StockFundamentals> {
  try {
    const cleanTicker = ticker.replace('.L', '');
    const response = await fetch('/api/alpha-vantage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: cleanTicker }),
    });
    
    if (!response.ok) {
      throw new Error(`Alpha Vantage API returned ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching Alpha Vantage data for ${ticker}:`, error);
    return {
      price: 0,
      high52Week: 0,
      low52Week: 0,
      percent52Week: 0,
      exDividendDate: 'N/A',
      nextEarnings: 'N/A',
      dividend: 0,
      dividendYield: 0,
      peTTM: 0,
      forwardPE: 0,
      beta: 0,
      marketCap: 0,
    };
  }
}

// ==================== HISTORICAL PRICES (Stubs for performance page) ====================
export async function fetchHistoricalPricesForTicker(ticker: string, range: string = '2y'): Promise<Map<string, number>> {
  // Simple stub for now
  return new Map();
}

export async function calculateHistoricalPortfolioValue(
  transactions: Transaction[],
  targetDate: string,
  historicalPriceMaps: Map<string, Map<string, number>>
): Promise<number> {
  return 0;
}

export async function calculatePortfolioValueOnDate(date: string): Promise<number> {
  return 0;
}

export async function fetchFTSE100Data(): Promise<{ date: string; value: number }[]> {
  return [];
}

export async function generateRealMonthlyReturns(transactions: Transaction[]): Promise<{ month: string; portfolioReturn: number; ftseReturn: number }[]> {
  return [];
}

export async function fetchFundamentals(ticker: string): Promise<StockFundamentals> {
  return fetchAlphaVantageFundamentals(ticker);
}