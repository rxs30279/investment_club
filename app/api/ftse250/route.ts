import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Example: static FTSE250 data, can replace with live fetch later
    const ftse250 = [
      { date: '2025-01-01', value: 22000 },
      { date: '2025-02-01', value: 22500 },
      { date: '2025-03-01', value: 21800 },
      { date: '2025-04-01', value: 23000 },
      { date: '2025-05-01', value: 23500 },
    ];

    return NextResponse.json(ftse250);
  } catch (err) {
    console.error('Failed to fetch FTSE250:', err);
    return NextResponse.json({ error: 'Failed to fetch FTSE250' }, { status: 500 });
  }
}