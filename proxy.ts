import { NextRequest, NextResponse } from 'next/server';

// Authentication is handled client-side by AuthGuard using localStorage.
// This proxy passes all requests through without interference.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}
