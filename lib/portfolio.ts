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