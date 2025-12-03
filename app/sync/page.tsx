'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { SyncLog } from '@/lib/types'
import { format } from 'date-fns'

export default function SyncPage() {
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<{ [key: string]: boolean }>({})

  useEffect(() => {
    fetchSyncLogs()
  }, [])

  const fetchSyncLogs = async () => {
    try {
      // Add cache-busting parameter
      const response = await fetch(`/api/sync/logs?t=${Date.now()}`, {
        cache: 'no-store'
      })
      const data = await response.json()
      console.log('Fetched sync logs:', data)
      const logs = data.logs || []
      setSyncLogs(logs)
      return logs
    } catch (error) {
      console.error('Error fetching sync logs:', error)
      return []
    } finally {
      setLoading(false)
    }
  }


  const getSyncIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" />
      case 'partial':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />
      default:
        return <RefreshCw className="w-5 h-5 text-gray-600" />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Data Synchronization</h1>
          <p className="text-gray-600">Monitor and trigger data syncs from external systems</p>
        </div>

        {/* Unified Sync Button */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Sync All Systems</h3>
              <p className="text-sm text-gray-600">Sync Azure Entra ID first, then NinjaOne. Any dependencies will be handled automatically.</p>
            </div>
          </div>
          <button
            onClick={async () => {
              if (syncing['all']) return
              
              setSyncing(prev => ({ ...prev, all: true }))
              
              try {
                // Start the sync (returns immediately with sync ID)
                const startResponse = await fetch('/api/sync/all', { method: 'POST' })
                
                if (!startResponse.ok) {
                  const error = await startResponse.json().catch(() => ({ error: 'Unknown error' }))
                  throw new Error(error.error || 'Failed to start sync')
                }
                
                const startResult = await startResponse.json()
                const syncId = startResult.syncId
                
                if (!syncId) {
                  throw new Error('No sync ID returned')
                }
                
                console.log(`Started sync with ID: ${syncId}`)
                
                // Poll for sync status until complete
                const pollInterval = 3000 // Poll every 3 seconds
                const maxAttempts = 2400 // Maximum 2 hours (2400 * 3 seconds)
                let attempts = 0
                
                const pollStatus = async (): Promise<any> => {
                  attempts++
                  
                  if (attempts > maxAttempts) {
                    throw new Error('Sync is taking longer than expected. Please check the sync history below.')
                  }
                  
                  try {
                    const statusResponse = await fetch(`/api/sync/status/${syncId}?t=${Date.now()}`, {
                      cache: 'no-store'
                    })
                    
                    if (!statusResponse.ok) {
                      // If status endpoint fails, wait and retry (might be transient)
                      await new Promise(resolve => setTimeout(resolve, pollInterval))
                      return pollStatus()
                    }
                    
                    const status = await statusResponse.json()
                    
                    console.log(`[Poll] Sync ${syncId} status: ${status.status}, isComplete: ${status.isComplete}, completedAt: ${status.completedAt || 'null'}`)
                    
                    // Check if sync is complete - use both isComplete flag and completedAt
                    if (status.isComplete || status.completedAt) {
                      console.log(`[Poll] ✅ Sync ${syncId} is complete! Status: ${status.status}, Synced: ${status.recordsSynced}, Failed: ${status.recordsFailed}`)
                      return status
                    }
                    
                    // Continue polling - sync is still in progress
                    await new Promise(resolve => setTimeout(resolve, pollInterval))
                    return pollStatus()
                  } catch (fetchError) {
                    // Network error - wait and retry
                    console.warn('Error polling status, retrying...', fetchError)
                    await new Promise(resolve => setTimeout(resolve, pollInterval))
                    return pollStatus()
                  }
                }
                
                // Wait for sync to complete
                const finalStatus = await pollStatus()
                
                const message = `Sync completed!\n\n` +
                  `Status: ${finalStatus.status}\n` +
                  `Synced: ${finalStatus.recordsSynced || 0} records\n` +
                  `Failed: ${finalStatus.recordsFailed || 0} records\n` +
                  (finalStatus.duration ? `Duration: ${finalStatus.duration}s\n` : '') +
                  (finalStatus.errorMessage ? `\nError: ${finalStatus.errorMessage}` : '')
                
                alert(message)
                
              } catch (error: any) {
                console.error('Error syncing all:', error)
                alert(`Sync failed: ${error.message || error}\n\nPlease check the sync history below for details.`)
              } finally {
                setSyncing(prev => ({ ...prev, all: false }))
                // Refresh logs to show latest status
                await fetchSyncLogs()
              }
            }}
            disabled={syncing['all']}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors font-medium text-lg"
          >
            {syncing['all'] ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Syncing All Systems...
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5" />
                Sync All Systems
              </>
            )}
          </button>
        </div>

        {/* Sync History */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Sync History</h2>
          
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : syncLogs.length === 0 ? (
            <p className="text-center text-gray-600 py-12">No sync history available</p>
          ) : (
            <div className="space-y-3">
              {syncLogs.map((log) => (
                <div key={log.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start flex-1">
                      <div className="mr-3 mt-0.5">
                        {getSyncIcon(log.status)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h4 className="font-semibold text-gray-900">
                            {log.sync_type.replace('-', ' ').toUpperCase()}
                          </h4>
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            log.status === 'success' ? 'bg-green-100 text-green-800' :
                            log.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {log.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                          <span>Synced: {log.records_synced}</span>
                          {log.records_failed > 0 && (
                            <span className="text-red-600">Failed: {log.records_failed}</span>
                          )}
                          {log.duration_seconds && (
                            <span>Duration: {log.duration_seconds}s</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {format(new Date(log.started_at), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

