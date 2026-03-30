// lib/portfolio.ts
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
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .order('id', { ascending: true });
  
  if (error) {
    console.error('Error fetching holdings:', error);
    return [];
  }
  
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
    if (!response.ok) throw new Error('Failed to fetch prices');
    return await response.json();
  } catch (error) {
    console.error('Error fetching prices:', error);
    return {};
  }
}

// ==================== POSITIONS ====================
export async function calculatePositions(transactions: Transaction[], currentPrices: PriceResponse): Promise<Position[]> {
  const holdings = await getHoldingsReference();
  const holdingInfo = new Map<number, { name: string; ticker: string; sector: string }>();
  holdings.forEach(h => {
    holdingInfo.set(h.id, { name: h.name, ticker: h.ticker, sector: h.sector });
  });

  const positionMap = new Map<number, { shares: number; totalCost: number; name: string; ticker: string; sector: string; holdingId: number }>();
  
  const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  for (const tx of sortedTransactions) {
    const info = holdingInfo.get(tx.holdingId);
    let pos = positionMap.get(tx.holdingId);
    
    if (!pos) {
      pos = { shares: 0, totalCost: 0, name: info?.name || `Holding ${tx.holdingId}`, ticker: info?.ticker || '', sector: info?.sector || 'Other', holdingId: tx.holdingId };
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

  const positions: Position[] = [];
  positionMap.forEach(pos => {
    if (pos.shares <= 0) return;
    const currentPrice = currentPrices[pos.ticker] || 0;
    const currentValue = currentPrice * pos.shares;
    const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
    const pnl = currentValue - pos.totalCost;
    const pnlPercent = pos.totalCost > 0 ? (pnl / pos.totalCost) * 100 : 0;

    positions.push({ holdingId: pos.holdingId, name: pos.name, ticker: pos.ticker, sector: pos.sector, shares: pos.shares, avgCost, totalCost: pos.totalCost, currentPrice, currentValue, pnl, pnlPercent });
  });

  return positions;
}

// ==================== PORTFOLIO SUMMARY ====================
export function calculatePortfolioSummary(positions: Position[]): PortfolioSummary {
  let totalValue = 0;
  let totalCost = 0;

  positions.forEach(p => { totalValue += p.currentValue; totalCost += p.totalCost; });

  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return { holdings: positions, totalValue, totalCost, totalPnl, totalPnlPercent, holdingCount: positions.length };
}

// ==================== FTSE DATA ====================
export async function fetchFTSE100Data(): Promise<{ date: string; value: number }[]> {
  try {
    const res = await fetch('/api/ftse100');
    if (!res.ok) throw new Error('Failed to fetch FTSE100');
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch FTSE100:', err);
    return [];
  }
}

export async function fetchFTSE250Data(): Promise<{ date: string; value: number }[]> {
  try {
    const res = await fetch('/api/ftse250');
    if (!res.ok) throw new Error('Failed to fetch FTSE250');
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch FTSE250:', err);
    return [];
  }
}

