import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const sitePassword = process.env.SITE_PASSWORD;

    if (!sitePassword) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    if (password !== sitePassword) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }

    await createSession();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
