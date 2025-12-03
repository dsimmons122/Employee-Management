'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Key, Loader2 } from 'lucide-react'
import { License } from '@/lib/types'
import { format } from 'date-fns'

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLicenses()
  }, [])

  const fetchLicenses = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/licenses')
      const data = await response.json()
      setLicenses(data.licenses || [])
    } catch (error) {
      console.error('Error fetching licenses:', error)
    } finally {
      setLoading(false)
    }
  }

  const getUsageColor = (used: number, total: number) => {
    if (!total) return 'bg-gray-200'
    const percentage = (used / total) * 100
    if (percentage >= 90) return 'bg-red-500'
    if (percentage >= 75) return 'bg-yellow-500'
    return 'bg-green-500'
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
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Software Licenses</h1>
          <p className="text-gray-600">Manage software licenses and track usage</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {licenses.map((license) => (
              <div key={license.id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-xl transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="bg-orange-100 rounded-lg p-3 mr-3">
                      <Key className="w-6 h-6 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{license.software_name}</h3>
                      <p className="text-sm text-gray-600">{license.license_type}</p>
                    </div>
                  </div>
                </div>

                {license.vendor && (
                  <p className="text-sm text-gray-600 mb-3">Vendor: {license.vendor}</p>
                )}

                {/* Seat Usage */}
                {license.total_seats && (
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Seat Usage</span>
                      <span className="font-medium text-gray-900">
                        {license.used_seats} / {license.total_seats}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${getUsageColor(license.used_seats, license.total_seats)}`}
                        style={{
                          width: `${Math.min((license.used_seats / license.total_seats) * 100, 100)}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Details */}
                <div className="space-y-2 text-sm">
                  {license.expiration_date && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Expires:</span>
                      <span className={`font-medium ${
                        new Date(license.expiration_date) < new Date()
                          ? 'text-red-600'
                          : 'text-gray-900'
                      }`}>
                        {format(new Date(license.expiration_date), 'MMM d, yyyy')}
                      </span>
                    </div>
                  )}
                  {license.cost && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Cost:</span>
                      <span className="font-medium text-gray-900">
                        ${license.cost.toFixed(2)}
                        {license.billing_frequency && ` / ${license.billing_frequency}`}
                      </span>
                    </div>
                  )}
                </div>

                {license.notes && (
                  <p className="text-xs text-gray-600 mt-4 pt-4 border-t border-gray-200">
                    {license.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}



