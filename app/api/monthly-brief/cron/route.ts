// app/api/monthly-brief/cron/route.ts
//
// Vercel Cron entry point — vercel.json schedules a GET here at 23:00 UTC on
// the 12th of each month (midnight BST, i.e. the early hours of the 13th UK
// time in summer). That sits well inside DeepSeek's off-peak discount window
// (16:30–00:30 UTC, 50–75% off, judged on request *completion* time) with
// margin for cron jitter and generation time, and avoids their Beijing
// peak-hour surcharges (01:00–04:00 and 06:00–10:00 UTC — which is exactly
// the UK early-morning slot, so don't move it there).
// Builds the same request body the /manage page
// assembles in the browser (see generateBrief in app/manage/page.tsx), then
// runs it through the existing POST /api/monthly-brief pipeline and drains
// the NDJSON stream so the function stays alive until the report is saved.

import { NextRequest } from 'next/server';
import { getTransactions, calculatePositions } from '@/lib/portfolio';
import { getUnitValues } from '@/lib/performance';
import { supabase } from '@/lib/supabase';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Vercel sends `Authorization: Bearer ${CRON_SECRET}` with cron invocations
  // when the env var is set. Fail closed if it isn't.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Self-fetches must hit this same deployment. Cron only runs on production,
  // where VERCEL_PROJECT_PRODUCTION_URL is set; the request origin covers
  // local dev.
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : new URL(request.url).origin;

  try {
    const [transactions, unitValues, pricesRes] = await Promise.all([
      getTransactions(),
      getUnitValues(),
      fetch(`${origin}/api/prices`),
    ]);
    if (!pricesRes.ok) throw new Error(`/api/prices failed: ${pricesRes.status}`);
    const prices = await pricesRes.json();
    const positions = await calculatePositions(transactions, prices);
    if (positions.length === 0) {
      throw new Error('No positions computed — refusing to generate an empty brief.');
    }

    // Member articles from the last 2 months, same window as the manage page.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 2);
    const { data: articles } = await supabase
      .from('member_articles')
      .select('contributor_name, title, body')
      .gte('added_at', cutoff.toISOString())
      .order('added_at', { ascending: false });
    const userArticles = articles?.length
      ? articles.map(a => `[${a.contributor_name}] "${a.title}"\n${a.body}`).join('\n\n---\n\n')
      : '';

    const tickers = positions.map(p => p.ticker).filter(Boolean);
    const mpRes = await fetch(`${origin}/api/monthly-performance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    });
    const monthlyPerf = mpRes.ok ? await mpRes.json() : {};

    const reportMonth = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    console.log(`[monthly-brief-cron] Generating "${reportMonth}" (${positions.length} positions).`);

    const res = await fetch(`${origin}/api/monthly-brief`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.MANAGE_API_SECRET ? { 'x-admin-secret': process.env.MANAGE_API_SECRET } : {}),
      },
      body: JSON.stringify({
        positions, monthlyPerf, unitValues, reportMonth,
        currentDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        userArticles,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`monthly-brief POST failed: ${res.status} ${await res.text().catch(() => '')}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let htmlLength = 0;
    let dbError: string | null = null;
    let genError: string | null = null;
    const warnings: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'done')    { htmlLength = evt.html?.length ?? 0; dbError = evt.dbError; }
        if (evt.type === 'error')   genError = evt.error;
        if (evt.type === 'warning') warnings.push(JSON.stringify(evt));
      }
    }

    if (genError) throw new Error(genError);
    if (dbError) throw new Error(`Report generated but failed to save: ${dbError}`);
    if (htmlLength === 0) throw new Error('Stream ended without a done event.');

    console.log(`[monthly-brief-cron] Saved "${reportMonth}" (${htmlLength} chars).`);
    return Response.json({ ok: true, reportMonth, htmlLength, warnings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[monthly-brief-cron] Failed:', message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
