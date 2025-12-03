import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getServiceSupabase()
    // Fetch employee first
    const { data: employee, error } = await supabase
      .from('employees')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error) {
      throw error
    }

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }
    
    // Manually fetch all devices (including Azure-only) to ensure accurate count
    console.log(`Fetching devices for employee: ${employee.display_name || employee.email} (ID: ${employee.id})`)
    
    const { data: allDevices, error: devicesError } = await supabase
      .from('devices')
      .select('*')
      .eq('employee_id', employee.id)
      .order('device_name', { ascending: true })
    
    if (devicesError) {
      console.error(`❌ Error fetching devices for employee ${employee.id}:`, devicesError)
      employee.devices = []
    } else {
      console.log(`✅ Employee ${employee.display_name || employee.email} (${employee.id}): Found ${allDevices?.length || 0} devices in database`)
      if (allDevices && allDevices.length > 0) {
        allDevices.forEach((device: any, idx: number) => {
          console.log(`  Device ${idx + 1}: ${device.device_name} (id: ${device.id}, azure_id: ${device.azure_device_id}, ninja_id: ${device.ninja_device_id}, employee_id: ${device.employee_id})`)
        })
      } else {
        console.log(`  ⚠️ No devices found for this employee`)
      }
    }
    
    employee.devices = allDevices || []
    
    // Double-check: Verify all devices have the correct employee_id
    if (employee.devices && employee.devices.length > 0) {
      const mismatched = employee.devices.filter((d: any) => d.employee_id !== employee.id)
      if (mismatched.length > 0) {
        console.error(`⚠️ WARNING: Found ${mismatched.length} devices with incorrect employee_id:`)
        mismatched.forEach((d: any) => {
          console.error(`  - ${d.device_name} has employee_id: ${d.employee_id} (expected: ${employee.id})`)
        })
      }
    }

    // Fetch license assignments
    const { data: licenseAssignments } = await supabase
      .from('license_assignments')
      .select(`
        *,
        license:licenses(*)
      `)
      .eq('employee_id', employee.id)
    
    employee.license_assignments = licenseAssignments || []

    // Get device software for each device
    if (employee.devices && employee.devices.length > 0) {
      console.log(`Fetching software for ${employee.devices.length} devices`)
      
      const devicesWithSoftware = await Promise.all(
        employee.devices.map(async (device: any) => {
          try {
            const { data: deviceSoftwareLinks, error: softwareError } = await supabase
              .from('device_software')
              .select(`
                software:software(
                  id,
                  name,
                  version,
                  publisher
                ),
                install_date
              `)
              .eq('device_id', device.id)

            if (softwareError) {
              console.error(`Error fetching software for device ${device.device_name} (${device.id}):`, softwareError)
            }

            // Transform to flat software list - handle case where software might be null
            const software = deviceSoftwareLinks?.filter(link => link.software).map((link: any) => ({
              id: link.software?.id,
              name: link.software?.name,
              version: link.software?.version,
              publisher: link.software?.publisher,
              install_date: link.install_date
            })) || []

            // Sort by software name
            software.sort((a: any, b: any) => a.name.localeCompare(b.name))

            console.log(`Device ${device.device_name}: ${software.length} software items`)

            return {
              ...device,
              software
            }
          } catch (error: any) {
            console.error(`Exception fetching software for device ${device.device_name}:`, error)
            // Return device without software if there's an error
            return {
              ...device,
              software: []
            }
          }
        })
      )
      
      console.log(`Final devices count after software fetch: ${devicesWithSoftware.length}`)
      employee.devices = devicesWithSoftware
    }

    // Get manager info if available
    if (employee.manager_entra_id) {
      const { data: manager } = await supabase
        .from('employees')
        .select('id, display_name, email, job_title')
        .eq('entra_id', employee.manager_entra_id)
        .single()

      employee.manager = manager
    }
    
    // Get previous devices (devices this user used to be registered to)
    const { data: previousDeviceAssignments } = await supabase
      .from('device_assignments_history')
      .select(`
        id,
        device:devices(
          id,
          device_name,
          device_type,
          manufacturer,
          model,
          os_name,
          os_version
        ),
        assignment_date,
        unassignment_date,
        registered_date
      `)
      .eq('employee_id', employee.id)
      .eq('is_current', false)
      .order('unassignment_date', { ascending: false, nullsFirst: false })
      .order('assignment_date', { ascending: false })
    
    // Transform previous device assignments
    const previousDevices = (previousDeviceAssignments || [])
      .filter(assignment => assignment.device) // Only include if device still exists
      .map((assignment: any) => ({
        ...assignment.device,
        assignment_date: assignment.assignment_date,
        unassignment_date: assignment.unassignment_date,
        registered_date: assignment.registered_date
      }))
    
    employee.previous_devices = previousDevices

    return NextResponse.json({ employee })
  } catch (error: any) {
    console.error('Error fetching employee:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch employee' },
      { status: 500 }
    )
  }
}

