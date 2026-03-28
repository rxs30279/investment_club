import { Transaction, Position, PortfolioSummary, PriceResponse, Dividend, PerformanceData, StockFundamentals } from '@/types';
import holdingsReference from '@/app/data/holdings-reference.json';
import initialTransactions from '@/app/data/portfolio-data.json';
import dividendsData from '@/app/data/dividends.json';

// Storage keys
const STORAGE_KEY = 'investment-club-transactions';
const DIVIDENDS_STORAGE_KEY = 'investment-club-dividends';

// ==================== TRANSACTIONS ====================
export function getTransactions(): Transaction[] {
  if (typeof window === 'undefined') {
    return initialTransactions.transactions as Transaction[];
  }
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored) as Transaction[];
  }
  return initialTransactions.transactions as Transaction[];
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
export function getHoldingsReference() {
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
  holdingsReference.holdings.forEach((h: any) => {
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

// ==================== FTSE DATA ====================
export async function fetchFTSE100Data(): Promise<{ date: string; value: number }[]> {
  try {
    const response = await fetch('/api/ftse');
    if (!response.ok) {
      throw new Error('Failed to fetch FTSE data');
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching FTSE data:', error);
    return [];
  }
}

// ==================== PORTFOLIO VALUE ON DATE ====================
export async function calculatePortfolioValueOnDate(date: string): Promise<number> {
  try {
    const transactions = getTransactions();
    const holdings = getHoldingsReference();
    const currentPrices = await fetchPrices();
    const holdingInfo = new Map();
    holdings.forEach((h: any) => {
      holdingInfo.set(h.id, { ticker: h.ticker });
    });
    
    const relevantTransactions = transactions.filter(t => t.date <= date);
    const positionMap = new Map<number, { shares: number; totalCost: number; ticker: string }>();
    
    const sortedTransactions = [...relevantTransactions].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    for (const tx of sortedTransactions) {
      const info = holdingInfo.get(tx.holdingId);
      if (!info) continue;
      
      let pos = positionMap.get(tx.holdingId);
      if (!pos) {
        pos = { shares: 0, totalCost: 0, ticker: info.ticker };
        positionMap.set(tx.holdingId, pos);
      }
      
      if (tx.type === 'buy') {
        pos.shares += tx.shares;
        pos.totalCost += tx.totalCost;
      } else if (tx.type === 'sell') {
        const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
        pos.shares -= tx.shares;
        pos.totalCost -= avgCost * tx.shares;
      }
    }
    
    let totalValue = 0;
    for (const [_, pos] of positionMap) {
      if (pos.shares <= 0) continue;
      const price = currentPrices[pos.ticker] || 0;
      totalValue += price * pos.shares;
    }
    
    return totalValue;
  } catch (error) {
    console.error('Error calculating portfolio value:', error);
    return 0;
  }
}

// ==================== MONTHLY RETURNS (Simple Version) ====================
export async function generateRealMonthlyReturns(transactions: Transaction[]): Promise<{ month: string; portfolioReturn: number; ftseReturn: number }[]> {
  // Get FTSE data for comparison
  const ftseData = await fetchFTSE100Data();
  
  // Sample monthly returns based on your actual data
  const monthlyReturns = [
    { month: 'JAN', portfolioReturn: 17.62, ftseReturn: 2.74 },
    { month: 'FEB', portfolioReturn: 4.10, ftseReturn: 5.50 },
    { month: 'MAR', portfolioReturn: -14.08, ftseReturn: -7.57 },
  ];
  
  // Only return months up to current month
  const currentMonth = new Date().getMonth();
  return monthlyReturns.slice(0, currentMonth + 1);
}

// ==================== ALPHA VANTAGE (Optional) ====================
export async function fetchAlphaVantageFundamentals(ticker: string): Promise<StockFundamentals> {
  // Return empty fundamentals for now
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

// ==================== HISTORICAL PRICES (Stubs) ====================
export async function fetchHistoricalPricesForTicker(ticker: string, range: string = '2y'): Promise<Map<string, number>> {
  return new Map();
}

export async function calculateHistoricalPortfolioValue(
  transactions: Transaction[],
  targetDate: string,
  historicalPriceMaps: Map<string, Map<string, number>>
): Promise<number> {
  return 0;
}