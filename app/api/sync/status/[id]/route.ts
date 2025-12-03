import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Use the exact same query as /api/sync/logs since that endpoint returns correct data
    // Query directly from database using same pattern
    const supabase = getServiceSupabase()
    
    // Query sync logs exactly like /api/sync/logs does
    const { data: allLogs, error } = await supabase
      .from('sync_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100)
    
    if (error) {
      console.error(`[Status Check] Error fetching sync logs:`, error)
      throw error
    }
    
    // Find the sync log with matching ID from the list
    const syncLog = allLogs?.find((log: any) => log.id === params.id)
    
    if (!syncLog) {
      // If not found in recent logs, the sync might be older - try direct query
      console.log(`[Status Check] Sync ${params.id} not found in recent 100 logs, trying direct query...`)
      const { data: directSyncLog, error: directError } = await supabase
        .from('sync_logs')
        .select('*')
        .eq('id', params.id)
        .maybeSingle()
      
      if (directError || !directSyncLog) {
        console.error(`[Status Check] Sync log not found for ID: ${params.id}`)
        return NextResponse.json(
          { error: 'Sync log not found' },
          { status: 404 }
        )
      }
      
      return await processSyncLog(directSyncLog, params.id, request)
    }
    
    return await processSyncLog(syncLog, params.id, request)
  } catch (error: any) {
    console.error(`[Status Check] Error fetching sync status for ID ${params.id}:`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch sync status' },
      { status: 500 }
    )
  }
}

async function processSyncLog(syncLog: any, id: string, request?: NextRequest) {
  // Check completed_at more carefully - it might be a string "null" or actual null
  const isComplete = syncLog.completed_at !== null && 
                     syncLog.completed_at !== undefined && 
                     String(syncLog.completed_at).toLowerCase() !== 'null'
  const status = syncLog.status
  
  // Log ALL details to help debug - log RAW values first
  console.log(`[Status Check ${id}] RAW sync log data:`, JSON.stringify(syncLog, null, 2))
  console.log(`[Status Check ${id}] Full sync log data:`, {
    id: syncLog.id,
    sync_type: syncLog.sync_type,
    status: status,
    isComplete: isComplete,
    completed_at: syncLog.completed_at,
    completed_at_type: typeof syncLog.completed_at,
    completed_at_raw: syncLog.completed_at === null ? 'NULL' : syncLog.completed_at === undefined ? 'UNDEFINED' : String(syncLog.completed_at),
    records_synced: syncLog.records_synced,
    records_synced_type: typeof syncLog.records_synced,
    records_failed: syncLog.records_failed,
    duration_seconds: syncLog.duration_seconds,
    started_at: syncLog.started_at,
    error_message: syncLog.error_message
  })
  
  // WORKAROUND: If unified sync shows status=success but completed_at is null, check via HTTP call to logs endpoint
  // This handles the database visibility issue where updates aren't immediately visible across connections
  if (syncLog.sync_type === 'all' && !isComplete && syncLog.status === 'success') {
    console.warn(`[Status Check ${id}] ⚠️ WARNING: Unified sync log shows status=success but completed_at is null!`)
    console.log(`[Status Check ${id}] 🔧 Attempting to fetch from /api/sync/logs endpoint as fallback...`)
    
    // Try fetching from the HTTP logs endpoint which returns correct data
    try {
      // Get the base URL from the request object
      let baseUrl = 'http://localhost:3000'
      if (request) {
        const url = new URL(request.url)
        baseUrl = `${url.protocol}//${url.host}`
      } else if (process.env.NEXT_PUBLIC_BASE_URL) {
        baseUrl = process.env.NEXT_PUBLIC_BASE_URL
      }
      
      const logsResponse = await fetch(`${baseUrl}/api/sync/logs?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json'
        }
      })
      
      if (logsResponse.ok) {
        const logsData = await logsResponse.json()
        const freshLog = logsData.logs?.find((log: any) => log.id === id)
        
        if (freshLog && freshLog.completed_at) {
          console.log(`[Status Check ${id}] ✅ Fallback HTTP call found completed sync: completed_at=${freshLog.completed_at}, synced=${freshLog.records_synced}`)
          // Use the fresh data from logs endpoint
          return NextResponse.json({
            id: freshLog.id,
            status: freshLog.status,
            isComplete: true,
            recordsSynced: freshLog.records_synced || 0,
            recordsFailed: freshLog.records_failed || 0,
            duration: freshLog.duration_seconds,
            completedAt: freshLog.completed_at,
            errorMessage: freshLog.error_message,
            startedAt: freshLog.started_at
          })
        } else if (freshLog) {
          console.log(`[Status Check ${id}] ⚠️ Fallback HTTP call found sync but still shows completed_at=null`)
        } else {
          console.log(`[Status Check ${id}] ⚠️ Fallback HTTP call did not find sync in logs`)
        }
      } else {
        console.error(`[Status Check ${id}] Fallback HTTP call to logs endpoint failed with status: ${logsResponse.status}`)
      }
    } catch (fallbackError: any) {
      console.error(`[Status Check ${id}] Fallback HTTP call to logs endpoint failed:`, fallbackError.message)
    }
  }
  
  if (isComplete) {
    console.log(`[Status Check] ✅ Sync ${id} is COMPLETE - status: ${status}, synced: ${syncLog.records_synced || 0}, failed: ${syncLog.records_failed || 0}`)
  } else {
    console.log(`[Status Check] ⏳ Sync ${id} is IN PROGRESS - status: ${status}, completed_at is ${syncLog.completed_at === null ? 'null' : syncLog.completed_at}`)
  }
  
  return NextResponse.json({
    id: syncLog.id,
    status,
    isComplete,
    recordsSynced: syncLog.records_synced || 0,
    recordsFailed: syncLog.records_failed || 0,
    duration: syncLog.duration_seconds,
    completedAt: syncLog.completed_at,
    errorMessage: syncLog.error_message,
    startedAt: syncLog.started_at
  })
}
