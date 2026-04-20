import { NextResponse } from 'next/server';

const ADMIN_SECRET = process.env.MANAGE_API_SECRET;

let warnedMissing = false;

export function requireAdmin(req: Request): NextResponse | null {
  if (!ADMIN_SECRET) {
    if (!warnedMissing) {
      console.warn('[requireAdmin] MANAGE_API_SECRET not set — admin routes are UNPROTECTED. Set it in .env.local to enable.');
      warnedMissing = true;
    }
    return null;
  }
  const provided = req.headers.get('x-admin-secret');
  if (provided !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
