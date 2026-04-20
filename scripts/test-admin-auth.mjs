// Smoke test: admin auth gate on /api/monthly-brief, /api/performance/sync,
// /api/performance/sync-dividends.
//
// For each endpoint we send three POSTs:
//   - no header         → expect 401
//   - wrong header      → expect 401
//   - correct header    → expect NOT 401 (any other status is fine — we just
//                         want to verify we got past the gate; an empty body
//                         will 400 before any expensive work happens)
//
// Run: node scripts/test-admin-auth.mjs
// Env: TARGET (default http://localhost:3000), MANAGE_API_SECRET (from .env.local)

import { readFileSync } from 'node:fs';

const env = {};
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  console.warn('Could not read .env.local — relying on process.env');
}

// Trim whitespace (Windows `set FOO=bar && cmd` captures the trailing space
// into FOO) and strip trailing slashes so `${TARGET}${path}` can't produce //.
const TARGET = (process.env.TARGET ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
const SECRET = env.MANAGE_API_SECRET ?? process.env.MANAGE_API_SECRET;

if (!SECRET) {
  console.error('MANAGE_API_SECRET is not set. The gate is currently fail-open — set it in .env.local to test the protected state.');
  process.exit(1);
}

const ENDPOINTS = [
  '/api/monthly-brief',
  '/api/performance/sync',
  '/api/performance/sync-dividends',
];

let pass = 0;
let fail = 0;

async function hit(path, headers, label) {
  // Abort fast — we only care about the status, not the body. The monthly-brief
  // endpoint streams for ~140s on happy path; we'll abort after 3s which is
  // plenty to see a 401 but cuts short any work that slipped past the gate.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${TARGET}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
      signal: ctrl.signal,
    });
    return { status: res.status };
  } catch (err) {
    // aborted fetches show up here — treat as "got past gate, was doing work"
    if (err.name === 'AbortError') return { status: 'aborted (past gate)' };
    return { status: `error: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function check(label, actual, expected) {
  // A connection error (fetch failed / ECONNREFUSED) must never count as pass,
  // even for the "not-401" case — it means the server isn't reachable.
  const isConnError = typeof actual === 'string' && actual.startsWith('error:');
  const ok = isConnError ? false
    : expected === 'not-401' ? actual !== 401
    : actual === expected;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}: got ${actual}, expected ${expected}`);
  ok ? pass++ : fail++;
}

console.log(`Target: ${TARGET}`);
console.log(`Secret: ${SECRET.replace(/./g, '*').slice(0, 8)}... (${SECRET.length} chars)\n`);

for (const path of ENDPOINTS) {
  console.log(`POST ${path}`);
  const noHeader    = await hit(path, {});
  const wrongHeader = await hit(path, { 'x-admin-secret': 'wrong-value' });
  const goodHeader  = await hit(path, { 'x-admin-secret': SECRET });

  check('no header',    noHeader.status,    401);
  check('wrong header', wrongHeader.status, 401);
  check('good header',  goodHeader.status,  'not-401');
  console.log();
}

console.log(`Results: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
