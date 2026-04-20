// app/api/performance/sync/route.ts
//
// Called when the admin clicks "Sync" on the performance page.
// 1. Fetches all rows from treasurer_reports (which holds file_url + file_name)
// 2. Compares against unit_values to find unprocessed files
// 3. Downloads each new PDF, extracts Unit Value + Valuation Date via regex
// 4. Inserts results into unit_values
//
// PDF text extraction is done entirely in JavaScript using pdf-parse,
// which works in the Next.js Node.js runtime without any native dependencies.
//
// Install once:  npm install pdf-parse
//                npm install --save-dev @types/pdf-parse

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
// pdf-parse is CommonJS — require() is needed for Turbopack compatibility
const pdfParse = require('pdf-parse-fork');

// ── Supabase admin client (service role key, never exposed to the browser) ──
// Add SUPABASE_SERVICE_ROLE_KEY to your .env.local
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Regex patterns (verified against real PDF text) ──────────────────────────
const UNIT_VALUE_RE   = /Unit Value[\s\S]*?(\d+\.\d{4})(?:\s)/;
const VAL_DATE_RE     = /(\d{2}\/\d{2}\/\d{4})/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse "DD/MM/YYYY" → "YYYY-MM-DD" (Postgres date format) */
function parseUKDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

/** Download a PDF from its public URL and return a Buffer */
async function downloadPdf(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.status} ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Extract unit value and valuation date from raw PDF text */
// Updated extraction — now also pulls total_assets and total_units
function extractFromText(text: string): {
  unitValue: number;
  valuationDate: string;
  totalAssets: number;
  totalUnits: number;
} | null {
  const valDateMatch   = /Valuation Date[\s\S]{0,30}?(\d{2}\/\d{2}\/\d{4})/.exec(text);
  const unitValueMatch = /Unit Value[\s\S]{0,30}?(\d+\.\d{4})/.exec(text);
  const totalUnitsMatch = /Total No\. Units[\s\S]{0,30}?([\d,]+\.\d{2})/.exec(text);
  const netAssetsMatch  = /Net Assets[\s\S]{0,30}?([\d,]+\.\d{2})/.exec(text);

  if (!valDateMatch || !unitValueMatch) return null;

  const unitValue  = parseFloat(unitValueMatch[1]);
  const totalUnits = totalUnitsMatch ? parseFloat(totalUnitsMatch[1].replace(/,/g, '')) : 0;
  const totalAssets = netAssetsMatch ? parseFloat(netAssetsMatch[1].replace(/,/g, '')) : 0;

  if (isNaN(unitValue) || unitValue < 1 || unitValue > 10000) return null;

  return {
    unitValue,
    valuationDate: parseUKDate(valDateMatch[1]),
    totalAssets,
    totalUnits,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  try {
    // 1. Load all treasurer reports from DB
    const { data: reports, error: reportsError } = await supabaseAdmin
      .from('treasurer_reports')
      .select('id, file_name, file_url, date')
      .order('date', { ascending: true });

    if (reportsError) throw reportsError;
    if (!reports || reports.length === 0) {
      return NextResponse.json({ message: 'No reports found', processed: 0, skipped: 0, errors: [] });
    }

    // 2. Load already-processed file names so we skip them
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('unit_values')
      .select('file_name');

    if (existingError) throw existingError;

    const processedFileNames = new Set((existing || []).map(r => r.file_name));

    // 3. Filter to only new files
    const newReports = reports.filter(r => r.file_name && !processedFileNames.has(r.file_name));

    if (newReports.length === 0) {
      return NextResponse.json({
        message: 'All reports already processed — nothing new to sync',
        processed: 0,
        skipped: reports.length,
        errors: [],
      });
    }

    // 4. Process each new PDF
    const results: { file_name: string; status: 'ok' | 'error'; detail?: string }[] = [];
    const toInsert: {
  report_id: number;
  file_name: string;
  valuation_date: string;
  unit_value: number;
}[] = [];

    for (const report of newReports) {
      try {
        if (!report.file_url) {
          results.push({ file_name: report.file_name, status: 'error', detail: 'No file URL' });
          continue;
        }

        // Download + parse PDF
        const pdfBuffer = await downloadPdf(report.file_url);
        const { text }  = await pdfParse(pdfBuffer);
        const extracted = extractFromText(text);

        if (!extracted) {
          results.push({
            file_name: report.file_name,
            status: 'error',
            detail: `Could not find Unit Value or Valuation Date in PDF text. First 500 chars: ${text.slice(0, 500).replace(/\n/g, ' ')}`,
          });
          continue;
        }

        toInsert.push({
          report_id:      report.id,
          file_name:      report.file_name,
          valuation_date: extracted.valuationDate,
          unit_value:     extracted.unitValue,
        });

        results.push({ file_name: report.file_name, status: 'ok' });
      } catch (err) {
        results.push({
          file_name: report.file_name,
          status: 'error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 5. Bulk insert all successfully parsed rows
    if (toInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('unit_values')
        .insert(toInsert);

      if (insertError) {
        console.error('[performance/sync] Insert error:', insertError);
        return NextResponse.json({
          message: `DB insert failed — ${insertError.message}`,
          processed: 0,
          skipped: reports.length - newReports.length,
          errors: [{ file_name: 'bulk-insert', status: 'error', detail: insertError.message }],
        });
      }
    }

    const errorResults = results.filter(r => r.status === 'error');
    if (errorResults.length > 0) {
      console.error('[performance/sync] Extraction errors:', JSON.stringify(errorResults, null, 2));
    }

    return NextResponse.json({
      message: `Sync complete — ${toInsert.length} new record(s) added`,
      processed: toInsert.length,
      skipped: reports.length - newReports.length,
      errors: errorResults,
    });

  } catch (err) {
    console.error('[performance/sync] Fatal error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// Allow GET so you can test in the browser — returns current unit_values
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('unit_values')
      .select('*')
      .order('valuation_date', { ascending: true });

    if (error) {
      console.error('[performance/sync GET] Supabase error:', error);
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details, hint: error.hint },
        { status: 500 }
      );
    }
    return NextResponse.json({ unit_values: data });
  } catch (err) {
    console.error('[performance/sync GET] Unexpected error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : JSON.stringify(err) },
      { status: 500 }
    );
  }
}