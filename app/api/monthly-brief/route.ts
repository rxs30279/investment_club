// app/api/monthly-brief/route.ts
//
// Generates the monthly intelligence briefing using DeepSeek (deepseek-chat).
// DeepSeek is OpenAI-compatible and ~20x cheaper than Claude Sonnet.
//
// Live data fetched server-side before the prompt is sent:
//   - Macro prices (GBP/USD, Brent, Gold)                          — Yahoo Finance
//   - FTSE 100/250 (current, YTD, MESI-aligned monthly)             — Yahoo Finance (one call per index)
//   - Bank Rate + 10yr Gilt yield                                   — Bank of England IADB
//   - UK CPI annual rate                                            — ONS generator
//   - UK GDP quarterly growth rate                                  — ONS generator
//   - ETF flow themes (best ETFs by YTD)                           — JustETF
//   - RNS summary index (last 60 trading days, portfolio tickers)   — Investegate
//   - Material RNS summaries (results, trading updates, M&A etc.)   — Investegate
//   - Director/PDMR dealing summaries                               — Investegate
//   - Dividend history (last 12 months, ex-div dates + amounts)     — Yahoo Finance
//   - Press coverage                                                — Google News RSS
//   - Index breakdown (FTSE100/250/AIM/Other %s & avg returns)     — computed in Node
//   - Trailing 12m dividend yield per holding                       — computed from dividend history
//
// DeepSeek uses its training knowledge only for fields not covered above
// (e.g. geographic revenue mix, market cap, takeover activity narrative).

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import type { RequestBody } from '@/lib/monthly-brief/types';
import {
  fetchMacroData, fetchDividendRows, formatDividendData, fetchFtseAll,
} from '@/lib/sources/yahoo';
import { fetchBoeMacro } from '@/lib/sources/boe';
import { fetchAllInvestegateData } from '@/lib/sources/investegate';
import { fetchJustEtf } from '@/lib/sources/justetf';
import { fetchPortfolioNews } from '@/lib/sources/rss';
import { fetchHoldingsMeta } from '@/lib/sources/holdings';
import { buildMetaLookup } from '@/lib/monthly-brief/holdings-meta';
import {
  buildPortfolioJSON, buildUnitValueStats, buildMacroJSON,
  buildIndexBreakdown, buildIndexBreakdownJSON,
} from '@/lib/monthly-brief/formatters';
import {
  SYSTEM_PROMPT,
  buildPart1Message, buildPart2aMessage, buildPart2bMessage,
  buildPart3aMessage, buildPart3bMessage, buildPart3cMessage,
} from '@/lib/monthly-brief/prompts';
import { callDeepSeek, cleanFragment } from '@/lib/monthly-brief/deepseek';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Allow up to 5 minutes
export const maxDuration = 300;

// Each promised section must appear as an h2 or h3 heading. If one is missing
// the model dropped it — refuse to save rather than ship a broken report.
const REQUIRED_SECTIONS: { label: string; pattern: RegExp }[] = [
  { label: '1. The Big Picture',                pattern: /<h[23][^>]*>\s*1\.\s*The Big Picture/i },
  { label: '2. ETF Flow Signal',                pattern: /<h[23][^>]*>\s*2\.\s*ETF Flow Signal/i },
  { label: '3. Outlook',                        pattern: /<h[23][^>]*>\s*3\.\s*Outlook/i },
  { label: '4. Press Coverage',                 pattern: /<h[23][^>]*>\s*4\.\s*Press Coverage/i },
  { label: '5. Portfolio vs Market',            pattern: /<h[23][^>]*>\s*5\.\s*Portfolio vs Market/i },
  { label: '6. Sector Scorecard & Theme',       pattern: /<h[23][^>]*>[^<]*6\.[^<]*Sector Scorecard/i },
  { label: '7. Income Corner',                  pattern: /<h[23][^>]*>[^<]*7\.[^<]*Income Corner/i },
  { label: '8. Results & Corporate Actions',    pattern: /<h[23][^>]*>[^<]*8\.[^<]*Results/i },
  { label: '9. Director Dealings',              pattern: /<h[23][^>]*>[^<]*9\.[^<]*Director Dealings/i },
  { label: '10. One to Watch',                  pattern: /<h[23][^>]*>[^<]*10\.[^<]*One to Watch/i },
];

function findMissingSections(html: string): string[] {
  return REQUIRED_SECTIONS.filter(s => !s.pattern.test(html)).map(s => s.label);
}

