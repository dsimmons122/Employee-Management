'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { 
  ArrowLeft, User, Mail, Phone, Briefcase, MapPin, Calendar, 
  Server, Key, Loader2, Monitor, Smartphone, Laptop,
  HardDrive, Home
} from 'lucide-react'
import { EmployeeWithRelations } from '@/lib/types'
import { format } from 'date-fns'

export default function EmployeeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [employee, setEmployee] = useState<EmployeeWithRelations | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'devices' | 'licenses'>('overview')

  useEffect(() => {
    if (params.id) {
      fetchEmployee(params.id as string)
    }
  }, [params.id])

  const fetchEmployee = async (id: string) => {
    try {
      setLoading(true)
      // Add cache-busting to ensure fresh data
      const response = await fetch(`/api/employees/${id}?t=${Date.now()}`, {
        cache: 'no-store'
      })
      const data = await response.json()
      console.log('Fetched employee detail:', data.employee?.display_name || data.employee?.email)
      console.log('Devices in response:', data.employee?.devices?.length || 0)
      if (data.employee?.devices && data.employee.devices.length > 0) {
        data.employee.devices.forEach((device: any, idx: number) => {
          console.log(`  Device ${idx + 1}: ${device.device_name} (id: ${device.id}, employee_id: ${device.employee_id})`)
        })
      }
      setEmployee(data.employee)
    } catch (error) {
      console.error('Error fetching employee:', error)
    } finally {
      setLoading(false)
    }
  }

  const getDeviceIcon = (deviceType: string) => {
    const type = deviceType?.toLowerCase() || ''
    if (type.includes('laptop')) return <Laptop className="w-5 h-5" />
    if (type.includes('phone') || type.includes('mobile')) return <Smartphone className="w-5 h-5" />
    if (type.includes('desktop')) return <Monitor className="w-5 h-5" />
    return <Server className="w-5 h-5" />
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <div className="container mx-auto px-4 py-8">
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Employee not found</h2>
            <Link href="/employees" className="text-blue-600 hover:text-blue-800">
              Back to Employees
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const statusColors = {
    active: 'bg-green-100 text-green-800 border-green-200',
    terminated: 'bg-red-100 text-red-800 border-red-200',
    on_leave: 'bg-yellow-100 text-yellow-800 border-yellow-200'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center text-blue-600 hover:text-blue-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </button>
          <Link
            href="/"
            className="inline-flex items-center text-gray-600 hover:text-gray-800 transition-colors"
          >
            <Home className="w-4 h-4 mr-2" />
            Home
          </Link>
        </div>

        {/* Profile Section */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-start">
              <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center">
                <User className="w-12 h-12 text-blue-600" />
              </div>
              <div className="ml-6">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  {employee.display_name || `${employee.first_name} ${employee.last_name}`}
                </h1>
                {employee.job_title && (
                  <p className="text-lg text-gray-600 mb-3">{employee.job_title}</p>
                )}
                <span className={`px-4 py-1 rounded-full text-sm font-semibold border ${statusColors[employee.employment_status]}`}>
                  {employee.employment_status}
                </span>
              </div>
            </div>
          </div>

          {/* Contact Info Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="flex items-center">
              <div className="bg-blue-100 rounded-lg p-3 mr-4">
                <Mail className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600">Email</div>
                <div className="font-medium text-gray-900">{employee.email}</div>
              </div>
            </div>

            {employee.phone_number && (
              <div className="flex items-center">
                <div className="bg-green-100 rounded-lg p-3 mr-4">
                  <Phone className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-600">Phone</div>
                  <div className="font-medium text-gray-900">{employee.phone_number}</div>
                </div>
              </div>
            )}

            {employee.department && (
              <div className="flex items-center">
                <div className="bg-purple-100 rounded-lg p-3 mr-4">
                  <Briefcase className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-600">Department</div>
                  <div className="font-medium text-gray-900">{employee.department}</div>
                </div>
              </div>
            )}

            {employee.office_location && (
              <div className="flex items-center">
                <div className="bg-orange-100 rounded-lg p-3 mr-4">
                  <MapPin className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-600">Office</div>
                  <div className="font-medium text-gray-900">{employee.office_location}</div>
                </div>
              </div>
            )}

            {employee.hire_date && (
              <div className="flex items-center">
                <div className="bg-cyan-100 rounded-lg p-3 mr-4">
                  <Calendar className="w-5 h-5 text-cyan-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-600">Hire Date</div>
                  <div className="font-medium text-gray-900">
                    {format(new Date(employee.hire_date), 'MMM d, yyyy')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600 mb-1">Devices</div>
                <div className="text-3xl font-bold text-gray-900">
                  {employee.devices?.length || 0}
                </div>
              </div>
              <div className="bg-blue-100 rounded-lg p-3">
                <Server className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600 mb-1">Licenses</div>
                <div className="text-3xl font-bold text-gray-900">
                  {employee.license_assignments?.length || 0}
                </div>
              </div>
              <div className="bg-orange-100 rounded-lg p-3">
                <Key className="w-8 h-8 text-orange-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'overview'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('devices')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'devices'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Devices ({employee.devices?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('licenses')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'licenses'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Licenses ({employee.license_assignments?.length || 0})
              </button>
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Summary</h3>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-sm text-gray-600 mb-2">Total Devices</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {employee.devices?.length || 0}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-sm text-gray-600 mb-2">Licenses</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {employee.license_assignments?.length || 0}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Devices Tab */}
            {activeTab === 'devices' && (
              <div className="space-y-8">
                {/* Current Devices */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Devices</h3>
                  {employee.devices && employee.devices.length > 0 ? (
                    <div className="space-y-3">
                      {employee.devices.map((device: any) => (
                        <Link 
                          key={device.id} 
                          href={`/devices/${device.id}`}
                          className="flex items-center border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all cursor-pointer hover:border-blue-500 hover:bg-blue-50"
                        >
                          <div className="bg-blue-100 rounded-lg p-2 mr-3">
                            {getDeviceIcon(device.device_type)}
                          </div>
                          <h4 className="font-semibold text-gray-900">{device.device_name}</h4>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-gray-50 rounded-lg">
                      <Server className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">No devices currently assigned to this employee</p>
                    </div>
                  )}
                </div>

                {/* Previous Devices */}
                {employee.previous_devices && employee.previous_devices.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Previous Devices</h3>
                    <div className="space-y-3">
                      {employee.previous_devices.map((device: any) => (
                        <Link 
                          key={device.id} 
                          href={`/devices/${device.id}`}
                          className="flex items-center justify-between border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all cursor-pointer hover:border-gray-400 hover:bg-gray-50 opacity-75"
                        >
                          <div className="flex items-center">
                            <div className="bg-gray-100 rounded-lg p-2 mr-3">
                              {getDeviceIcon(device.device_type)}
                            </div>
                            <div>
                              <h4 className="font-semibold text-gray-900">{device.device_name}</h4>
                              {device.unassignment_date && (
                                <p className="text-sm text-gray-500">
                                  Unassigned on {format(new Date(device.unassignment_date), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                          </div>
                          {device.assignment_date && (
                            <div className="text-sm text-gray-500 text-right">
                              <div>Assigned: {format(new Date(device.assignment_date), 'MMM d, yyyy')}</div>
                              {device.unassignment_date && (
                                <div>Unassigned: {format(new Date(device.unassignment_date), 'MMM d, yyyy')}</div>
                              )}
                            </div>
                          )}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Licenses Tab */}
            {activeTab === 'licenses' && (
              <div>
                {employee.license_assignments && employee.license_assignments.length > 0 ? (
                  <div className="space-y-4">
                    {employee.license_assignments.map((assignment: any) => (
                      <div key={assignment.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">{assignment.license.software_name}</h4>
                          {assignment.revoked_date ? (
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                              Revoked
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="grid md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">License Type:</span>
                            <span className="ml-2 font-medium text-gray-900">{assignment.license.license_type}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Assigned:</span>
                            <span className="ml-2 font-medium text-gray-900">
                              {format(new Date(assignment.assigned_date), 'MMM d, yyyy')}
                            </span>
                          </div>
                        </div>
                        {assignment.notes && (
                          <p className="text-sm text-gray-600 mt-2">{assignment.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Key className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No licenses assigned to this employee</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

