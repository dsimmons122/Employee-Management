import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { data: licenses, error } = await supabase
      .from('licenses')
      .select('*')
      .order('software_name', { ascending: true })

    if (error) {
      throw error
    }

    return NextResponse.json({ licenses: licenses || [] })
  } catch (error: any) {
    console.error('Error fetching licenses:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch licenses' },
      { status: 500 }
    )
  }
}



