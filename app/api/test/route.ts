import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('holdings')  // Changed from 'holdings'
      .select('*')
      .limit(5);
    
    if (error) {
      console.error('Test API error:', error);
      return NextResponse.json({ success: false, error: error.message, code: error.code });
    }
    
    return NextResponse.json({ success: true, data, count: data?.length });
  } catch (err) {
    console.error('Test API unexpected error:', err);
    return NextResponse.json({ success: false, error: String(err) });
  }
}