import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { reportId, unitValue, totalAssets, totalUnits } = await request.json();
    
    if (!reportId || !unitValue) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get report date
    const { data: report, error: fetchError } = await supabase
      .from('treasurer_reports')
      .select('date')
      .eq('id', reportId)
      .single();

    if (fetchError) throw fetchError;

    // Update treasurer report
    const { error: updateError } = await supabase
      .from('treasurer_reports')
      .update({
        unit_value: unitValue,
        total_assets: totalAssets || null,
        total_units: totalUnits || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId);

    if (updateError) throw updateError;

    // Update unit_values table
    const { error: upsertError } = await supabase
      .from('unit_values')
      .upsert({
        valuation_date: report.date,
        unit_value: unitValue,
        total_assets: totalAssets || null,
        total_units: totalUnits || null,
        source_report_id: reportId,
        confidence: 100,
        manually_verified: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'valuation_date'
      });

    if (upsertError) throw upsertError;

    return NextResponse.json({
      success: true,
      message: 'Unit value updated successfully'
    });
  } catch (error) {
    console.error('Error updating unit value:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to update unit value',
        details: String(error)
      },
      { status: 500 }
    );
  }
}