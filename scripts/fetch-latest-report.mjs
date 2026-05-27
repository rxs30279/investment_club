// Quick script: pull the most recent saved monthly_reports row and print a
// size/section summary so we can see what's actually in the current output.

import { readFileSync, writeFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const r = await fetch(
  `${SUPABASE_URL}/rest/v1/monthly_reports?select=report_month,generated_at,html&order=generated_at.desc&limit=1`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
);
const [row] = await r.json();
console.log('Report:', row.report_month, 'generated', row.generated_at);
console.log('HTML length:', row.html.length);

writeFileSync('latest-report.html', row.html);

// Print all h1/h2/h3 headings in document order
const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
console.log('\nHeadings in document order:');
let m;
while ((m = headingRe.exec(row.html))) {
  const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  console.log(`  [${m.index}] h${m[1]}: ${text.slice(0, 120)}`);
}

// Find any "Portfolio vs Market" text occurrences
const pvm = [...row.html.matchAll(/portfolio vs market/gi)];
console.log('\n"Portfolio vs Market" occurrences:', pvm.length);
for (const hit of pvm) console.log(`  @${hit.index}:`, row.html.slice(Math.max(0,hit.index-40), hit.index+80).replace(/\s+/g,' '));

// Find any "Press Coverage" text occurrences
const pc = [...row.html.matchAll(/press coverage/gi)];
console.log('\n"Press Coverage" occurrences:', pc.length);
for (const hit of pc) console.log(`  @${hit.index}:`, row.html.slice(Math.max(0,hit.index-40), hit.index+80).replace(/\s+/g,' '));
