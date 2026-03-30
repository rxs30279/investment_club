import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('treasurer_reports')
      .select('date, unit_value, total_assets, total_units')
      .not('unit_value', 'is', null)
      .order('date', { ascending: true });
    
    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json([]);
    }
    
    // Format the data to match what the frontend expects
    const formattedData = (data || []).map(item => ({
      valuation_date: item.date,
      unit_value: item.unit_value,
      total_assets: item.total_assets,
      total_units: item.total_units
    }));
    
    return NextResponse.json(formattedData);
  } catch (error) {
    console.error('Error fetching unit values:', error);
    return NextResponse.json([]);
  }
}