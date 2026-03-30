// lib/performance.ts
//
// Data-fetching helpers for the performance page.
// Follows the same patterns as lib/portfolio.ts.

import { supabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UnitValue {
  id: number;
  report_id: number;
  file_name: string;
  valuation_date: string;   // "YYYY-MM-DD"
  unit_value: number;
  created_at: string;
}

export interface BenchmarkPoint {
  date: string;   // "YYYY-MM-DD"
  value: number;  // rebased to 100 from portfolio start
}

export interface BenchmarkData {
  ftse100: BenchmarkPoint[];
  ftse250: BenchmarkPoint[];
}

export interface PerformanceSummary {
  currentUnitValue: number;
  firstUnitValue: number;
  totalReturnPercent: number;
  bestMonth: { date: string; change: number } | null;
  worstMonth: { date: string; change: number } | null;
  monthCount: number;
}

// ── Unit values ───────────────────────────────────────────────────────────────

/** Fetch all stored unit values ordered by valuation date ascending */
export async function getUnitValues(): Promise<UnitValue[]> {
  const { data, error } = await supabase
    .from('unit_values')
    .select('*')
    .order('valuation_date', { ascending: true });

  if (error) {
    console.error('Error fetching unit values:', error);
    return [];
  }

  return data || [];
}

/** Trigger the sync API route — processes any new PDFs in treasurer-reports */
export async function syncUnitValues(): Promise<{
  message: string;
  processed: number;
  skipped: number;
  errors: { file_name: string; detail?: string }[];
}> {
  const res = await fetch('/api/performance/sync', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Sync failed with status ${res.status}`);
  }
  return res.json();
}

// ── Benchmark data ────────────────────────────────────────────────────────────

/**
 * Fetch rebased FTSE 100 + FTSE 250 data.
 * Pass the earliest valuation date so the API can align the rebase point.
 */
export async function fetchBenchmarkData(fromDate?: string): Promise<BenchmarkData> {
  try {
    const url = fromDate
      ? `/api/performance/benchmarks?from=${fromDate}`
      : '/api/performance/benchmarks';

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Benchmarks request failed: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch benchmark data:', err);
    return { ftse100: [], ftse250: [] };
  }
}

// ── Summary stats ─────────────────────────────────────────────────────────────

/**
 * Derive summary statistics from the unit_values array.
 * Monthly change = ((thisMonth - lastMonth) / lastMonth) * 100
 */
export function calcPerformanceSummary(unitValues: UnitValue[]): PerformanceSummary | null {
  if (unitValues.length === 0) return null;

  const sorted = [...unitValues].sort(
    (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
  );

  const first   = sorted[0].unit_value;
  const current = sorted[sorted.length - 1].unit_value;
  const totalReturnPercent = ((current - first) / first) * 100;

  // Monthly changes
  type MonthChange = { date: string; change: number };
  const monthlyChanges: MonthChange[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].unit_value;
    const curr = sorted[i].unit_value;
    monthlyChanges.push({
      date:   sorted[i].valuation_date,
      change: ((curr - prev) / prev) * 100,
    });
  }

  const best  = monthlyChanges.length
    ? monthlyChanges.reduce((a, b) => (b.change > a.change ? b : a))
    : null;
  const worst = monthlyChanges.length
    ? monthlyChanges.reduce((a, b) => (b.change < a.change ? b : a))
    : null;

  return {
    currentUnitValue:   current,
    firstUnitValue:     first,
    totalReturnPercent,
    bestMonth:          best,
    worstMonth:         worst,
    monthCount:         sorted.length,
  };
}

/**
 * Convert raw unit values into a rebased series (first point = 100)
 * so they can be overlaid directly with FTSE benchmark lines.
 */
export function rebaseUnitValues(unitValues: UnitValue[]): BenchmarkPoint[] {
  if (unitValues.length === 0) return [];
  const sorted = [...unitValues].sort(
    (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
  );
  const base = sorted[0].unit_value;
  return sorted.map(uv => ({
    date:  uv.valuation_date,
    value: parseFloat(((uv.unit_value / base) * 100).toFixed(4)),
  }));
}
