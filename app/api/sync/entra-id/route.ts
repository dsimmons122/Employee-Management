import { NextRequest, NextResponse } from 'next/server'
import { getAllUsers, getUserManager, getUserDevices } from '@/lib/azure-graph'
import { getServiceSupabase } from '@/lib/supabase'

// Configure route for long-running operations
export const maxDuration = 600 // 10 minutes (allow enough time for full sync)
export const runtime = 'nodejs' // Use Node.js runtime (not Edge)

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret (only for automated cron jobs)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.SYNC_CRON_SECRET
    
    // If auth header is provided, verify it matches
    if (authHeader && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getServiceSupabase()
    const startTime = Date.now()

    // Create sync log entry
    const { data: syncLog } = await supabase
      .from('sync_logs')
      .insert({
        sync_type: 'entra_id',
        status: 'success',
        started_at: new Date().toISOString()
      })
      .select()
      .single()

    let recordsSynced = 0
    let recordsFailed = 0
    const errors: string[] = []

    try {
      // Fetch all users from Azure
      const azureUsers = await getAllUsers()
      
      // Track all device-to-user relationships during sync
      // Key: azure_device_id, Value: Array of { employee_id, registered_date, azureDevice }
      const deviceUserRelationships = new Map<string, Array<{
        employee_id: string
        employee_name: string
        registered_date: string
        azureDevice: any
      }>>()

      for (const azureUser of azureUsers) {
        try {
          // Determine employment status based on account enabled
          const employmentStatus = azureUser.accountEnabled ? 'active' : 'terminated'

          // Check if user already exists
          const { data: existingEmployee } = await supabase
            .from('employees')
            .select('id, employment_status, termination_date')
            .eq('entra_id', azureUser.id)
            .single()

          // Determine hire date (use employeeHireDate if available, otherwise createdDateTime)
          const hireDate = azureUser.employeeHireDate || 
                          (azureUser.createdDateTime ? azureUser.createdDateTime.split('T')[0] : null)

          // Determine termination date
          let terminationDate = existingEmployee?.termination_date || null
          
          // Set termination date if:
          // 1. Status changed from active to terminated, OR
          // 2. User is terminated but doesn't have a termination date yet
          if (employmentStatus === 'terminated' && !terminationDate) {
            // Use last sign-in date as termination date, or today if not available
            terminationDate = azureUser.signInActivity?.lastSignInDateTime 
              ? azureUser.signInActivity.lastSignInDateTime.split('T')[0]
              : new Date().toISOString().split('T')[0]
          }

          const employeeData: any = {
            entra_id: azureUser.id,
            email: azureUser.mail || azureUser.userPrincipalName,
            first_name: azureUser.givenName || null,
            last_name: azureUser.surname || null,
            display_name: azureUser.displayName || null,
            job_title: azureUser.jobTitle || null,
            department: azureUser.department || null,
            office_location: azureUser.officeLocation || null,
            phone_number: azureUser.businessPhones?.[0] || null,
            mobile_phone: azureUser.mobilePhone || null,
            manager_entra_id: azureUser.manager?.id || null,
            manager_name: azureUser.manager?.displayName || null,
            employment_status: employmentStatus,
            hire_date: hireDate,
            termination_date: terminationDate,
            last_synced_at: new Date().toISOString()
          }

          let employeeRecord
          if (existingEmployee) {
            // Update existing employee
            const { data: updated } = await supabase
              .from('employees')
              .update(employeeData)
              .eq('id', existingEmployee.id)
              .select('id')
              .single()
            employeeRecord = updated
          } else {
            // Insert new employee
            const { data: inserted } = await supabase
              .from('employees')
              .insert(employeeData)
              .select('id')
              .single()
            employeeRecord = inserted
          }

          // Sync Azure devices for this user
          if (employeeRecord?.id) {
            try {
              const azureDevices = await getUserDevices(azureUser.id)
              console.log(`User ${azureUser.displayName} (${azureUser.id}): Found ${azureDevices.length} devices in Azure`)
              
              // Extract serial number from device name and deduplicate by serial number
              // Device names are typically formatted as "prefix-serialnumber" (e.g., "00-HKXRGK2", "atl-HKXRGK2")
              // We extract the serial number (part after first hyphen) and deduplicate by it
              // This prevents the same device from appearing multiple times with different prefixes
              
              const extractSerialNumber = (deviceName: string): string | null => {
                if (!deviceName) return null
                const parts = deviceName.split('-')
                if (parts.length >= 2) {
                  // Take everything after the first hyphen as the serial number
                  return parts.slice(1).join('-').toUpperCase().trim()
                }
                return null
              }
              
              // Group devices by serial number (deduplicate same device with different prefixes)
              // When a device appears multiple times with different prefixes, keep the one with the latest registration date
              const deviceMapBySerial = new Map<string, any>()
              
              azureDevices.forEach((device: any) => {
                const serialNumber = extractSerialNumber(device.displayName || '')
                
                // Use serial number as primary key for deduplication, fallback to deviceId or name
                const key = serialNumber || device.deviceId || device.displayName?.toLowerCase() || device.id
                
                if (!deviceMapBySerial.has(key)) {
                  deviceMapBySerial.set(key, device)
                } else {
                  // Compare devices - prioritize active devices, then latest registration date
                  const existing = deviceMapBySerial.get(key)!
                  const existingIsActive = existing.isManaged !== false // Azure devices are active if isManaged is not false
                  const currentIsActive = device.isManaged !== false
                  
                  const existingDate = existing.registeredDateTime || existing.approximateLastSignInDateTime || '1970-01-01'
                  const currentDate = device.registeredDateTime || device.approximateLastSignInDateTime || '1970-01-01'
                  
                  // Priority 1: Active devices over inactive
                  if (currentIsActive && !existingIsActive) {
                    console.log(`  🔄 Replacing inactive device ${existing.displayName} with active ${device.displayName} (serial: ${serialNumber || 'N/A'})`)
                    deviceMapBySerial.set(key, device)
                  } else if (!currentIsActive && existingIsActive) {
                    console.log(`  ⏭️ Skipping inactive device ${device.displayName} (serial: ${serialNumber || 'N/A'}) - keeping existing active device ${existing.displayName}`)
                    // Keep existing active device
                  } else if (currentDate > existingDate) {
                    // Same status - use latest registration date
                    console.log(`  🔄 Replacing duplicate device ${existing.displayName} with ${device.displayName} (serial: ${serialNumber || 'N/A'}) - newer registration (${existingDate} -> ${currentDate})`)
                    deviceMapBySerial.set(key, device)
                  } else {
                    console.log(`  ⏭️ Skipping duplicate device ${device.displayName} (serial: ${serialNumber || 'N/A'}) - existing registration is newer (${existingDate} vs ${currentDate})`)
                  }
                }
              })
              
              const uniqueDevices = Array.from(deviceMapBySerial.values())
              const duplicateCount = azureDevices.length - uniqueDevices.length
              
              if (duplicateCount > 0) {
                console.log(`  Filtered out ${duplicateCount} duplicate device registrations by serial number, keeping ${uniqueDevices.length} unique devices`)
              }
              
              for (const azureDevice of uniqueDevices) {
                try {
                  console.log(`  Processing Azure device: ${azureDevice.displayName} (Azure ID: ${azureDevice.id})`)
                  
                  // Check if device already exists (by azure_device_id - this should be unique)
                  let existingDevice = null
                  
                  // First try by azure_device_id (most reliable - should be unique per device)
                  const { data: byAzureId, error: azureIdError } = await supabase
                    .from('devices')
                    .select('id, azure_device_id, is_in_ninja, ninja_device_id, employee_id, device_name')
                    .eq('azure_device_id', azureDevice.id)
                    .maybeSingle()
                  
                  if (azureIdError && azureIdError.code !== 'PGRST116') { // PGRST116 = not found, which is OK
                    console.error(`  Error checking by azure_device_id:`, azureIdError)
                  } else if (byAzureId) {
                    existingDevice = byAzureId
                    console.log(`  Found existing device by azure_device_id: ${byAzureId.device_name} (ID: ${byAzureId.id})`)
                  }
                  
                  // Extract serial number from Azure device name
                  const extractSerialNumber = (deviceName: string): string | null => {
                    if (!deviceName) return null
                    const parts = deviceName.split('-')
                    if (parts.length >= 2) {
                      return parts.slice(1).join('-').toUpperCase().trim()
                    }
                    return null
                  }
                  
                  const serialNumber = extractSerialNumber(azureDevice.displayName || '')
                  
                  // If not found by azure_device_id, try by serial number (for deduplication)
                  // This matches devices with the same serial number but different Azure device IDs/names
                  // This handles cases where Azure has multiple registrations of the same physical device
                  if (!existingDevice && serialNumber) {
                    // Try to find device by serial number (exact match, case-insensitive)
                    const { data: devicesBySerial, error: serialError } = await supabase
                      .from('devices')
                      .select('id, azure_device_id, is_in_ninja, ninja_device_id, employee_id, device_name, serial_number, last_synced_at')
                      .ilike('serial_number', serialNumber)
                    
                    if (serialError && serialError.code !== 'PGRST116') {
                      console.error(`  Error checking by serial number:`, serialError)
                    } else if (devicesBySerial && devicesBySerial.length > 0) {
                      // Multiple devices with same serial - use the one with latest last_synced_at or newest azure_device_id
                      // Or we could merge them, but for now just use the first one (they should all point to the same device)
                      existingDevice = devicesBySerial[0]
                      
                      // If there are multiple, log it
                      if (devicesBySerial.length > 1) {
                        console.log(`  ⚠️ Found ${devicesBySerial.length} devices with same serial number "${serialNumber}" - using first one (${existingDevice.device_name})`)
                        console.log(`     Other devices: ${devicesBySerial.slice(1).map((d: any) => d.device_name).join(', ')}`)
                      } else {
                        console.log(`  ✅ Found existing device by serial number (serial: ${serialNumber}, existing name: ${existingDevice.device_name})`)
                      }
                    }
                  }
                  
                  // If still not found, try by device name
                  // Only do this if the device doesn't have azure_device_id yet (might be from NinjaOne first)
                  if (!existingDevice && azureDevice.displayName) {
                    const { data: byName, error: nameError } = await supabase
                      .from('devices')
                      .select('id, azure_device_id, is_in_ninja, ninja_device_id, employee_id, device_name')
                      .ilike('device_name', azureDevice.displayName)
                      .is('azure_device_id', null) // Only match devices without azure_device_id
                      .maybeSingle()
                    
                    if (nameError && nameError.code !== 'PGRST116') {
                      console.error(`  Error checking by name:`, nameError)
                    } else if (byName) {
                      existingDevice = byName
                      console.log(`  Found existing device by name (no azure_id): ${byName.device_name} (ID: ${byName.id})`)
                    }
                  }

                  // Track this device-to-user relationship (don't update employee_id yet)
                  // We'll resolve conflicts at the end after all users are processed
                  const registeredDate = azureDevice.registeredDateTime || azureDevice.approximateLastSignInDateTime || new Date().toISOString()
                  
                  if (!deviceUserRelationships.has(azureDevice.id)) {
                    deviceUserRelationships.set(azureDevice.id, [])
                  }
                  
                  deviceUserRelationships.get(azureDevice.id)!.push({
                    employee_id: employeeRecord.id,
                    employee_name: azureUser.displayName || azureUser.userPrincipalName,
                    registered_date: registeredDate,
                    azureDevice: azureDevice
                  })

                  const deviceData: any = {
                    azure_device_id: azureDevice.id,
                    // Don't set employee_id yet - will be resolved at end of sync
                    device_name: azureDevice.displayName || null,
                    serial_number: serialNumber || existingDevice?.serial_number || null, // Extract and store serial number
                    device_type: azureDevice.operatingSystem || null,
                    os_name: azureDevice.operatingSystem || null,
                    os_version: azureDevice.operatingSystemVersion || null,
                    status: azureDevice.isManaged ? 'active' : 'inactive',
                    last_synced_at: new Date().toISOString()
                  }

                  // Preserve is_in_ninja flag and ninja_device_id if device already exists
                  if (existingDevice) {
                    deviceData.is_in_ninja = existingDevice.is_in_ninja || false
                    // Preserve ninja_device_id if it exists (don't overwrite)
                    if (existingDevice.ninja_device_id) {
                      // Keep existing ninja_device_id
                    }
                    
                    // Preserve existing employee_id for now (will be resolved at end)
                    if (existingDevice.employee_id) {
                      deviceData.employee_id = existingDevice.employee_id
                    }
                    
                    const { error: updateError } = await supabase
                      .from('devices')
                      .update(deviceData)
                      .eq('id', existingDevice.id)
                    
                    if (updateError) {
                      console.error(`  ❌ Error updating device ${azureDevice.displayName}:`, updateError)
                    } else {
                      console.log(`  ✅ Updated device ${azureDevice.displayName} (azure_id: ${azureDevice.id})`)
                    }
                  } else {
                    // New device - not in Ninja yet (will be marked during NinjaOne sync if found)
                    deviceData.is_in_ninja = false
                    
                    const { data: insertedDevice, error: insertError } = await supabase
                      .from('devices')
                      .insert(deviceData)
                      .select('id')
                      .single()
                    
                    if (insertError) {
                      console.error(`  ❌ Error inserting device ${azureDevice.displayName} (azure_id: ${azureDevice.id}):`, insertError)
                      // Log the full error for debugging
                      if (insertError.code === '23505') { // Unique violation
                        console.error(`    This might be a duplicate azure_device_id - checking if device exists...`)
                        const { data: checkDuplicate } = await supabase
                          .from('devices')
                          .select('id, azure_device_id, device_name, employee_id')
                          .eq('azure_device_id', azureDevice.id)
                          .maybeSingle()
                        console.error(`    Duplicate check result:`, checkDuplicate)
                      }
                    } else {
                      console.log(`  ✅ Created device ${azureDevice.displayName} (azure_id: ${azureDevice.id}, db_id: ${insertedDevice?.id})`)
                    }
                  }
                } catch (deviceError: any) {
                  // Skip device errors but continue
                  console.error(`  ❌ Exception syncing device ${azureDevice.displayName}:`, deviceError.message, deviceError.stack)
                }
              }
              
              // After syncing all devices, verify count
              const { data: finalDevices } = await supabase
                .from('devices')
                .select('id, device_name, azure_device_id')
                .eq('employee_id', employeeRecord.id)
              
              console.log(`  Final device count for ${azureUser.displayName}: ${finalDevices?.length || 0} devices in database`)
              if (finalDevices && finalDevices.length > 0) {
                finalDevices.forEach((d: any) => {
                  console.log(`    - ${d.device_name} (azure_id: ${d.azure_device_id})`)
                })
              }
            } catch (devicesError) {
              // Log but don't fail the entire user sync
              console.error(`Error fetching devices for user ${azureUser.id}:`, devicesError)
            }
          }

          recordsSynced++
        } catch (error: any) {
          recordsFailed++
          errors.push(`Failed to sync user ${azureUser.userPrincipalName}: ${error.message}`)
        }
      }

      // Now resolve device-to-user conflicts at the end of sync
      // For devices registered to multiple users, assign to the user with the latest registration date
      console.log(`\n🔍 Resolving device-to-user conflicts (${deviceUserRelationships.size} devices to process)...`)
      
      let conflictsResolved = 0
      let historyRecordsCreated = 0
      
      // Also check for any existing devices that weren't in this sync (might need employee_id removed if unregistered)
      const { data: allAzureDevices } = await supabase
        .from('devices')
        .select('id, azure_device_id, employee_id, device_name')
        .not('azure_device_id', 'is', null)
      
      const syncedAzureDeviceIds = new Set(deviceUserRelationships.keys())
      const unregisteredDevices = (allAzureDevices || []).filter(
        device => device.azure_device_id && !syncedAzureDeviceIds.has(device.azure_device_id) && device.employee_id
      )
      
      // Handle devices that were unregistered (no longer in Azure for any user)
      if (unregisteredDevices.length > 0) {
        console.log(`  ⚠️ Found ${unregisteredDevices.length} devices that are no longer registered in Azure - marking previous assignments as unassigned`)
        for (const device of unregisteredDevices) {
          // Mark previous assignment as unassigned in history
          await supabase
            .from('device_assignments_history')
            .update({
              is_current: false,
              unassignment_date: new Date().toISOString()
            })
            .eq('device_id', device.id)
            .eq('employee_id', device.employee_id)
            .eq('is_current', true)
          
          // Remove employee_id from device
          await supabase
            .from('devices')
            .update({ employee_id: null })
            .eq('id', device.id)
        }
      }
      
      let processedCount = 0
      const totalDevices = deviceUserRelationships.size
      
      for (const [azureDeviceId, relationships] of deviceUserRelationships.entries()) {
        processedCount++
        
        // Log progress every 50 devices
        if (processedCount % 50 === 0 || processedCount === totalDevices) {
          console.log(`  📊 Progress: ${processedCount}/${totalDevices} devices processed (${Math.round((processedCount / totalDevices) * 100)}%)`)
        }
        
        try {
          // Get the device record
          const { data: deviceRecord } = await supabase
            .from('devices')
            .select('id, azure_device_id, employee_id')
            .eq('azure_device_id', azureDeviceId)
            .single()
          
          if (!deviceRecord) {
            console.log(`  ⚠️ Device with azure_device_id ${azureDeviceId} not found in database - skipping`)
            continue
          }
          
          // Determine which user should "win" (latest registration date)
          // Sort relationships by registered_date (descending - latest first)
          const sortedRelationships = relationships.sort((a, b) => {
            const dateA = new Date(a.registered_date).getTime()
            const dateB = new Date(b.registered_date).getTime()
            return dateB - dateA
          })
          
          const winningRelationship = sortedRelationships[0]
          const previousEmployeeId = deviceRecord.employee_id
          const newEmployeeId = winningRelationship.employee_id
          
          // Check if there are multiple users (conflict)
          if (relationships.length > 1) {
            conflictsResolved++
            console.log(`  ⚠️ Device ${azureDeviceId} is registered to ${relationships.length} users:`)
            relationships.forEach((rel, idx) => {
              const isWinner = idx === 0
              console.log(`    ${isWinner ? '✅' : '  '} ${rel.employee_name} (registered: ${rel.registered_date})${isWinner ? ' [WINNER]' : ''}`)
            })
          }
          
          // If employee_id is changing, record in history
          if (previousEmployeeId && previousEmployeeId !== newEmployeeId) {
            // Mark previous assignment as unassigned
            const { error: historyError } = await supabase
              .from('device_assignments_history')
              .update({
                is_current: false,
                unassignment_date: new Date().toISOString()
              })
              .eq('device_id', deviceRecord.id)
              .eq('employee_id', previousEmployeeId)
              .eq('is_current', true)
            
            if (historyError) {
              console.error(`  ❌ Error updating history for previous assignment:`, historyError)
            }
          }
          
          // Update device with winning employee_id
          const { error: updateError } = await supabase
            .from('devices')
            .update({
              employee_id: newEmployeeId
            })
            .eq('id', deviceRecord.id)
          
          if (updateError) {
            console.error(`  ❌ Error updating device employee_id:`, updateError)
          } else {
            if (previousEmployeeId && previousEmployeeId !== newEmployeeId) {
              console.log(`  ✅ Updated device assignment: ${previousEmployeeId} -> ${newEmployeeId}`)
            }
          }
          
          // Record current assignment in history (if not already recorded for this employee)
          const { data: existingHistory } = await supabase
            .from('device_assignments_history')
            .select('id')
            .eq('device_id', deviceRecord.id)
            .eq('employee_id', newEmployeeId)
            .eq('is_current', true)
            .maybeSingle()
          
          if (!existingHistory) {
            const { error: insertHistoryError } = await supabase
              .from('device_assignments_history')
              .insert({
                device_id: deviceRecord.id,
                employee_id: newEmployeeId,
                azure_device_id: azureDeviceId,
                registered_date: winningRelationship.registered_date,
                assignment_date: new Date().toISOString(),
                is_current: true,
                sync_id: syncLog!.id
              })
            
            if (insertHistoryError) {
              console.error(`  ❌ Error inserting history record:`, insertHistoryError)
            } else {
              historyRecordsCreated++
            }
          } else {
            // Update existing history record with latest registration date
            await supabase
              .from('device_assignments_history')
              .update({
                registered_date: winningRelationship.registered_date
              })
              .eq('id', existingHistory.id)
          }
          
          // Also record all other users who had this device (for history tracking)
          for (let i = 1; i < sortedRelationships.length; i++) {
            const rel = sortedRelationships[i]
            const { data: existingRelHistory } = await supabase
              .from('device_assignments_history')
              .select('id')
              .eq('device_id', deviceRecord.id)
              .eq('employee_id', rel.employee_id)
              .maybeSingle()
            
            if (!existingRelHistory) {
              // Record this user also had the device (but not as current)
              await supabase
                .from('device_assignments_history')
                .insert({
                  device_id: deviceRecord.id,
                  employee_id: rel.employee_id,
                  azure_device_id: azureDeviceId,
                  registered_date: rel.registered_date,
                  assignment_date: new Date().toISOString(),
                  is_current: false,
                  sync_id: syncLog!.id
                })
            }
          }
        } catch (error: any) {
          console.error(`  ❌ Error resolving conflict for device ${azureDeviceId}:`, error.message)
        }
      }
      
      if (conflictsResolved > 0) {
        console.log(`\n✅ Resolved ${conflictsResolved} device-to-user conflicts`)
      }
      console.log(`✅ Created ${historyRecordsCreated} device assignment history records`)
      console.log(`✅ Completed conflict resolution: ${processedCount}/${totalDevices} devices processed`)

      // Update sync log
      const duration = Math.floor((Date.now() - startTime) / 1000)
      console.log(`[Azure Sync] Updating sync log (${syncLog!.id}) with completion status...`)
      await supabase
        .from('sync_logs')
        .update({
          status: recordsFailed > 0 ? 'partial' : 'success',
          records_synced: recordsSynced,
          records_failed: recordsFailed,
          error_message: errors.length > 0 ? errors.join('; ') : null,
          completed_at: new Date().toISOString(),
          duration_seconds: duration
        })
        .eq('id', syncLog!.id)

      console.log(`[Azure Sync] Sync log updated. Returning response with ${recordsSynced} synced, ${recordsFailed} failed`)
      return NextResponse.json({
        success: true,
        recordsSynced,
        recordsFailed,
        duration,
        errors: errors.length > 0 ? errors : undefined
      })
    } catch (error: any) {
      // Update sync log with failure
      const duration = Math.floor((Date.now() - startTime) / 1000)
      await supabase
        .from('sync_logs')
        .update({
          status: 'failed',
          records_synced: recordsSynced,
          records_failed: recordsFailed,
          error_message: error.message,
          completed_at: new Date().toISOString(),
          duration_seconds: duration
        })
        .eq('id', syncLog!.id)

      throw error
    }
  } catch (error: any) {
    console.error('Entra ID sync error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to sync Entra ID data' },
      { status: 500 }
    )
  }
}

