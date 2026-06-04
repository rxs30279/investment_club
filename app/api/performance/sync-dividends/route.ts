// app/api/performance/sync-dividends/route.ts
//
// Scans current-year treasurer PDFs for a "Dividends Received" section,
// extracts each dividend row, fuzzy-matches the company name to a holding,
// and inserts new entries into the dividends table (skipping duplicates).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
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
 * pdf-parse emits the section with the columns concatenated (no spaces) and
 * one row per line, e.g.:
 *   Dividends Received
 *   DateAmount                        ← column header
 *   Melrose05/05/20268.83
 *   Lloyds Banking Group19/05/202628.84
 *   37.67                             ← section total (no date, ignored)
 *   Members Details                   ← next section
 *
 * We anchor on the "Dividends Received" header and read rows until the first
 * line that isn't a dividend row (the total or the next section). Scoping to
 * the section is essential — the "Value of Assets" and "Investments Sold"
 * tables also contain <text><DD/MM/YYYY><amount> rows that would otherwise
 * match.
 */
function extractDividends(text: string): { company: string; date: string; amount: number }[] {
  const startIdx = text.search(/Dividends Received/i);
  if (startIdx === -1) return [];

  const results: { company: string; date: string; amount: number }[] = [];

  // A dividend row: <company><DD/MM/YYYY><amount>, no separators required.
  // Amount may carry thousands separators (e.g. 1,234.56).
  const rowRe = /^(.+?)(\d{2}\/\d{2}\/\d{4})([\d,]+\.\d{2})$/;

  let started = false;
  for (const rawLine of text.slice(startIdx).split('\n')) {
    const match = rawLine.trim().match(rowRe);
    if (match) {
      started = true;
      const company = match[1].trim();
      const date    = parseUKDate(match[2]);
      const amount  = parseFloat(match[3].replace(/,/g, ''));
      if (company && amount > 0) {
        results.push({ company, date, amount });
      }
    } else if (started) {
      // First non-row line after the rows began = section total / next section.
      break;
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

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  try {
    const url = new URL(req.url);
    const reportIdParam = url.searchParams.get('reportId');
    const targetReportId = reportIdParam ? Number(reportIdParam) : null;

    // Targeted mode (post-upload auto-trigger): process exactly that report.
    // Manual "Sync Performance": process only the single most recent report.
    // Each month's dividends are captured when its report is uploaded, so there
    // is no need to re-scan older sheets — doing so only re-flags dividends from
    // holdings that have since been sold.
    let reportsQuery = supabaseAdmin
      .from('treasurer_reports')
      .select('id, file_name, file_url, date');

    if (targetReportId !== null && Number.isFinite(targetReportId)) {
      reportsQuery = reportsQuery.eq('id', targetReportId);
    } else {
      reportsQuery = reportsQuery.order('date', { ascending: false }).limit(1);
    }

    const { data: reports, error: reportsError } = await reportsQuery;

    if (reportsError) throw reportsError;
    if (!reports?.length) {
      return NextResponse.json({
        message: targetReportId !== null
          ? `Report ${targetReportId} not found`
          : 'No reports found',
        processed: 0, skipped: 0, errors: [],
      });
    }

    // 2. Fetch holdings for name matching
    const { data: holdingsData, error: holdingsError } = await supabaseAdmin
      .from('holdings')
      .select('id, name');

    if (holdingsError) throw holdingsError;
    const holdings = (holdingsData ?? []).map(h => ({ holdingId: h.id as number, name: h.name as string }));

    // 3. Fetch existing dividends to avoid duplicates. A report can carry
    // back-dated dividends, so pull all rows and let the (holding_id|date) key
    // catch duplicates.
    const { data: existingDivs } = await supabaseAdmin
      .from('dividends')
      .select('holding_id, date');

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