// Detect tables where data rows have a different cell count from the header.
// When the model drops a <td> mid-row, downstream cells visually shift left and
// the columns no longer align. We refuse to save rather than ship a broken table.
function findInconsistentTables(html: string): { context: string; headerCount: number; offendingRows: number[] }[] {
  const tableRe = /<h[23][^>]*>([^<]+)<\/h[23]>[\s\S]*?<table\b[\s\S]*?<\/table>/gi;
  const issues: { context: string; headerCount: number; offendingRows: number[] }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const heading = m[1].replace(/\s+/g, ' ').trim();
    const tableHtml = m[0].slice(m[0].indexOf('<table'));
    const rows = tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;
    const counts = rows.map(r => (r.match(/<t[hd]\b/gi) ?? []).length);
    const headerCount = counts[0];
    const offending = counts
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => i > 0 && c !== headerCount)
      .map(({ i }) => i);
    if (offending.length > 0) {
      issues.push({ context: heading, headerCount, offendingRows: offending });
    }
  }
  return issues;
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json(
      { error: 'DEEPSEEK_API_KEY not configured. Add it to .env.local.' },
      { status: 500 }
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Stream NDJSON events back to the client. Without this, the connection sits
  // idle for ~140s while DeepSeek generates, and intermediaries (browser tab,
  // proxies) close it with "Failed to fetch". Per-chunk progress events keep
  // bytes flowing so the connection stays warm.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object): void {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { /* controller closed */ }
      }

      try {
        send({ type: 'progress', stage: 'fetching-data' });

        // Derive the MESI monthly measurement dates from unit values so FTSE monthly
        // returns can be fetched for the exact same window — apples-to-apples comparison.
        const sortedUV   = [...body.unitValues].sort(
          (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
        );
        const mesiFromDate = sortedUV.at(-2)?.valuation_date ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
        const mesiToDate   = sortedUV.at(-1)?.valuation_date ?? new Date().toISOString().slice(0, 10);
        const perfMonth    = new Date(mesiToDate).toLocaleString('en-GB', { month: 'long' });

        // body.currentDate is the en-GB long string "18 April 2026" from the
        // client — not ISO. Use today directly for the MTD window.
        const now = new Date();
        const indexMtdWindow = `1 – ${now.getDate()} ${now.toLocaleString('en-GB', { month: 'short' })} ${now.getFullYear()}`;

        const tickers = body.positions.map(p => p.ticker);
        const [macro, boe, etfData, investegate, rawDividendRows, ftse, pressNews, metaRows] = await Promise.all([
          fetchMacroData(),
          fetchBoeMacro(),
          fetchJustEtf(),
          fetchAllInvestegateData(tickers),
          fetchDividendRows(body.positions),
          fetchFtseAll(mesiFromDate, mesiToDate),
          fetchPortfolioNews(body.positions),
          fetchHoldingsMeta(),
        ]);
        const { rnsData, directorData, materialData } = investegate;
        const lookupMeta = buildMetaLookup(metaRows);

        const dividendData = formatDividendData(rawDividendRows);

        console.log('[monthly-brief] BoE macro:', JSON.stringify(boe));
        console.log('[monthly-brief] MESI monthly window:', mesiFromDate, '→', mesiToDate);
        console.log('[monthly-brief] FTSE all:', JSON.stringify(ftse));
        console.log('[monthly-brief] Holdings meta rows from Supabase:', metaRows.length);

        const portfolioJSON       = buildPortfolioJSON(body.positions, body.monthlyPerf, rawDividendRows, lookupMeta);
        const unitValueStats      = buildUnitValueStats(body.unitValues);
        const macroJSON           = buildMacroJSON(macro, boe, ftse, body.reportMonth);
        const indexBreakdownJSON  = buildIndexBreakdownJSON(buildIndexBreakdown(body.positions, body.monthlyPerf, lookupMeta));

        // Six parallel DeepSeek calls. Splits are forced by observation:
        //   - Section 5's structured HTML drifts when bundled with section 4 (2b carve-off)
        //   - Section 6 alone is heavy enough to fill 8192 tokens
        //   - Bundling sections 6–10 hits max_tokens and silently drops late sections
        const part1Message  = buildPart1Message(
          portfolioJSON, macroJSON, etfData,
          body.reportMonth, body.currentDate,
        );
        const part2aMessage = buildPart2aMessage(
          portfolioJSON, macroJSON, materialData,
          pressNews, body.userArticles ?? '',
          body.reportMonth, body.currentDate,
        );
        const part2bMessage = buildPart2bMessage(
          portfolioJSON, macroJSON, unitValueStats, indexBreakdownJSON,
          body.reportMonth, body.currentDate, perfMonth, indexMtdWindow,
        );
        const part3aMessage = buildPart3aMessage(
          portfolioJSON, macroJSON, etfData, rnsData,
          body.reportMonth, body.currentDate,
        );
        const part3bMessage = buildPart3bMessage(
          portfolioJSON, macroJSON, materialData, dividendData,
          body.reportMonth, body.currentDate,
        );
        const part3cMessage = buildPart3cMessage(
          portfolioJSON, macroJSON, directorData,
          body.reportMonth, body.currentDate,
        );

        console.log('[monthly-brief] Launching all 6 parts in parallel. Prompt lengths:',
          part1Message.length, part2aMessage.length, part2bMessage.length,
          part3aMessage.length, part3bMessage.length, part3cMessage.length);
        send({ type: 'progress', stage: 'generating' });

        const [part1, part2a, part2b, part3a, part3b, part3c] = await Promise.all([
          callDeepSeek(SYSTEM_PROMPT, part1Message,  chars => send({ type: 'chunk', part: 1,   chars })),
          callDeepSeek(SYSTEM_PROMPT, part2aMessage, chars => send({ type: 'chunk', part: 2,   chars })),
          callDeepSeek(SYSTEM_PROMPT, part2bMessage, chars => send({ type: 'chunk', part: 2.5, chars })),
          callDeepSeek(SYSTEM_PROMPT, part3aMessage, chars => send({ type: 'chunk', part: 3,   chars })),
          callDeepSeek(SYSTEM_PROMPT, part3bMessage, chars => send({ type: 'chunk', part: 3.5, chars })),
          callDeepSeek(SYSTEM_PROMPT, part3cMessage, chars => send({ type: 'chunk', part: 3.7, chars })),
        ]);

        console.log('[monthly-brief] All parts done. Raw lengths:',
          part1.output.length, part2a.output.length, part2b.output.length,
          part3a.output.length, part3b.output.length, part3c.output.length);

        // Surface any truncation immediately. Don't bail — the report may still
        // be salvageable (we'll validate sections next) and the user wants to
        // know which part hit the wall.
        const truncatedParts: string[] = [];
        if (part1.truncated)  truncatedParts.push('1');
        if (part2a.truncated) truncatedParts.push('2a');
        if (part2b.truncated) truncatedParts.push('2b');
        if (part3a.truncated) truncatedParts.push('3a');
        if (part3b.truncated) truncatedParts.push('3b');
        if (part3c.truncated) truncatedParts.push('3c');
        if (truncatedParts.length > 0) {
          console.warn('[monthly-brief] Truncation detected in parts:', truncatedParts.join(', '));
          send({ type: 'warning', kind: 'truncated', parts: truncatedParts });
        }

        for (const [label, p] of [['1', part1], ['2a', part2a], ['2b', part2b], ['3a', part3a], ['3b', part3b], ['3c', part3c]] as const) {
          if (!p.output.trim()) {
            send({ type: 'error', error: `No content generated (part ${label}).` });
            controller.close();
            return;
          }
        }

        const htmlOutput = [part1, part2a, part2b, part3a, part3b, part3c]
          .map(p => cleanFragment(p.output))
          .join('\n');

        if (!htmlOutput.trim()) { send({ type: 'error', error: 'No content generated.' }); controller.close(); return; }

        const missing = findMissingSections(htmlOutput);
        if (missing.length > 0) {
          console.error('[monthly-brief] Missing sections:', missing);
          send({ type: 'error', error: `Generated report is missing sections: ${missing.join(', ')}. Truncated parts: ${truncatedParts.join(', ') || 'none'}. Refusing to save — try regenerating.` });
          controller.close();
          return;
        }

        const tableIssues = findInconsistentTables(htmlOutput);
        if (tableIssues.length > 0) {
          const detail = tableIssues
            .map(t => `"${t.context}" header has ${t.headerCount} cols but rows ${t.offendingRows.join(',')} differ`)
            .join(' | ');
          console.error('[monthly-brief] Table cell-count mismatch:', detail);
          send({ type: 'error', error: `Generated report has misaligned tables: ${detail}. Refusing to save — try regenerating.` });
          controller.close();
          return;
        }

        // Wrap in a proper HTML document so all fragments are rendered together.
        // Without this, if DeepSeek's Part 1 generates </html> the browser silently
        // drops everything that follows it.
        const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #111827 !important; color: #e5e7eb !important; font-family: 'Inter', sans-serif; padding: 24px; line-height: 1.6; }
  #monthly-report { background: #111827; }

  /* ── Report metadata (top of doc) ── */
  .report-meta { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 12px; margin-bottom: 24px; border-bottom: 1px solid #374151; }
  .report-meta-label { color: #9ca3af; font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; }
  .report-meta-date  { color: #6b7280; font-size: 12px; }

  /* ── Section spacing ── */
  .section { margin-bottom: 48px; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; color: #e5e7eb !important; margin-bottom: 16px; }
  th { background: #374151 !important; color: #f9fafb !important; padding: 10px 14px; text-align: left; font-size: 13px; }
  td { background: #1f2937 !important; color: #e5e7eb !important; padding: 10px 14px; border-bottom: 1px solid #374151; font-size: 13px; vertical-align: middle; }
  tr:hover td { background: #263548 !important; }

  /* Single-line cells (verdict labels, status pills) — stops emoji + word wrapping into two rows */
  .nowrap, td.nowrap { white-space: nowrap; }

  /* ── Expandable dropdowns ── */
  details { background: #1f2937; border: 1px solid #374151; border-radius: 8px; margin-top: 12px; padding: 4px 12px; }
  summary { color: #10b981; cursor: pointer; padding: 8px 0; font-size: 13px; }

  /* ── Index membership cards ── */
  .index-card { background: #1f2937; border: 1px solid #374151; border-radius: 10px; padding: 18px 20px; margin-bottom: 12px; }
  .index-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .index-card-title { color: #f9fafb; font-size: 14px; font-weight: 600; }
  .index-card-badge { background: #374151; color: #9ca3af; font-size: 11px; padding: 2px 10px; border-radius: 9999px; }
  .index-card-pct { font-size: 28px; font-weight: 700; margin-bottom: 2px; }
  .index-card-label { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
  .index-card-holdings { font-size: 12px; color: #9ca3af; margin-bottom: 8px; }
  .index-card-note { font-size: 12px; color: #6b7280; line-height: 1.5; }
  .pct-pos { color: #10b981; }
  .pct-neg { color: #ef4444; }

  /* ── Amber notice ── */
  .notice-amber { background: #451a03; border: 1px solid #92400e; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; color: #fcd34d; line-height: 1.6; }

  /* ── General ── */
  a { color: #10b981; }
  h1, h2, h3, h4 { color: #f9fafb; margin-bottom: 12px; }
  p { margin-bottom: 10px; }

  /* ── Mobile ── */
  @media (max-width: 640px) {
    body { padding: 12px; line-height: 1.5; }
    .section { margin-bottom: 32px; }
    h1 { font-size: 22px; }
    h2 { font-size: 18px; }
    h3 { font-size: 15px; }
    h4 { font-size: 14px; }

    /* Wide tables become horizontally scrollable instead of overflowing the viewport */
    table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
    th, td { padding: 8px 10px; font-size: 12px; white-space: nowrap; }

    .index-card { padding: 14px 16px; }
    .index-card-pct { font-size: 22px; }
    .index-card-title { font-size: 13px; }
    .index-card-holdings, .index-card-note { font-size: 11px; }

    .notice-amber { padding: 10px 12px; font-size: 12px; }
    details { padding: 4px 10px; }
    summary { font-size: 12px; }
  }
</style>
</head>
<body>
<div class="report-meta">
  <div class="report-meta-label">MESI Intelligence Briefing · ${body.reportMonth}</div>
  <div class="report-meta-date">Generated ${body.currentDate}</div>
</div>
${htmlOutput}
</body>
</html>`;

        send({ type: 'progress', stage: 'saving' });

        // Save to Supabase — check if a row already exists for this month, then update or insert.
        const { data: existing, error: selectError } = await supabase
          .from('monthly_reports')
          .select('id')
          .eq('report_month', body.reportMonth)
          .maybeSingle();

        if (selectError) {
          console.error('[monthly-brief] Failed to check existing report:', selectError.message);
        }

        const payload: Record<string, string> = {
          report_month: body.reportMonth,
          html: finalHtml,
          generated_at: new Date().toISOString(),
        };
        if (body.userArticles !== undefined) payload.user_articles = body.userArticles;
        const { error: dbError } = existing
          ? await supabase.from('monthly_reports').update(payload).eq('report_month', body.reportMonth)
          : await supabase.from('monthly_reports').insert(payload);

        if (dbError) console.error('[monthly-brief] Failed to save report:', dbError.message);

        send({ type: 'done', html: finalHtml, dbError: dbError?.message ?? null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[monthly-brief] Generation failed:', message);
        send({ type: 'error', error: message });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
