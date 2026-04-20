// app/api/monthly-brief/route.ts
//
// Generates the monthly intelligence briefing using DeepSeek (deepseek-chat).
// DeepSeek is OpenAI-compatible and ~20x cheaper than Claude Sonnet.
//
// Live data fetched server-side before the prompt is sent:
//   - Macro prices (GBP/USD, Brent, Gold, FTSE 100/250 current)  — Yahoo Finance
//   - FTSE 100 / FTSE 250 YTD returns                            — Yahoo Finance
//   - Bank Rate + 10yr Gilt yield                                 — Bank of England IADB
//   - UK CPI annual rate                                          — ONS generator
//   - UK GDP quarterly growth rate                                — ONS generator
//   - ETF flow themes (best ETFs by YTD)                         — JustETF
//   - RNS headline index (last 60 trading days, portfolio tickers)— Investegate
//   - Material RNS summaries (results, trading updates, M&A etc.) — Investegate
//   - Director/PDMR dealing summaries                             — Investegate
//   - Dividend history (last 12 months, ex-div dates + amounts)   — Yahoo Finance
//   - Press coverage                                              — Google News RSS
//
// DeepSeek uses its training knowledge only for fields not covered above
// (e.g. index membership, geographic revenue mix, takeover activity narrative).

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import type { RequestBody } from '@/lib/monthly-brief/types';
import {
  fetchMacroData, fetchDividendRows, formatDividendData,
  fetchFtseYtd, fetchFtseAligned,
} from '@/lib/sources/yahoo';
import { fetchBoeMacro } from '@/lib/sources/boe';
import { fetchAllInvestegateData } from '@/lib/sources/investegate';
import { fetchJustEtf } from '@/lib/sources/justetf';
import { fetchPortfolioNews } from '@/lib/sources/rss';
import {
  buildPortfolioJSON, buildUnitValueStats, buildMacroJSON,
} from '@/lib/monthly-brief/formatters';
import {
  buildPart1Message, buildPart2aMessage, buildPart2bMessage, buildPart3Message,
} from '@/lib/monthly-brief/prompts';
import { callDeepSeek, cleanFragment } from '@/lib/monthly-brief/deepseek';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Allow up to 5 minutes
export const maxDuration = 300;

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
        const [macro, boe, etfData, investegate, rawDividendRows, ftseYtd, ftseAligned, pressNews] = await Promise.all([
          fetchMacroData(),
          fetchBoeMacro(),
          fetchJustEtf(),
          fetchAllInvestegateData(tickers),
          fetchDividendRows(body.positions),
          fetchFtseYtd(),
          fetchFtseAligned(mesiFromDate, mesiToDate),
          fetchPortfolioNews(body.positions),
        ]);
        const { rnsData, directorData, materialData } = investegate;

        const dividendData = formatDividendData(rawDividendRows);

        console.log('[monthly-brief] BoE macro:', JSON.stringify(boe));
        console.log('[monthly-brief] MESI monthly window:', mesiFromDate, '→', mesiToDate);
        console.log('[monthly-brief] FTSE aligned:', JSON.stringify(ftseAligned));

        const portfolioJSON  = buildPortfolioJSON(body.positions, body.monthlyPerf);
        const unitValueStats = buildUnitValueStats(body.unitValues);
        const macroJSON      = buildMacroJSON(macro, boe, ftseYtd, ftseAligned, body.reportMonth);

        const systemPrompt =
          'You are a friendly but knowledgeable investment analyst writing a monthly performance report for a UK private investment club. ' +
          'Your tone is warm, engaging and accessible - think a knowledgeable friend explaining markets over a coffee, not a stuffy City broker. ' +
          'Use plain English. Explain jargon where used. Reserve detailed analysis for expandable drop-down sections so the page stays clean and readable. ' +
          'Where you express a forward view, be clear it is opinion not advice.';

        // Four parallel DeepSeek calls. Section 5 (Portfolio vs Market) gets its
        // own call (Part 2b) because bundling it with section 4 caused DeepSeek
        // to derail mid-dropdown and drop section 5 entirely.
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
          portfolioJSON, macroJSON, unitValueStats,
          body.reportMonth, body.currentDate, perfMonth, indexMtdWindow,
        );
        const part3Message  = buildPart3Message(
          portfolioJSON, macroJSON, etfData, rnsData, materialData,
          dividendData, directorData,
          body.reportMonth, body.currentDate,
        );

        console.log('[monthly-brief] Launching all 4 parts in parallel. Prompt lengths:', part1Message.length, part2aMessage.length, part2bMessage.length, part3Message.length);
        send({ type: 'progress', stage: 'generating' });

        const [part1Raw, part2aRaw, part2bRaw, part3Raw] = await Promise.all([
          callDeepSeek(systemPrompt, part1Message,  chars => send({ type: 'chunk', part: 1,  chars })),
          callDeepSeek(systemPrompt, part2aMessage, chars => send({ type: 'chunk', part: 2,  chars })),
          callDeepSeek(systemPrompt, part2bMessage, chars => send({ type: 'chunk', part: 2.5, chars })),
          callDeepSeek(systemPrompt, part3Message,  chars => send({ type: 'chunk', part: 3,  chars })),
        ]);

        console.log('[monthly-brief] All parts done. Raw lengths:', part1Raw.length, part2aRaw.length, part2bRaw.length, part3Raw.length);

        if (!part1Raw.trim())  { send({ type: 'error', error: 'No content generated (part 1).' });  controller.close(); return; }
        if (!part2aRaw.trim()) { send({ type: 'error', error: 'No content generated (part 2a).' }); controller.close(); return; }
        if (!part2bRaw.trim()) { send({ type: 'error', error: 'No content generated (part 2b).' }); controller.close(); return; }
        if (!part3Raw.trim())  { send({ type: 'error', error: 'No content generated (part 3).' });  controller.close(); return; }

        const part1Html  = cleanFragment(part1Raw);
        const part2aHtml = cleanFragment(part2aRaw);
        const part2bHtml = cleanFragment(part2bRaw);
        const part3Html  = cleanFragment(part3Raw);

        const htmlOutput = part1Html + '\n' + part2aHtml + '\n' + part2bHtml + '\n' + part3Html;

        if (!htmlOutput.trim()) { send({ type: 'error', error: 'No content generated.' }); controller.close(); return; }

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

  /* ── Section spacing ── */
  .section { margin-bottom: 48px; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; color: #e5e7eb !important; margin-bottom: 16px; }
  th { background: #374151 !important; color: #f9fafb !important; padding: 10px 14px; text-align: left; font-size: 13px; }
  td { background: #1f2937 !important; color: #e5e7eb !important; padding: 10px 14px; border-bottom: 1px solid #374151; font-size: 13px; }
  tr:hover td { background: #263548 !important; }

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
