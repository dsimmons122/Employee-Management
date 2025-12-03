import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase'

// Configure route for long-running operations
export const maxDuration = 300 // 5 minutes (Vercel Pro max, adjust if needed)
export const runtime = 'nodejs' // Use Node.js runtime (not Edge)

// Store active syncs to prevent garbage collection in serverless environments
const activeSyncs = new Map<string, Promise<void>>()

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

    // Create sync log entry for unified sync
    const { data: syncLog } = await supabase
      .from('sync_logs')
      .insert({
        sync_type: 'all',
        status: 'success', // Will be updated when complete
        started_at: new Date().toISOString()
      })
      .select()
      .single()

    if (!syncLog) {
      return NextResponse.json(
        { error: 'Failed to create sync log' },
        { status: 500 }
      )
    }

    const syncId = syncLog.id
    const startTime = Date.now()

    console.log(`\n[Sync ${syncId}] ========================================`)
    console.log(`[Sync ${syncId}] 🚀 UNIFIED SYNC STARTED`)
    console.log(`[Sync ${syncId}] Sync ID: ${syncId}`)
    console.log(`[Sync ${syncId}] Started at: ${new Date().toISOString()}`)
    console.log(`[Sync ${syncId}] ========================================\n`)

    // Start sync asynchronously - don't await, return immediately
    const syncPromise = (async () => {
      console.log(`[Sync ${syncId}] 📍 Async task started, beginning sync process...`)
      const results = {
        azure: { recordsSynced: 0, recordsFailed: 0, errors: [] as string[] },
        ninjaone: { recordsSynced: 0, recordsFailed: 0, errors: [] as string[] }
      }

      try {
        // Step 1: Sync Azure Entra ID first
        console.log(`[Sync ${syncId}] Step 1: Starting Azure Entra ID sync...`)
        
        // Construct the base URL from the request URL
        const url = new URL(request.url)
        const baseUrl = `${url.protocol}//${url.host}`
        
        try {
          console.log(`[Sync ${syncId}] Calling Azure sync endpoint at ${baseUrl}/api/sync/entra-id...`)
          
          // Track when Azure sync starts for timeout handling
          const azureStartTime = Date.now()
          
          // Add a timeout with fallback to DB check (6 minutes max)
          // Azure sync can take ~5 minutes, so we give it a bit of buffer
          const azureTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Azure sync timeout after 6 minutes - will check DB')), 6 * 60 * 1000)
          )
          
          // Create a promise that resolves when Azure sync completes in DB (early exit)
          let dbCheckResolve: ((value: any) => void) | null = null
          const azureDBComplete = new Promise((resolve) => {
            dbCheckResolve = resolve
          })
          
          let azureResponse: Response | null = null
          let backgroundChecker: NodeJS.Timeout | null = null
          let azureCompletedInDB = false
          
          try {
            console.log(`[Sync ${syncId}] Making fetch request to Azure sync endpoint...`)
            
            // Start the fetch
            const fetchPromise = fetch(`${baseUrl}/api/sync/entra-id`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(authHeader ? { 'Authorization': authHeader } : {})
              }
            })
            
            // Start a background checker that polls the sync log - will trigger early exit
            let checkCount = 0
            backgroundChecker = setInterval(async () => {
              checkCount++
              try {
                const { data: latestAzureSync, error } = await supabase
                  .from('sync_logs')
                  .select('*')
                  .eq('sync_type', 'entra_id')
                  .order('started_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
                
                if (error) {
                  console.log(`[Sync ${syncId}] DB check ${checkCount}: Error querying Azure sync log:`, error.message)
                  return
                }
                
                if (latestAzureSync) {
                  const isCompleted = !!latestAzureSync.completed_at
                  console.log(`[Sync ${syncId}] DB check ${checkCount}: Azure sync found - completed: ${isCompleted}, synced: ${latestAzureSync.records_synced}, started: ${latestAzureSync.started_at}`)
                  
                  if (isCompleted && !azureResponse && !azureCompletedInDB) {
                    console.log(`[Sync ${syncId}] ⚡ Azure sync completed in DB (${latestAzureSync.records_synced} synced). Breaking out of fetch wait!`)
                    azureCompletedInDB = true
                    results.azure = {
                      recordsSynced: latestAzureSync.records_synced || 0,
                      recordsFailed: latestAzureSync.records_failed || 0,
                      errors: latestAzureSync.error_message ? [latestAzureSync.error_message] : []
                    }
                    if (backgroundChecker) {
                      clearInterval(backgroundChecker)
                      backgroundChecker = null
                    }
                    // Resolve the DB complete promise to break out of Promise.race early
                    if (dbCheckResolve) {
                      dbCheckResolve({ completed: true, syncLog: latestAzureSync })
                    }
                  }
                } else {
                  console.log(`[Sync ${syncId}] DB check ${checkCount}: No Azure sync log found yet`)
                }
              } catch (checkError: any) {
                console.error(`[Sync ${syncId}] DB check ${checkCount}: Exception:`, checkError.message)
              }
            }, 2000) // Check every 2 seconds for faster detection
            
            try {
              // Race between fetch, timeout, and DB completion
              const result = await Promise.race([
                fetchPromise.then(res => ({ type: 'fetch', response: res })),
                azureTimeout.then(() => ({ type: 'timeout' })),
                azureDBComplete.then(data => ({ type: 'db', data }))
              ])
              
              clearInterval(backgroundChecker)
              
              if (result.type === 'fetch' && 'response' in result) {
                azureResponse = result.response as Response
                console.log(`[Sync ${syncId}] ✅ Azure sync endpoint returned with status: ${azureResponse.status}`)
              } else if (result.type === 'db') {
                console.log(`[Sync ${syncId}] ✅ Azure sync completed in DB. Using DB data and proceeding (skipped HTTP response wait).`)
                azureResponse = null // Mark as handled, results.azure already populated
              } else {
                throw new Error('Azure sync timeout')
              }
            } catch (raceError: any) {
              clearInterval(backgroundChecker)
              
              // If Azure completed in DB but fetch failed, use DB data
              if (azureCompletedInDB) {
                console.log(`[Sync ${syncId}] ✅ Error occurred but Azure completed in DB. Using DB data and proceeding.`)
                azureResponse = null // Mark as handled, results.azure already populated
              } else {
                throw raceError
              }
            }
          } catch (fetchError: any) {
            if (backgroundChecker) {
              clearInterval(backgroundChecker)
              backgroundChecker = null
            }
            
            // If fetch fails but we already got data from DB, we're good
            if (!azureCompletedInDB) {
              // If fetch fails or times out, check if Azure sync log shows it completed
              console.warn(`[Sync ${syncId}] Azure sync fetch failed/timed out. Waiting 3 seconds then checking if Azure sync completed in database...`)
              
              // Wait and check multiple times - Azure sync might still be processing
              console.log(`[Sync ${syncId}] Waiting for Azure sync to complete in database (checking every 5 seconds, max 5 minutes)...`)
              let azureFoundComplete = false
              let latestAzureSync: any = null
              
              for (let waitAttempt = 0; waitAttempt < 60; waitAttempt++) { // Check for up to 5 minutes (60 * 5 seconds)
                await new Promise(resolve => setTimeout(resolve, 5000))
                
                const { data: syncLog } = await supabase
                  .from('sync_logs')
                  .select('*')
                  .eq('sync_type', 'entra_id')
                  .order('started_at', { ascending: false })
                  .limit(1)
                  .single()
                
                latestAzureSync = syncLog
                
                if (syncLog && syncLog.completed_at) {
                  console.log(`[Sync ${syncId}] ✅ Azure sync completed in database (attempt ${waitAttempt + 1}). Using sync log data.`)
                  results.azure = {
                    recordsSynced: syncLog.records_synced || 0,
                    recordsFailed: syncLog.records_failed || 0,
                    errors: syncLog.error_message ? [syncLog.error_message] : []
                  }
                  azureFoundComplete = true
                  break
                } else {
                  const status = syncLog ? `status=${syncLog.status}, synced=${syncLog.records_synced || 0}, completed_at=${syncLog.completed_at || 'null'}` : 'not found'
                  if (waitAttempt % 6 === 0 || waitAttempt < 3) { // Log every 30 seconds or first 3 attempts
                    console.log(`[Sync ${syncId}] Waiting... (attempt ${waitAttempt + 1}/60) - Azure sync log: ${status}`)
                  }
                }
              }
              
              if (!azureFoundComplete) {
                const status = latestAzureSync ? `status=${latestAzureSync.status}, completed_at=${latestAzureSync.completed_at || 'null'}, synced=${latestAzureSync.records_synced || 0}` : 'not found'
                console.error(`[Sync ${syncId}] ❌ Azure sync did not complete after waiting 5 minutes. Sync log: ${status}`)
                throw new Error(`Azure sync did not complete within expected time`)
              }
            }
          }

          if (azureResponse) {
            if (azureResponse.ok) {
              const azureResult = await azureResponse.json()
              results.azure = {
                recordsSynced: azureResult.recordsSynced || 0,
                recordsFailed: azureResult.recordsFailed || 0,
                errors: azureResult.errors || []
              }
              console.log(`[Sync ${syncId}] ✅ Azure sync completed: ${results.azure.recordsSynced} synced, ${results.azure.recordsFailed} failed`)
            } else {
              const error = await azureResponse.json().catch(() => ({ error: 'Unknown error' }))
              results.azure.errors.push(error.error || 'Azure sync failed')
              console.error(`[Sync ${syncId}] ❌ Azure sync failed:`, error)
              
              // Stop sync if Azure fails - don't proceed to NinjaOne
              throw new Error(`Azure sync failed: ${error.error || 'Unknown error'}`)
            }
          }
          
          // Verify Azure sync succeeded before proceeding
          if (results.azure.errors.length > 0) {
            throw new Error(`Azure sync failed with errors: ${results.azure.errors.join('; ')}`)
          }
          
          // If azureResponse is null, we already populated results.azure from the sync log
        } catch (fetchError: any) {
          console.error(`[Sync ${syncId}] ❌ Error calling Azure sync endpoint:`, fetchError)
          
          // Wait and check multiple times - Azure sync might still be processing
          console.log(`[Sync ${syncId}] Waiting for Azure sync to complete in database (checking every 5 seconds, max 10 minutes)...`)
          let azureFoundComplete = false
          let latestAzureSync: any = null
          
          for (let waitAttempt = 0; waitAttempt < 120; waitAttempt++) { // Check for up to 10 minutes (120 * 5 seconds)
            await new Promise(resolve => setTimeout(resolve, 5000))
            
            const { data: syncLog } = await supabase
              .from('sync_logs')
              .select('*')
              .eq('sync_type', 'entra_id')
              .order('started_at', { ascending: false })
              .limit(1)
              .single()
            
            latestAzureSync = syncLog
            
            if (syncLog && syncLog.completed_at) {
              console.log(`[Sync ${syncId}] ✅ Azure sync completed in database (attempt ${waitAttempt + 1}). Using sync log data.`)
              results.azure = {
                recordsSynced: syncLog.records_synced || 0,
                recordsFailed: syncLog.records_failed || 0,
                errors: syncLog.error_message ? [syncLog.error_message] : []
              }
              
              // If Azure sync actually failed (status is 'failed'), stop here
              if (syncLog.status === 'failed' || (syncLog.error_message && syncLog.records_synced === 0)) {
                throw new Error(`Azure sync failed: ${syncLog.error_message || 'Unknown error'}`)
              }
              
              azureFoundComplete = true
              break
            } else {
              const status = syncLog ? `status=${syncLog.status}, synced=${syncLog.records_synced || 0}, completed_at=${syncLog.completed_at || 'null'}` : 'not found'
              if (waitAttempt % 6 === 0 || waitAttempt < 3) { // Log every 30 seconds or first 3 attempts
                console.log(`[Sync ${syncId}] Waiting... (attempt ${waitAttempt + 1}/120) - Azure sync log: ${status}`)
              }
            }
          }
          
          if (!azureFoundComplete) {
            const status = latestAzureSync ? `status=${latestAzureSync.status}, completed_at=${latestAzureSync.completed_at || 'null'}, synced=${latestAzureSync.records_synced || 0}` : 'not found'
            console.error(`[Sync ${syncId}] ❌ Azure sync did not complete after waiting 10 minutes. Sync log: ${status}`)
            throw new Error(`Azure sync did not complete within expected time`)
          }
        }
        
        // Final verification: Azure must have succeeded to proceed
        if (results.azure.errors.length > 0 || results.azure.recordsSynced === 0) {
          throw new Error(`Azure sync failed: ${results.azure.errors.length > 0 ? results.azure.errors.join('; ') : 'No records synced'}`)
        }
        
        console.log(`[Sync ${syncId}] ✅ Azure sync succeeded. Proceeding to NinjaOne sync...`)

        // Wait a moment between syncs
        console.log(`[Sync ${syncId}] Waiting 1 second before starting NinjaOne sync...`)
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Step 2: Sync NinjaOne (depends on Azure sync being complete)
        console.log(`[Sync ${syncId}] Starting NinjaOne sync...`)
        try {
          // Add a timeout for the NinjaOne sync (30 minutes max)
          const ninjaTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('NinjaOne sync timeout after 30 minutes')), 30 * 60 * 1000)
          )
          
          const ninjaResponse = await Promise.race([
            fetch(`${baseUrl}/api/sync/ninjaone`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(authHeader ? { 'Authorization': authHeader } : {})
              }
            }),
            ninjaTimeout
          ]) as Response

          if (ninjaResponse.ok) {
            const ninjaResult = await ninjaResponse.json()
            results.ninjaone = {
              recordsSynced: ninjaResult.recordsSynced || 0,
              recordsFailed: ninjaResult.recordsFailed || 0,
              errors: ninjaResult.errors || []
            }
            console.log(`[Sync ${syncId}] NinjaOne sync completed: ${results.ninjaone.recordsSynced} synced, ${results.ninjaone.recordsFailed} failed`)
          } else {
            const error = await ninjaResponse.json().catch(() => ({ error: 'Unknown error' }))
            results.ninjaone.errors.push(error.error || 'NinjaOne sync failed')
            console.error(`[Sync ${syncId}] ❌ NinjaOne sync failed:`, error)
            
            // Stop sync if NinjaOne fails
            throw new Error(`NinjaOne sync failed: ${error.error || 'Unknown error'}`)
          }
        } catch (fetchError: any) {
          console.error(`[Sync ${syncId}] ❌ Error calling NinjaOne sync endpoint:`, fetchError)
          
          // Check if NinjaOne actually completed in DB despite fetch failure
          const { data: latestNinjaSync } = await supabase
            .from('sync_logs')
            .select('*')
            .eq('sync_type', 'ninjaone')
            .order('started_at', { ascending: false })
            .limit(1)
            .single()
          
          if (latestNinjaSync && latestNinjaSync.completed_at && latestNinjaSync.status !== 'failed') {
            // NinjaOne completed successfully in DB, use that data
            console.log(`[Sync ${syncId}] ⚠️ Fetch failed but NinjaOne sync completed in DB. Using DB data.`)
            results.ninjaone = {
              recordsSynced: latestNinjaSync.records_synced || 0,
              recordsFailed: latestNinjaSync.records_failed || 0,
              errors: latestNinjaSync.error_message ? [latestNinjaSync.error_message] : []
            }
          } else {
            // NinjaOne didn't complete or failed - stop sync
            throw new Error(`NinjaOne sync failed: ${fetchError.message || 'Unknown error'}`)
          }
        }

        console.log(`[Sync ${syncId}] Both syncs finished. Calculating final status...`)
        console.log(`[Sync ${syncId}] Azure: ${results.azure.recordsSynced} synced, ${results.azure.recordsFailed} failed, errors: ${results.azure.errors.length}`)
        console.log(`[Sync ${syncId}] NinjaOne: ${results.ninjaone.recordsSynced} synced, ${results.ninjaone.recordsFailed} failed, errors: ${results.ninjaone.errors.length}`)

        // Determine overall status
        const totalSynced = results.azure.recordsSynced + results.ninjaone.recordsSynced
        const totalFailed = results.azure.recordsFailed + results.ninjaone.recordsFailed
        const hasErrors = results.azure.errors.length > 0 || results.ninjaone.errors.length > 0

        const status = hasErrors && totalSynced === 0 ? 'failed' : 
                       (hasErrors || totalFailed > 0 ? 'partial' : 'success')

        const duration = Math.round((Date.now() - startTime) / 1000)

        console.log(`[Sync ${syncId}] Final status: ${status} (${totalSynced} synced, ${totalFailed} failed, duration: ${duration}s)`)
        console.log(`[Sync ${syncId}] Updating unified sync log with completion status...`)

        // ALWAYS update sync log - ensure completion is marked even if errors occurred
        try {
          const updateData = {
            status,
            records_synced: totalSynced,
            records_failed: totalFailed,
            duration_seconds: duration,
            completed_at: new Date().toISOString(),
            error_message: hasErrors ? (results.azure.errors.concat(results.ninjaone.errors).join('; ') || null) : null
          }
          
          console.log(`[Sync ${syncId}] Attempting to update sync log with:`, updateData)
          
          // First, verify the sync log exists and get current state
          const { data: beforeUpdate } = await supabase
            .from('sync_logs')
            .select('*')
            .eq('id', syncId)
            .single()
          
          if (!beforeUpdate) {
            console.error(`[Sync ${syncId}] ❌ Sync log not found! Cannot update.`)
            throw new Error(`Sync log ${syncId} not found`)
          }
          
          console.log(`[Sync ${syncId}] Current sync log state before update:`, {
            status: beforeUpdate.status,
            completed_at: beforeUpdate.completed_at,
            records_synced: beforeUpdate.records_synced,
            records_failed: beforeUpdate.records_failed
          })
          
          // CRITICAL: Use a completely fresh Supabase client for the final update
          // This ensures the update is committed properly and visible to other connections
          const updateSupabase = getServiceSupabase()
          const { data: updatedData, error: updateError, count } = await updateSupabase
            .from('sync_logs')
            .update(updateData)
            .eq('id', syncId)
            .select()
            .single()

          if (updateError) {
            console.error(`[Sync ${syncId}] ❌ Error updating sync log:`, updateError)
            console.error(`[Sync ${syncId}] Update error details:`, JSON.stringify(updateError, null, 2))
          } else if (!updatedData) {
            console.error(`[Sync ${syncId}] ❌ Update returned no data - update may not have matched any rows!`)
            // Try one more time with just completion status
            const { error: retryError } = await supabase
              .from('sync_logs')
              .update({
                completed_at: new Date().toISOString(),
                status: 'partial'
              })
              .eq('id', syncId)
              .select()
              .single()
            
            if (retryError) {
              console.error(`[Sync ${syncId}] ❌ Retry update also failed:`, retryError)
            } else {
              console.log(`[Sync ${syncId}] ⚠️ Retry update succeeded with partial status`)
            }
          } else {
            console.log(`[Sync ${syncId}] ✅ Sync log updated successfully:`, {
              id: updatedData.id,
              status: updatedData.status,
              completed_at: updatedData.completed_at,
              records_synced: updatedData.records_synced,
              records_failed: updatedData.records_failed
            })
            
            // Small delay to ensure database commit completes
            await new Promise(resolve => setTimeout(resolve, 500))
            
            // Verify the update actually persisted using a fresh query
            const { data: verifyData, error: verifyError } = await supabase
              .from('sync_logs')
              .select('*')
              .eq('id', syncId)
              .single()
            
            if (verifyError) {
              console.error(`[Sync ${syncId}] ❌ Error verifying update:`, verifyError)
            } else if (verifyData && verifyData.completed_at) {
              console.log(`[Sync ${syncId}] ✅ Verified: sync log has completed_at=${verifyData.completed_at}, synced=${verifyData.records_synced}, failed=${verifyData.records_failed}`)
              
              // Wait a moment and verify again with a fresh query to ensure persistence
              await new Promise(resolve => setTimeout(resolve, 1000))
              
              // Final verification with completely fresh client to ensure other endpoints can see it
              const finalSupabase = getServiceSupabase()
              const { data: finalVerify } = await finalSupabase
                .from('sync_logs')
                .select('*')
                .eq('id', syncId)
                .single()
              
              if (finalVerify && finalVerify.completed_at) {
                console.log(`[Sync ${syncId}] ✅ Final verification passed: completed_at=${finalVerify.completed_at}, synced=${finalVerify.records_synced}`)
                
                // CRITICAL: Wait longer and verify one more time to ensure update is visible to other connections
                // This addresses the issue where status endpoint sees old values
                await new Promise(resolve => setTimeout(resolve, 2000))
                
                // Query one more time with a completely fresh client - simulate what status endpoint does
                const statusCheckSupabase = getServiceSupabase()
                const { data: statusCheckVerify } = await statusCheckSupabase
                  .from('sync_logs')
                  .select('*')
                  .eq('id', syncId)
                  .maybeSingle()
                
                if (statusCheckVerify && statusCheckVerify.completed_at) {
                  console.log(`[Sync ${syncId}] ✅ Status-check simulation passed: completed_at=${statusCheckVerify.completed_at}, synced=${statusCheckVerify.records_synced}`)
                } else {
                  console.error(`[Sync ${syncId}] ❌ CRITICAL: Status-check simulation FAILED! Update not visible to other connections!`)
                  console.error(`[Sync ${syncId}] Status-check data:`, statusCheckVerify)
                  
                  // CRITICAL FIX: Update again with the fresh client and explicitly wait
                  console.log(`[Sync ${syncId}] 🔧 Attempting last-resort update with fresh client...`)
                  const { data: lastResortData, error: lastResortError } = await statusCheckSupabase
                    .from('sync_logs')
                    .update(updateData)
                    .eq('id', syncId)
                    .select()
                    .single()
                  
                  if (lastResortError) {
                    console.error(`[Sync ${syncId}] ❌ Last resort update failed:`, lastResortError)
                  } else if (lastResortData && lastResortData.completed_at) {
                    console.log(`[Sync ${syncId}] ✅ Last resort update succeeded with fresh client`)
                    
                    // Wait a moment and verify one more time
                    await new Promise(resolve => setTimeout(resolve, 1000))
                    
                    const { data: finalVerify } = await statusCheckSupabase
                      .from('sync_logs')
                      .select('*')
                      .eq('id', syncId)
                      .single()
                    
                    if (finalVerify && finalVerify.completed_at) {
                      console.log(`[Sync ${syncId}] ✅ Final verify after last-resort update: completed_at=${finalVerify.completed_at}`)
                    } else {
                      console.error(`[Sync ${syncId}] ❌ Even after last-resort update, final verify failed!`)
                    }
                  } else {
                    console.error(`[Sync ${syncId}] ❌ Last resort update returned no data`)
                  }
                }
              } else {
                console.error(`[Sync ${syncId}] ❌ Final verification failed - sync log lost completed_at! This suggests a database issue.`)
                console.error(`[Sync ${syncId}] Final verify data:`, finalVerify)
              }
            } else {
              console.error(`[Sync ${syncId}] ❌ WARNING: Update succeeded but verification shows completed_at is still null!`)
              console.error(`[Sync ${syncId}] Verify data returned:`, verifyData)
              
              // Wait a moment for database to commit
              await new Promise(resolve => setTimeout(resolve, 2000))
              
              // Query again with fresh client connection
              const freshSupabase = getServiceSupabase()
              const { data: retryVerify } = await freshSupabase
                .from('sync_logs')
                .select('*')
                .eq('id', syncId)
                .single()
              
              if (retryVerify && retryVerify.completed_at) {
                console.log(`[Sync ${syncId}] ✅ After delay: sync log now shows completed_at=${retryVerify.completed_at}`)
              } else {
                // Force update one more time
                console.error(`[Sync ${syncId}] ❌ Still null after delay. Forcing update...`)
                const { error: retryError } = await freshSupabase
                  .from('sync_logs')
                  .update({
                    status,
                    records_synced: totalSynced,
                    records_failed: totalFailed,
                    duration_seconds: duration,
                    completed_at: new Date().toISOString()
                  })
                  .eq('id', syncId)
                
                if (retryError) {
                  console.error(`[Sync ${syncId}] ❌ Force update failed:`, retryError)
                } else {
                  console.log(`[Sync ${syncId}] ✅ Force update succeeded`)
                }
              }
            }
          }
        } catch (updateErr: any) {
          console.error(`[Sync ${syncId}] ❌ Critical error updating sync log:`, updateErr)
          // Last resort - try to mark as complete
          try {
            const { error: lastResortError } = await supabase
              .from('sync_logs')
              .update({ completed_at: new Date().toISOString() })
              .eq('id', syncId)
              .select()
              .single()
            
            if (lastResortError) {
              console.error(`[Sync ${syncId}] ❌ Last resort update also failed:`, lastResortError)
            } else {
              console.log(`[Sync ${syncId}] ⚠️ Last resort update succeeded`)
            }
          } catch (e: any) {
            console.error(`[Sync ${syncId}] ❌ Failed to mark sync as complete:`, e)
          }
        }

        console.log(`[Sync ${syncId}] ✅ Sync completed with status: ${status} (${totalSynced} synced, ${totalFailed} failed)`)
      } catch (error: any) {
        console.error(`[Sync ${syncId}] ❌ Unexpected error during unified sync:`, error)
        
        const duration = Math.round((Date.now() - startTime) / 1000)

        // CRITICAL: Always mark sync as complete even on unexpected errors
        try {
          const { error: updateError } = await supabase
            .from('sync_logs')
            .update({
              status: 'failed',
              records_failed: results.azure.recordsFailed + results.ninjaone.recordsFailed,
              duration_seconds: duration,
              completed_at: new Date().toISOString(),
              error_message: error.message || 'Sync failed unexpectedly'
            })
            .eq('id', syncId)

          if (updateError) {
            console.error(`[Sync ${syncId}] Error updating sync log on failure:`, updateError)
            // Last resort
            await supabase
              .from('sync_logs')
              .update({ completed_at: new Date().toISOString() })
              .eq('id', syncId)
          }
        } catch (updateErr: any) {
          console.error(`[Sync ${syncId}] Critical error updating sync log on failure:`, updateErr)
        }
      } finally {
        // Clean up
        activeSyncs.delete(syncId)
        console.log(`[Sync ${syncId}] Cleaned up active sync tracking`)
      }
    })()

    // Store the promise to prevent garbage collection
    activeSyncs.set(syncId, syncPromise)
    
    // Handle unhandled errors
    syncPromise.catch(err => {
      console.error(`[Sync ${syncId}] Unhandled error in sync:`, err)
      activeSyncs.delete(syncId)
    })

    // Return immediately with sync ID - client will poll for status
    return NextResponse.json({
      success: true,
      syncId,
      message: 'Sync started. Poll /api/sync/status/[id] for updates.'
    })

  } catch (error: any) {
    console.error('Error in unified sync endpoint:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to start unified sync' },
      { status: 500 }
    )
  }
}

