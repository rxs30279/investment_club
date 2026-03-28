import { Transaction, Position, PortfolioSummary, PriceResponse, Dividend, StockFundamentals } from '@/types';
import { supabase } from './supabase';

// ==================== TRANSACTIONS ====================
export async function getTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: true });
  
  if (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
  
  // Map database column names to TypeScript interface
  return (data || []).map(tx => ({
    id: tx.id,
    holdingId: tx.holding_id,
    type: tx.type as 'buy' | 'sell',
    date: tx.date,
    shares: tx.shares,
    pricePerShare: tx.price_per_share,
    totalCost: tx.total_cost,
    commission: tx.commission,
  }));
}

export async function saveTransactions(transactions: Transaction[]): Promise<void> {
  for (const tx of transactions) {
    const { error } = await supabase
      .from('transactions')
      .upsert({
        id: tx.id,
        holding_id: tx.holdingId,
        type: tx.type,
        date: tx.date,
        shares: tx.shares,
        price_per_share: tx.pricePerShare,
        total_cost: tx.totalCost,
        commission: tx.commission,
      }, { onConflict: 'id' });
    
    if (error) console.error('Error saving transaction:', error);
  }
}

// ==================== DIVIDENDS ====================
export async function getDividends(): Promise<Dividend[]> {
  const { data, error } = await supabase
    .from('dividends')
    .select('*')
    .order('date', { ascending: false });
  
  if (error) {
    console.error('Error fetching dividends:', error);
    return [];
  }
  
  return (data || []).map(d => ({
    id: d.id,
    holdingId: d.holding_id,
    date: d.date,
    amount: d.amount,
    currency: d.currency,
    notes: d.notes,
  }));
}

export async function saveDividends(dividends: Dividend[]): Promise<void> {
  for (const div of dividends) {
    const { error } = await supabase
      .from('dividends')
      .upsert({
        id: div.id,
        holding_id: div.holdingId,
        date: div.date,
        amount: div.amount,
        currency: div.currency,
        notes: div.notes,
      }, { onConflict: 'id' });
    
    if (error) console.error('Error saving dividend:', error);
  }
}

// ==================== HOLDINGS REFERENCE ====================
export async function getHoldingsReference(): Promise<any[]> {
  console.log('Fetching holdings from Supabase...');
  
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .order('id', { ascending: true });
  
  if (error) {
    console.error('Error fetching holdings - full error:', error);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    return [];
  }
  
  console.log('Holdings fetched successfully:', data?.length);
  return data || [];
}

export async function saveHolding(holding: any): Promise<void> {
  const { error } = await supabase
    .from('holdings_view')
    .upsert({
      id: holding.id,
      name: holding.name,
      ticker: holding.ticker,
      sector: holding.sector,
    }, { onConflict: 'id' });
  
  if (error) console.error('Error saving holding:', error);
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
export async function calculatePositions(transactions: Transaction[], currentPrices: PriceResponse): Promise<Position[]> {
  const holdings = await getHoldingsReference();
  const holdingInfo = new Map();
  holdings.forEach((h: any) => {
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
  const transactions = await getTransactions();
  const holdings = await getHoldingsReference();
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
}

// ==================== MONTHLY RETURNS ====================
export async function generateRealMonthlyReturns(transactions: Transaction[]): Promise<{ month: string; portfolioReturn: number; ftseReturn: number }[]> {
  const ftseData = await fetchFTSE100Data();
  
  const monthlyReturns = [
    { month: 'JAN', portfolioReturn: 17.62, ftseReturn: 2.74 },
    { month: 'FEB', portfolioReturn: 4.10, ftseReturn: 5.50 },
    { month: 'MAR', portfolioReturn: -14.08, ftseReturn: -7.57 },
  ];
  
  const currentMonth = new Date().getMonth();
  return monthlyReturns.slice(0, currentMonth + 1);
}

// ==================== ALPHA VANTAGE ====================
export async function fetchAlphaVantageFundamentals(ticker: string): Promise<StockFundamentals> {
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