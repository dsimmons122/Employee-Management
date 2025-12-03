import { NextRequest, NextResponse } from 'next/server'
import { ninjaOne } from '@/lib/ninjaone'
import { getServiceSupabase } from '@/lib/supabase'
import { getAllUsersWithDevices } from '@/lib/azure-graph'

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
        sync_type: 'ninjaone',
        status: 'success',
        started_at: new Date().toISOString()
      })
      .select()
      .single()

      let recordsSynced = 0
      let recordsFailed = 0
      const errors: string[] = []

      try {
        // First, get Azure device mapping (user ID -> device names)
        console.log('Fetching Azure device mappings...')
        const azureUserDeviceMap = await getAllUsersWithDevices()
        
        // Create a map of device names to employee IDs
        const deviceNameToEmployeeMap = new Map<string, string>()
        
        // Get all employees to map Azure user IDs to our employee IDs
        const { data: employees } = await supabase
          .from('employees')
          .select('id, entra_id')
        
        const entraIdToEmployeeMap = new Map<string, string>()
        employees?.forEach((emp: any) => {
          if (emp.entra_id) {
            entraIdToEmployeeMap.set(emp.entra_id, emp.id)
          }
        })
        
        // Build device name to employee ID mapping from Azure data
        for (const [azureUserId, devices] of azureUserDeviceMap.entries()) {
          const employeeId = entraIdToEmployeeMap.get(azureUserId)
          if (employeeId) {
            devices.forEach((device) => {
              // Normalize device name for matching (lowercase, remove special chars)
              const normalizedName = (device.displayName || '').toLowerCase().trim()
              if (normalizedName) {
                // Store multiple variations for better matching
                deviceNameToEmployeeMap.set(normalizedName, employeeId)
                // Also try without hyphens/spaces
                const noSpecialChars = normalizedName.replace(/[^a-z0-9]/g, '')
                if (noSpecialChars && noSpecialChars !== normalizedName) {
                  deviceNameToEmployeeMap.set(noSpecialChars, employeeId)
                }
              }
            })
          }
        }
        
        console.log(`Created device name mapping for ${deviceNameToEmployeeMap.size} device names from ${azureUserDeviceMap.size} Azure users`)
        
        // Fetch all devices from NinjaOne
        const ninjaDevices = await ninjaOne.getDevices()
        
        console.log(`Fetched ${ninjaDevices.length} devices from NinjaOne`)

        // Process devices in parallel batches to speed up sync
        const BATCH_SIZE = 10 // Process 10 devices at a time
        const batches = []
        
        for (let i = 0; i < ninjaDevices.length; i += BATCH_SIZE) {
          batches.push(ninjaDevices.slice(i, i + BATCH_SIZE))
        }

        console.log(`Processing ${ninjaDevices.length} devices in ${batches.length} batches of ${BATCH_SIZE}`)

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex]
          console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} devices)`)

          // Process batch in parallel
          const results = await Promise.all(batch.map(async (device) => {
            try {
              // Fetch detailed device information
              const deviceDetails = await ninjaOne.getDevice(device.id.toString())
              
              // IMPORTANT: NinjaOne sync should NEVER assign devices to employees
              // Azure is the source of truth for device assignments
              // NinjaOne only enriches device data and matches to existing Azure devices

              // Check if device already exists (by ninja_device_id or by name match with Azure device)
              let existingDevice = null
              const deviceName = (device.systemName || device.dnsName || '').toLowerCase().trim()
              
              // First try by ninja_device_id
              const { data: byNinjaId } = await supabase
                .from('devices')
                .select('id, azure_device_id, employee_id, device_name, ninja_device_id')
                .eq('ninja_device_id', device.id.toString())
                .single()
              
              existingDevice = byNinjaId
              
              // If not found by ninja_device_id, check if there's an Azure device that should match by serial number
              // This handles cases where Azure device exists but isn't linked to NinjaOne yet
              // Devices registered to multiple people: Azure sync keeps the one with latest registration date
              if (!existingDevice) {
                // Get serial number from NinjaOne device details
                const ninjaSerialNumber = (deviceDetails.system?.serialNumber || deviceDetails.system?.biosSerialNumber || '').trim()
                
                if (ninjaSerialNumber) {
                  // Normalize serial number for matching (uppercase, trim)
                  const normalizedNinjaSerial = ninjaSerialNumber.toUpperCase().trim()
                  
                  // Search for Azure devices by serial_number field directly (case-insensitive)
                  // This matches devices with same serial but different prefixes (e.g., "00-HKXRGK2" and "atl-HKXRGK2")
                  const { data: potentialMatches, error: serialError } = await supabase
                    .from('devices')
                    .select('id, azure_device_id, employee_id, device_name, ninja_device_id, serial_number')
                    .not('azure_device_id', 'is', null)
                    .is('ninja_device_id', null)
                    .ilike('serial_number', normalizedNinjaSerial)
                  
                  if (serialError && serialError.code !== 'PGRST116') {
                    console.error(`  Error checking by serial_number field:`, serialError)
                  } else if (potentialMatches && potentialMatches.length > 0) {
                    // Found matching Azure device(s) by serial number
                    // If multiple, use the first one (they should all be the same physical device)
                    existingDevice = potentialMatches[0]
                    console.log(`  📌 ✅ FOUND UNMATCHED AZURE DEVICE by serial_number field: Azure device "${existingDevice.device_name}" (serial: ${existingDevice.serial_number}) matches NinjaOne serial "${ninjaSerialNumber}" - linking devices`)
                    if (potentialMatches.length > 1) {
                      console.log(`  ⚠️ Found ${potentialMatches.length} Azure devices with same serial number "${normalizedNinjaSerial}" - using first one`)
                    }
                  }
                }
              }
              
              // If device exists but doesn't have azure_device_id, we should check if there's a matching Azure device
              // This handles cases where devices were synced separately and need to be merged
              if (existingDevice && !existingDevice.azure_device_id) {
                console.log(`  🔍 Device found by ninja_device_id but has no azure_device_id - will check for matching Azure device by serial number`)
              }
              
              // If not found by ninja_device_id, check if there's an Azure device that should match
              // This handles cases where Azure device exists but isn't linked to NinjaOne yet
              if (!existingDevice) {
                // Get serial number early to use for matching
                const ninjaSerialNumber = (deviceDetails.system?.serialNumber || deviceDetails.system?.biosSerialNumber || '').trim()
                
                if (ninjaSerialNumber) {
                  // Search for Azure devices by serial_number field directly (case-insensitive)
                  // This matches devices with same serial but different prefixes
                  const normalizedNinjaSerial = ninjaSerialNumber.toUpperCase().trim()
                  
                  const { data: potentialMatches, error: serialError } = await supabase
                    .from('devices')
                    .select('id, azure_device_id, employee_id, device_name, ninja_device_id, serial_number')
                    .not('azure_device_id', 'is', null)
                    .is('ninja_device_id', null)
                    .ilike('serial_number', normalizedNinjaSerial)
                    
                  if (serialError && serialError.code !== 'PGRST116') {
                    console.error(`  Error checking by serial_number field:`, serialError)
                  } else if (potentialMatches && potentialMatches.length > 0) {
                    // Found matching Azure device(s) by serial number
                    existingDevice = potentialMatches[0]
                    console.log(`  📌 ✅ FOUND UNMATCHED AZURE DEVICE by serial_number field: Azure device "${existingDevice.device_name}" (serial: ${existingDevice.serial_number}) matches NinjaOne serial "${ninjaSerialNumber}" - linking devices`)
                    if (potentialMatches.length > 1) {
                      console.log(`  ⚠️ Found ${potentialMatches.length} Azure devices with same serial number "${normalizedNinjaSerial}" - using first one`)
                    }
                  }
                }
              }
              
              // If not found, try to find by device name (might be Azure device that's now in Ninja)
              // This prevents duplication - if Azure device exists, we update it instead of creating a new one
              // NOTE: We'll verify name matches with serial number later if device has azure_device_id
              if (!existingDevice && deviceName) {
                // Try exact match first
                const { data: byNameExact } = await supabase
                  .from('devices')
                  .select('id, azure_device_id, employee_id, ninja_device_id, device_name')
                  .ilike('device_name', deviceName)
                  .single()
                
                if (byNameExact) {
                  existingDevice = byNameExact
                } else {
                  // Try fuzzy match - get all devices and match by name similarity
                  const { data: allDevices } = await supabase
                    .from('devices')
                    .select('id, azure_device_id, employee_id, ninja_device_id, device_name')
                  
                  if (allDevices) {
                    for (const candidateDevice of allDevices) {
                      const candidateName = (candidateDevice.device_name || '').toLowerCase().trim()
                      if (!candidateName) continue
                      
                      // Check if names match (exact or normalized)
                      const normalizedDeviceName = deviceName.replace(/[^a-z0-9]/g, '')
                      const normalizedCandidateName = candidateName.replace(/[^a-z0-9]/g, '')
                      
                      if (normalizedDeviceName === normalizedCandidateName ||
                          deviceName.includes(candidateName) ||
                          candidateName.includes(deviceName)) {
                        existingDevice = candidateDevice
                        break
                      }
                    }
                  }
                }
              }
              
              // If we found a device by name match, optionally verify it with serial number
              // NOTE: We keep the name match even if serial numbers don't match because
              // some devices don't follow the "city-serialnumber" format
              // Serial number matching is used as a fallback when name matching fails
              if (existingDevice && existingDevice.azure_device_id) {
                const ninjaSerialNumber = (deviceDetails.system?.serialNumber || deviceDetails.system?.biosSerialNumber || '').trim()
                if (ninjaSerialNumber) {
                  const azureDeviceName = (existingDevice.device_name || '').trim()
                  const nameParts = azureDeviceName.split('-')
                  if (nameParts.length >= 2) {
                    const azureSerialPart = nameParts.slice(1).join('-').toLowerCase().trim()
                    const normalizedNinjaSerial = ninjaSerialNumber.toLowerCase().replace(/[^a-z0-9]/g, '')
                    const normalizedAzureSerial = azureSerialPart.replace(/[^a-z0-9]/g, '')
                    
                    // Just log the comparison - don't break the match if serials don't match
                    // (some devices don't follow the city-serialnumber format)
                    if (normalizedNinjaSerial !== normalizedAzureSerial) {
                      console.log(`  ⚠️ Name match found but serial numbers don't match: NinjaOne serial="${ninjaSerialNumber}" (normalized: "${normalizedNinjaSerial}") vs Azure device "${azureDeviceName}" (extracted serial: "${azureSerialPart}" -> normalized: "${normalizedAzureSerial}"). Keeping name match (device may not follow city-serialnumber format).`)
                    } else {
                      console.log(`  ✅ Name match verified by serial number: Serial "${ninjaSerialNumber}" matches Azure device "${azureDeviceName}"`)
                    }
                  }
                }
              }
              
              // Use employee_id from existing device if found (Azure is source of truth)
              const employeeId = existingDevice?.employee_id || null

              // Convert Unix timestamp to ISO string for last_seen
              let lastSeen = null
              if (device.lastContact) {
                // NinjaOne returns Unix timestamp (seconds since epoch)
                const timestamp = parseFloat(device.lastContact)
                lastSeen = new Date(timestamp * 1000).toISOString()
              }

              // Build device data - preserve employee_id from Azure (never set it from NinjaOne)
              const deviceData: any = {
                ninja_device_id: device.id.toString(),
                device_name: device.systemName || device.dnsName || existingDevice?.device_name || 'Unknown Device',
                device_type: device.nodeClass || null,
                manufacturer: deviceDetails.system?.manufacturer || null,
                model: deviceDetails.system?.model || null,
                serial_number: deviceDetails.system?.serialNumber || deviceDetails.system?.biosSerialNumber || null,
                os_name: deviceDetails.os?.name || null,
                os_version: deviceDetails.os?.version || null,
                last_seen: lastSeen,
                status: 'active',
                is_in_ninja: true, // Mark as in NinjaOne
                last_synced_at: new Date().toISOString()
              }
              
              // CRITICAL: Only set employee_id if it exists on the existing device (from Azure)
              // NinjaOne should NEVER assign devices to employees
              if (existingDevice?.employee_id) {
                deviceData.employee_id = existingDevice.employee_id
              }
              
              // Preserve azure_device_id if device was already synced from Azure
              if (existingDevice?.azure_device_id) {
                deviceData.azure_device_id = existingDevice.azure_device_id
              }

              // If we have an existing device but it doesn't have azure_device_id, try to find matching Azure device by serial number
              // This merges devices that were synced separately (e.g., NinjaOne device exists, Azure device exists separately)
              if (existingDevice && !existingDevice.azure_device_id) {
                const ninjaSerialNumber = (deviceDetails.system?.serialNumber || deviceDetails.system?.biosSerialNumber || '').trim()
                if (ninjaSerialNumber) {
                  console.log(`  🔍 Existing NinjaOne device has no azure_device_id - checking for matching Azure device by serial "${ninjaSerialNumber}"`)
                  
                  const normalizedNinjaSerial = ninjaSerialNumber.toLowerCase().replace(/[^a-z0-9]/g, '')
                  
                  // Search for Azure devices with matching serial number
                  let allAzureDevices: any[] = []
                  let offset = 0
                  const batchSize = 1000
                  let hasMore = true
                  
                  while (hasMore && offset < 10000) {
                    const { data: azureDevicesBatch } = await supabase
                      .from('devices')
                      .select('id, azure_device_id, employee_id, device_name, ninja_device_id')
                      .not('azure_device_id', 'is', null)
                      .or(`and(ninja_device_id.is.null),and(ninja_device_id.eq.${device.id.toString()})`)
                      .range(offset, offset + batchSize - 1)
                      .order('device_name', { ascending: true })
                    
                    if (azureDevicesBatch && azureDevicesBatch.length > 0) {
                      allAzureDevices = allAzureDevices.concat(azureDevicesBatch)
                      offset += batchSize
                      hasMore = azureDevicesBatch.length === batchSize
                    } else {
                      hasMore = false
                    }
                  }
                  
                  console.log(`  🔍 Checking ${allAzureDevices.length} Azure devices for serial number match`)
                  
                  let foundMatch = false
                  for (const azureDevice of allAzureDevices) {
                    if (azureDevice.ninja_device_id && azureDevice.ninja_device_id !== device.id.toString()) {
                      continue
                    }
                    
                    const azureDeviceName = (azureDevice.device_name || '').trim()
                    
                    // Try to extract serial number from Azure device name
                    // Format: "city-serialnumber" -> extract "serialnumber" (part after first hyphen)
                    const nameParts = azureDeviceName.split('-')
                    let azureSerialPart = ''
                    let normalizedAzureSerial = ''
                    
                    if (nameParts.length >= 2) {
                      // Take everything after the first hyphen as the serial number part
                      azureSerialPart = nameParts.slice(1).join('-').toLowerCase().trim()
                      normalizedAzureSerial = azureSerialPart.replace(/[^a-z0-9]/g, '')
                    }
                    
                    // Also check if device name contains the serial number anywhere (in case format differs)
                    const normalizedAzureName = azureDeviceName.toLowerCase().replace(/[^a-z0-9]/g, '')
                    const containsSerial = normalizedAzureName.includes(normalizedNinjaSerial)
                    
                    // Match if:
                    // 1. Serial number extracted from name matches exactly, OR
                    // 2. Serial number appears anywhere in the normalized device name
                    if (normalizedNinjaSerial && (
                      (normalizedAzureSerial && normalizedNinjaSerial === normalizedAzureSerial) ||
                      (normalizedNinjaSerial.length >= 4 && containsSerial) // Only if serial is at least 4 chars to avoid false matches
                    )) {
                      console.log(`  📌 ✅ FOUND AZURE MATCH for existing NinjaOne device: Azure device "${azureDevice.device_name}" (serial extracted: "${azureSerialPart}" -> normalized: "${normalizedAzureSerial}") matches NinjaOne serial "${ninjaSerialNumber}" (normalized: "${normalizedNinjaSerial}") - merging devices`)
                      
                      // Use the Azure device instead (it has azure_device_id and employee_id)
                      // Delete the old NinjaOne-only device and use the Azure one
                      await supabase
                        .from('devices')
                        .delete()
                        .eq('id', existingDevice.id)
                      
                      existingDevice = azureDevice
                      foundMatch = true
                      break
                    }
                  }
                  
                  if (!foundMatch && allAzureDevices.length > 0) {
                    console.log(`  ❌ No Azure device match found for serial "${ninjaSerialNumber}" (normalized: "${normalizedNinjaSerial}") among ${allAzureDevices.length} Azure devices checked`)
                    // Log first few Azure device names for debugging
                    const sampleNames = allAzureDevices.slice(0, 5).map(d => d.device_name).join(', ')
                    console.log(`  🔍 Sample Azure device names checked: ${sampleNames}`)
                  }
                  
                  // Update deviceData with Azure info if we found a match
                  if (existingDevice.azure_device_id) {
                    deviceData.azure_device_id = existingDevice.azure_device_id
                    if (existingDevice.employee_id) {
                      deviceData.employee_id = existingDevice.employee_id
                    }
                  }
                }
              }

              let deviceId: string

              if (existingDevice) {
                // Update existing device - preserve azure_device_id if it exists
                const updateData = { ...deviceData }
                if (existingDevice.azure_device_id) {
                  // Keep azure_device_id from existing device
                }
                
                const { error: updateError } = await supabase
                  .from('devices')
                  .update(updateData)
                  .eq('id', existingDevice.id)
                
                if (updateError) {
                  throw new Error(`Failed to update device: ${updateError.message}`)
                }
                
                deviceId = existingDevice.id
              } else {
                // Before creating new device, check if there's an Azure device with matching serial number
                // This handles cases where NinjaOne device names are truncated but serial numbers are not
                // Use actual serial number from NinjaOne device details (full serial, not truncated)
                // Compare to serial number extracted from Azure device names (which are full length)
                let serialNumberMatch = false
                
                // Get actual serial number from NinjaOne device details (this is the full serial number)
                const ninjaSerialNumber = (deviceDetails.system?.serialNumber || deviceDetails.system?.biosSerialNumber || '').trim()
                
                if (ninjaSerialNumber) {
                  console.log(`  🔍 Checking for Azure device match by serial number: NinjaOne serial="${ninjaSerialNumber}" from device "${deviceName}"`)
                  
                  // Query Azure devices by serial_number field directly (case-insensitive)
                  // This matches devices with same serial but different prefixes (e.g., "00-HKXRGK2" and "atl-HKXRGK2")
                  // Normalize to uppercase to match how Azure sync stores serial numbers
                  const normalizedNinjaSerial = ninjaSerialNumber.toUpperCase().trim()
                  console.log(`  🔍 Normalized NinjaOne serial: "${normalizedNinjaSerial}"`)
                  
                  const { data: azureDevicesBySerial, error: serialError } = await supabase
                    .from('devices')
                    .select('id, azure_device_id, employee_id, device_name, ninja_device_id, serial_number, last_synced_at')
                    .not('azure_device_id', 'is', null)
                    .or(`and(ninja_device_id.is.null),and(ninja_device_id.eq.${device.id.toString()})`)
                    .ilike('serial_number', normalizedNinjaSerial)
                  
                  if (serialError && serialError.code !== 'PGRST116') {
                    console.error(`  Error checking by serial_number field:`, serialError)
                  } else if (azureDevicesBySerial && azureDevicesBySerial.length > 0) {
                    // Found matching Azure device(s) by serial number
                    // If multiple devices with same serial, use the one with latest last_synced_at (most current)
                    let bestMatch = azureDevicesBySerial[0]
                    if (azureDevicesBySerial.length > 1) {
                      // Sort by last_synced_at (descending) - most recent first
                      azureDevicesBySerial.sort((a: any, b: any) => {
                        const dateA = a.last_synced_at || '1970-01-01'
                        const dateB = b.last_synced_at || '1970-01-01'
                        return dateB.localeCompare(dateA)
                      })
                      bestMatch = azureDevicesBySerial[0]
                      console.log(`  ⚠️ Found ${azureDevicesBySerial.length} Azure devices with same serial number "${normalizedNinjaSerial}" - using most recent (${bestMatch.device_name})`)
                    }
                    
                    // Skip if device is already matched to a different NinjaOne device
                    if (bestMatch.ninja_device_id && bestMatch.ninja_device_id !== device.id.toString()) {
                      console.log(`  ⚠️ Azure device "${bestMatch.device_name}" is already matched to different NinjaOne device - skipping`)
                    } else {
                      existingDevice = bestMatch
                      serialNumberMatch = true
                      console.log(`  📌 ✅ FOUND MATCH by serial_number field: Azure device "${bestMatch.device_name}" (serial: ${bestMatch.serial_number}) matches NinjaOne serial "${ninjaSerialNumber}"`)
                    }
                  } else {
                    console.log(`  ❌ No Azure device match found for serial number "${ninjaSerialNumber}" by serial_number field`)
                  }
                } else {
                  console.log(`  ⚠️ NinjaOne device "${deviceName}" has no serial number in device details - cannot match by serial`)
                }
                
                if (existingDevice && serialNumberMatch) {
                  // Update the matched Azure device instead of creating new one
                  // This prevents "NinjaOne Only" devices when names are truncated
                  const updateData = { ...deviceData }
                  // Preserve azure_device_id and employee_id from Azure device
                  if (existingDevice.azure_device_id) {
                    updateData.azure_device_id = existingDevice.azure_device_id
                  }
                  if (existingDevice.employee_id) {
                    updateData.employee_id = existingDevice.employee_id
                  }
                  
                  const { error: updateError } = await supabase
                    .from('devices')
                    .update(updateData)
                    .eq('id', existingDevice.id)
                  
                  if (updateError) {
                    throw new Error(`Failed to update device: ${updateError.message}`)
                  }
                  
                  deviceId = existingDevice.id
                  console.log(`  ✅ Matched and updated Azure device by serial number: ${existingDevice.device_name}`)
                } else {
                  // Insert new device (truly NinjaOne only)
                  const { data: newDevice, error: insertError } = await supabase
                    .from('devices')
                    .insert(deviceData)
                    .select('id')
                    .single()
                  
                  if (insertError) {
                    throw new Error(`Failed to insert device: ${insertError.message}`)
                  }
                  
                  if (!newDevice) {
                    throw new Error('Device insert returned null')
                  }
                  
                  deviceId = newDevice.id
                  console.log(`  ✅ Created new NinjaOne-only device: ${deviceName}`)
                }
              }

              // Sync software for this device (async - don't wait for it to complete)
              ninjaOne.getDeviceSoftware(device.id)
                .then(async (softwareList) => {
                  if (softwareList && softwareList.length > 0) {
                    // Delete existing software links for this device
                    await supabase
                      .from('device_software')
                      .delete()
                      .eq('device_id', deviceId)

                    // Process each software
                    for (const sw of softwareList) {
                      try {
                        const softwareName = sw.name
                        const softwareVersion = sw.version || null
                        const publisher = sw.publisher || null

                        // Check if software already exists
                        let { data: existingSoftware } = await supabase
                          .from('software')
                          .select('id')
                          .eq('name', softwareName)
                          .eq('version', softwareVersion)
                          .eq('publisher', publisher)
                          .single()

                        let softwareId: string

                        if (existingSoftware) {
                          softwareId = existingSoftware.id
                        } else {
                          // Insert new software
                          const { data: newSoftware, error: swInsertError } = await supabase
                            .from('software')
                            .insert({
                              name: softwareName,
                              version: softwareVersion,
                              publisher: publisher
                            })
                            .select('id')
                            .single()

                          if (swInsertError || !newSoftware) {
                            continue
                          }

                          softwareId = newSoftware.id
                        }

                        // Link software to device
                        await supabase
                          .from('device_software')
                          .insert({
                            device_id: deviceId,
                            software_id: softwareId,
                            install_date: sw.installDate || null,
                            last_synced_at: new Date().toISOString()
                          })
                      } catch (swItemError) {
                        // Silent fail for software items
                      }
                    }
                  }
                })
                .catch(() => {
                  // Silent fail for software sync - device is already saved
                })

              return { success: true, deviceId: device.id }
            } catch (error: any) {
              const errorMsg = `Failed to sync device ${device.id}: ${error.message}`
              errors.push(errorMsg)
              return { success: false, deviceId: device.id, error: errorMsg }
            }
          }))

          // Count successes and failures
          const batchSynced = results.filter((r: any) => r.success).length
          const batchFailed = results.filter((r: any) => !r.success).length
          recordsSynced += batchSynced
          recordsFailed += batchFailed
          
          // Log progress
          console.log(`Completed batch ${batchIndex + 1}/${batches.length} - Batch: ${batchSynced} synced, ${batchFailed} failed | Total: ${recordsSynced} synced, ${recordsFailed} failed`)
        }
      
      console.log(`NinjaOne sync complete: ${recordsSynced} synced, ${recordsFailed} failed (software sync continues in background)`)

      // Update sync log
      const duration = Math.floor((Date.now() - startTime) / 1000)
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
    console.error('NinjaOne sync error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to sync NinjaOne data' },
      { status: 500 }
    )
  }
}

