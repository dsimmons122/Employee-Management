import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const supabase = getServiceSupabase()
    const { searchParams } = new URL(request.url)
    
    // Get query parameters
    const status = searchParams.get('status')
    const department = searchParams.get('department')
    const office = searchParams.get('office')
    const search = searchParams.get('search')

    // Start building query - get all employees first (no device filter)
    let query = supabase
      .from('employees')
      .select('*')

    // Apply filters
    if (status) {
      query = query.eq('employment_status', status)
    }

    if (department) {
      query = query.eq('department', department)
    }

    if (office) {
      query = query.eq('office_location', office)
    }

    if (search) {
      query = query.or(`display_name.ilike.%${search}%,email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
    }

    // Execute query
    const { data: employees, error } = await query.order('display_name', { ascending: true })

    if (error) {
      throw error
    }

    // Count devices manually for each employee - use same approach as detail page
    if (employees && employees.length > 0) {
      // Query devices for each employee individually (same as detail page does)
      // This ensures 100% accuracy and matches the detail page behavior exactly
      const deviceCountPromises = employees.map(async (emp: any) => {
        try {
          const { data: devices, error } = await supabase
            .from('devices')
            .select('id')
            .eq('employee_id', emp.id)
          
          if (error) {
            console.error(`Error fetching devices for ${emp.display_name || emp.email}:`, error)
            return { employeeId: emp.id, count: 0 }
          }
          
          const count = devices?.length || 0
          return { employeeId: emp.id, count }
        } catch (error) {
          console.error(`Error counting devices for ${emp.display_name || emp.email}:`, error)
          return { employeeId: emp.id, count: 0 }
        }
      })
      
      // Wait for all device counts to complete
      const deviceCounts = await Promise.all(deviceCountPromises)
      
      // Create a map for quick lookup
      const countsByEmployee = new Map<string, number>()
      deviceCounts.forEach(({ employeeId, count }) => {
        countsByEmployee.set(employeeId, count)
      })
      
      console.log(`Device count query: Counted devices for ${employees.length} employees`)
      console.log(`Sample counts:`, deviceCounts.slice(0, 5))

      // Update employee objects with correct device counts
      employees.forEach((emp: any) => {
        const deviceCount = countsByEmployee.get(emp.id) || 0
        emp.devices = [{ count: deviceCount }]
      })
    } else {
      // No employees, set all to 0
      employees?.forEach((emp: any) => {
        emp.devices = [{ count: 0 }]
      })
    }
    
    // Ensure all employees have devices array
    employees?.forEach((emp: any) => {
      if (!emp.devices || !Array.isArray(emp.devices)) {
        emp.devices = [{ count: 0 }]
      }
    })

    return NextResponse.json({ employees: employees || [] })
  } catch (error: any) {
    console.error('Error fetching employees:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch employees' },
      { status: 500 }
    )
  }
}

