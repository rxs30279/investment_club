// app/api/performance/sync-dividends/route.ts
//
// Scans current-year treasurer PDFs for a "Dividends Received" section,
// extracts each dividend row, fuzzy-matches the company name to a holding,
// and inserts new entries into the dividends table (skipping duplicates).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
const pdfParse = require('pdf-parse-fork');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseUKDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

async function downloadPdf(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Extract dividend rows from PDF text.
 *
 * Expected section format in the PDF:
 *   Dividends Received Date Amount
 *   Celebrus Technologie 14/01/2026 4.36
 *   4.36                              ← section total (no date, ignored)
 */
function extractDividends(text: string): { company: string; date: string; amount: number }[] {
  // Confirm the section exists
  if (!/Dividends Received/i.test(text)) return [];

  const results: { company: string; date: string; amount: number }[] = [];

  // Match any line containing: <text> <DD/MM/YYYY> <decimal>
  const rowRe = /^(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+\.\d{2})\s*$/gm;
  let match;
  while ((match = rowRe.exec(text)) !== null) {
    const company = match[1].trim();
    const date    = parseUKDate(match[2]);
    const amount  = parseFloat(match[3]);
    if (company && amount > 0) {
      results.push({ company, date, amount });
    }
  }

  return results;
}

/**
 * Fuzzy-match a (possibly truncated) PDF company name to the best holding.
 * Scores by longest common prefix (case-insensitive). Requires ≥ 4 chars match.
 */
function matchHolding(
  pdfName: string,
  holdings: { holdingId: number; name: string }[]
): number | null {
  const norm = pdfName.toLowerCase().trim();
  let best: { holdingId: number; score: number } | null = null;

  for (const h of holdings) {
    const hNorm = h.name.toLowerCase();
    let score = 0;
    for (let i = 0; i < Math.min(norm.length, hNorm.length); i++) {
      if (norm[i] === hNorm[i]) score++;
      else break;
    }
    if (score >= 4 && (!best || score > best.score)) {
      best = { holdingId: h.holdingId, score };
    }
  }

  return best?.holdingId ?? null;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST() {
  try {
    const currentYear = new Date().getFullYear();
    const yearStart   = `${currentYear}-01-01`;

    // 1. Fetch current-year treasurer reports
    const { data: reports, error: reportsError } = await supabaseAdmin
      .from('treasurer_reports')
      .select('id, file_name, file_url, date')
      .gte('date', yearStart)
      .order('date', { ascending: true });

    if (reportsError) throw reportsError;
    if (!reports?.length) {
      return NextResponse.json({
        message: `No ${currentYear} reports found`,
        processed: 0, skipped: 0, errors: [],
      });
    }

    // 2. Fetch holdings for name matching
    const { data: holdingsData, error: holdingsError } = await supabaseAdmin
      .from('holdings')
      .select('id, name');

    if (holdingsError) throw holdingsError;
    const holdings = (holdingsData ?? []).map(h => ({ holdingId: h.id as number, name: h.name as string }));

    // 3. Fetch existing current-year dividends to avoid duplicates
    const { data: existingDivs } = await supabaseAdmin
      .from('dividends')
      .select('holding_id, date')
      .gte('date', yearStart);

    const existingSet = new Set(
      (existingDivs ?? []).map(d => `${d.holding_id}|${d.date}`)
    );

    // 4. Get next available ID
    const { data: maxIdRow } = await supabaseAdmin
      .from('dividends')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);

    let nextId = ((maxIdRow?.[0]?.id as number) ?? 0) + 1;

    // 5. Process each report
    type ResultEntry = { file_name: string; status: 'ok' | 'skipped' | 'error'; detail?: string };
    const results: ResultEntry[] = [];
    const toInsert: { id: number; holding_id: number; date: string; amount: number; currency: string; notes: string }[] = [];

    for (const report of reports) {
      if (!report.file_url) {
        results.push({ file_name: report.file_name, status: 'error', detail: 'No file URL' });
        continue;
      }

      try {
        const pdfBuffer = await downloadPdf(report.file_url);
        const { text }  = await pdfParse(pdfBuffer);
        const divRows   = extractDividends(text);

        if (divRows.length === 0) {
          results.push({ file_name: report.file_name, status: 'skipped', detail: 'No dividends found' });
          continue;
        }

        let added = 0;
        for (const div of divRows) {
          const holdingId = matchHolding(div.company, holdings);
          if (!holdingId) {
            results.push({ file_name: report.file_name, status: 'error', detail: `No match for: "${div.company}"` });
            continue;
          }

          const key = `${holdingId}|${div.date}`;
          if (existingSet.has(key)) continue; // already recorded

          toInsert.push({
            id:         nextId++,
            holding_id: holdingId,
            date:       div.date,
            amount:     div.amount,
            currency:   'GBP',
            notes:      `Auto-extracted from ${report.file_name}`,
          });
          existingSet.add(key);
          added++;
        }

        results.push({ file_name: report.file_name, status: 'ok', detail: `${added} dividend(s) added` });
      } catch (err) {
        results.push({
          file_name: report.file_name,
          status: 'error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 6. Bulk insert
    if (toInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('dividends')
        .insert(toInsert);
      if (insertError) throw insertError;
    }

    return NextResponse.json({
      message: `Dividend sync complete — ${toInsert.length} new dividend(s) added`,
      processed: toInsert.length,
      skipped:   results.filter(r => r.status === 'skipped').length,
      errors:    results.filter(r => r.status === 'error'),
    });

  } catch (err) {
    console.error('[sync-dividends] Fatal error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// GET — debug: returns raw PDF text from the first current-year report
export async function GET() {
  try {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const { data: reports } = await supabaseAdmin
      .from('treasurer_reports')
      .select('file_name, file_url')
      .gte('date', yearStart)
      .order('date', { ascending: true })
      .limit(1);

    if (!reports?.length) return NextResponse.json({ error: 'No current-year reports found' });

    const pdfBuffer = await downloadPdf(reports[0].file_url);
    const { text }  = await pdfParse(pdfBuffer);
    return NextResponse.json({ file_name: reports[0].file_name, text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
