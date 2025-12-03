'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users as UsersIcon, Loader2 } from 'lucide-react'
import EmployeeCard from '@/components/EmployeeCard'
import EmployeeFilters, { FilterState } from '@/components/EmployeeFilters'
import { Employee } from '@/lib/types'

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    status: '',
    department: '',
    office: ''
  })

  useEffect(() => {
    fetchEmployees()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [employees, filters])

  const fetchEmployees = async () => {
    try {
      setLoading(true)
      // Add cache-busting to ensure fresh data
      const response = await fetch(`/api/employees?t=${Date.now()}`, {
        cache: 'no-store'
      })
      const data = await response.json()
      console.log('Fetched employees:', data.employees?.length, 'employees')
      // Debug: log device counts for first few employees
      if (data.employees && data.employees.length > 0) {
        data.employees.slice(0, 5).forEach((emp: any) => {
          const deviceCount = emp.devices?.[0]?.count ?? 0
          console.log(`Employee ${emp.display_name || emp.email}: ${deviceCount} devices`)
        })
      }
      setEmployees(data.employees || [])
    } catch (error) {
      console.error('Error fetching employees:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
    let filtered = [...employees]

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      filtered = filtered.filter(emp => 
        emp.display_name?.toLowerCase().includes(searchLower) ||
        emp.email?.toLowerCase().includes(searchLower) ||
        emp.first_name?.toLowerCase().includes(searchLower) ||
        emp.last_name?.toLowerCase().includes(searchLower)
      )
    }

    // Status filter
    if (filters.status) {
      filtered = filtered.filter(emp => emp.employment_status === filters.status)
    }

    // Department filter
    if (filters.department) {
      const deptLower = filters.department.toLowerCase()
      filtered = filtered.filter(emp => 
        emp.department?.toLowerCase().includes(deptLower)
      )
    }

    // Office filter
    if (filters.office) {
      const officeLower = filters.office.toLowerCase()
      filtered = filtered.filter(emp => 
        emp.office_location?.toLowerCase().includes(officeLower)
      )
    }

    setFilteredEmployees(filtered)
  }

  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters)
  }, [])

  const stats = {
    total: employees.length,
    active: employees.filter(e => e.employment_status === 'active').length,
    terminated: employees.filter(e => e.employment_status === 'terminated').length,
    filtered: filteredEmployees.length
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">Employees</h1>
              <p className="text-gray-600">
                Manage and view all employees synced from Azure Entra ID
              </p>
            </div>
            <div className="flex items-center gap-2">
              <UsersIcon className="w-8 h-8 text-blue-600" />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="text-sm text-gray-600 mb-1">Total Employees</div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="text-sm text-gray-600 mb-1">Active</div>
            <div className="text-2xl font-bold text-green-600">{stats.active}</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="text-sm text-gray-600 mb-1">Terminated</div>
            <div className="text-2xl font-bold text-red-600">{stats.terminated}</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="text-sm text-gray-600 mb-1">Showing</div>
            <div className="text-2xl font-bold text-blue-600">{stats.filtered}</div>
          </div>
        </div>

        {/* Filters */}
        <EmployeeFilters onFilterChange={handleFilterChange} />

        {/* Employee Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <UsersIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No employees found
            </h3>
            <p className="text-gray-600">
              Try adjusting your filters or search criteria
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredEmployees.map((employee) => (
              <EmployeeCard key={employee.id} employee={employee} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

