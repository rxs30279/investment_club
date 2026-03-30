import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // List all files in treasurer-reports bucket
    const { data: files, error } = await supabase.storage
      .from('treasurer-reports')
      .list();
    
    if (error) throw error;
    
    // For each PDF, we need to extract the unit value and date
    // Since PDF parsing is complex, we'll store this data in a table
    // For now, let's fetch from the treasurer_reports table which has metadata
    
    const { data: reports, error: dbError } = await supabase
      .from('treasurer_reports')
      .select('*')
      .order('date', { ascending: false });
    
    if (dbError) throw dbError;
    
    // Return the reports with their metadata
    return NextResponse.json({ reports });
  } catch (error) {
    console.error('Error fetching treasurer reports:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}