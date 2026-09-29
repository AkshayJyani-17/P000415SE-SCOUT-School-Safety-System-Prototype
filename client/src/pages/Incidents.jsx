import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { archiveAPI, getIncidents, settingsAPI } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useSchools } from '../context/SchoolsContext'

const priorityColors = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
}

const statusColors = {
  triggered: 'bg-red-100 text-red-700',
  acknowledged: 'bg-blue-100 text-blue-700',
  'in-progress': 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
}

const typeIcons = {
  medical: '🏥',
  behaviour: '⚠️',
  fire: '🔥',
  lockdown: '🔒',
  weather: '⛈️',
  maintenance: '🛠️',
  general: '📢',
}

const ACTIVE_STATUSES = ['triggered', 'acknowledged', 'in-progress']
const DEFAULT_INCIDENT_ICON = '📢'

function exportToExcel(incidents, showSchool) {
  const headers = [
    'Title',
    'Type',
    'Priority',
    'Status',
    'Location',
    ...(showSchool ? ['School'] : []),
    'Triggered By',
    'Date / Time',
    'Acknowledged',
  ]

  const escape = value => {
    const text = String(value ?? '')
    return text.includes(',') || text.includes('"') || text.includes('\n')
      ? `"${text.replace(/"/g, '""')}"`
      : text
  }

  const rows = incidents.map(incident => [
    incident.title,
    incident.type,
    incident.priority,
    incident.status,
    incident.location,
    ...(showSchool ? [incident.schoolName || incident.schoolId] : []),
    incident.triggeredByName,
    incident.createdAt ? new Date(incident.createdAt).toLocaleString() : '',
    incident.acknowledgedBy?.length > 0 ? 'Yes' : 'No',
  ].map(escape))

  const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `incident-report-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function isWithinDateRange(incident, range) {
  if (range === 'all') return true

  const created = incident.createdAt ? new Date(incident.createdAt) : null
  if (!created || Number.isNaN(created.getTime())) return true

  const now = new Date()

  switch (range) {
    case 'today':
      return created.toDateString() === now.toDateString()
    case 'week':
      return created >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case 'month':
      return created >= new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    case 'year':
      return created >= new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    default:
      return true
  }
}

function isOverdue(incident, thresholdMinutes) {
  if (incident.status !== 'triggered' || !incident.createdAt) return false

  const created = new Date(incident.createdAt)
  if (Number.isNaN(created.getTime())) return false

  return Date.now() - created.getTime() > thresholdMinutes * 60 * 1000
}

function getElapsedMinutes(incident) {
  if (!incident.createdAt) return 0

  const created = new Date(incident.createdAt)
  if (Number.isNaN(created.getTime())) return 0

  return Math.floor((Date.now() - created.getTime()) / 60000)
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  const dayLabel = days === 1 ? 'day' : 'days'

  return remainingHours > 0 ? `${days} ${dayLabel} ${remainingHours} hr` : `${days} ${dayLabel}`
}

export default function Incidents() {
  const navigate = useNavigate()
  const { authLoading, isCompanyAdmin, isSchoolAdmin, userRole } = useAuth()
  const { schools } = useSchools()
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterSchool, setFilterSchool] = useState('all')
  const [filterDateRange, setFilterDateRange] = useState('all')
  const [search, setSearch] = useState('')
  const [overdueThresholdMinutes, setOverdueThresholdMinutes] = useState(15)
  const [archivedIncidents, setArchivedIncidents] = useState([])
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [archivedError, setArchivedError] = useState('')
  const [archivedLoaded, setArchivedLoaded] = useState(false)

  useEffect(() => {
    if (authLoading || userRole === null) return

    let isActive = true

    async function loadIncidents() {
      setLoading(true)
      setError('')

      try {
        const [records, settings] = await Promise.all([
          getIncidents(),
          settingsAPI.get().catch(() => ({ overdueThresholdMinutes: 15 })),
        ])

        if (isActive) {
          setIncidents(records)
          setOverdueThresholdMinutes(settings.overdueThresholdMinutes ?? 15)
        }
      } catch (err) {
        if (isActive) {
          setError(err.message || 'Failed to load incidents.')
        }
      } finally {
        if (isActive) {
          setLoading(false)
        }
      }
    }

    loadIncidents()

    return () => {
      isActive = false
    }
  }, [authLoading, userRole])

  useEffect(() => {
    if (filterStatus !== 'archived' || !isCompanyAdmin || archivedLoaded) return

    let isActive = true

    async function loadArchived() {
      setArchivedLoading(true)
      setArchivedError('')

      try {
        const records = await archiveAPI.list()
        if (isActive) {
          setArchivedIncidents(records)
          setArchivedLoaded(true)
        }
      } catch (err) {
        if (isActive) {
          setArchivedError(err.message || 'Failed to load archived incidents.')
        }
      } finally {
        if (isActive) {
          setArchivedLoading(false)
        }
      }
    }

    loadArchived()

    return () => {
      isActive = false
    }
  }, [archivedLoaded, filterStatus, isCompanyAdmin])

  const isArchivedView = filterStatus === 'archived' && isCompanyAdmin

  // Options come from the schools collection, not from the loaded incidents.
  // Deriving them from incidents meant a school with no incidents yet was
  // invisible in this filter which is exactly what a newly created school is.
  //
  // Incidents are still scanned, but only to recover schools that are no longer
  // in the list (deactivated, or deleted outside the app). Without that, their
  // historical incidents would be unfilterable.
  const schoolOptions = useMemo(() => {
    const options = new Map(schools.map(school => [school.id, school.name || school.id]))

    incidents.forEach(incident => {
      if (incident.schoolId && !options.has(incident.schoolId)) {
        options.set(incident.schoolId, incident.schoolName || incident.schoolId)
      }
    })

    return [...options.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [schools, incidents])

  // A school can vanish from the options while it is selected deactivated by
  // a Company Admin in another tab, for instance. Fall back to "All Schools"
  // rather than leaving the select showing a blank value and filtering to zero.
  useEffect(() => {
    if (filterSchool === 'all') return
    if (schoolOptions.some(option => option.id === filterSchool)) return

    setFilterSchool('all')
  }, [filterSchool, schoolOptions])

  const filtered = useMemo(() => {
    if (isArchivedView) return []

    return incidents.filter(incident => {
      const searchTerm = search.trim().toLowerCase()
      const searchableText = [
        incident.title,
        incident.location,
        incident.triggeredByName,
        incident.schoolName,
        incident.schoolId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const matchStatus =
        filterStatus === 'all'
          ? true
          : filterStatus === 'active'
            ? ACTIVE_STATUSES.includes(incident.status)
            : filterStatus === 'review-required'
              ? incident.reviewRequired === true
              : incident.status === filterStatus
      const matchPriority = filterPriority === 'all' || incident.priority === filterPriority
      const matchSchool = !isCompanyAdmin || filterSchool === 'all' || incident.schoolId === filterSchool
      const matchSearch = !searchTerm || searchableText.includes(searchTerm)
      const matchDateRange = isWithinDateRange(incident, filterDateRange)

      return matchStatus && matchPriority && matchSchool && matchSearch && matchDateRange
    })
  }, [filterDateRange, filterPriority, filterSchool, filterStatus, incidents, isArchivedView, isCompanyAdmin, search])

  const activeCount = useMemo(
    () => incidents.filter(incident => ACTIVE_STATUSES.includes(incident.status)).length,
    [incidents]
  )

  const subtitleText = isArchivedView
    ? archivedLoading
      ? 'Loading archived incidents...'
      : `${archivedIncidents.length} archived incident${archivedIncidents.length !== 1 ? 's' : ''}`
    : loading
      ? 'Loading incidents...'
      : filterStatus === 'active'
        ? `${activeCount} active incident${activeCount !== 1 ? 's' : ''}`
        : `${filtered.length} of ${incidents.length} incidents`

  if (authLoading || userRole === null) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-center py-12">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Incident Log</h1>
          <p className="text-sm text-gray-500">{subtitleText}</p>
          {isSchoolAdmin && !isCompanyAdmin && (
            <p className="text-xs text-gray-400 mt-1">
              Monitor and review incidents within your school, including status, response progress, and repeated patterns.
            </p>
          )}
          {!isSchoolAdmin && !isCompanyAdmin && (
            <p className="text-xs text-gray-400 mt-1">
              View alerts you created or incidents where you are involved.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {(isCompanyAdmin || isSchoolAdmin) && !isArchivedView && (
            <button
              onClick={() => exportToExcel(filtered, isCompanyAdmin)}
              disabled={filtered.length === 0}
              title="Export current filtered list to Excel"
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              ⬇️ Export
            </button>
          )}
          {!isCompanyAdmin && !isSchoolAdmin && (
            <button
              onClick={() => navigate('/submit')}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
            >
              ➕ Submit Alert
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search incidents..."
          value={search}
          onChange={event => setSearch(event.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 w-56"
        />
        <select
          value={filterStatus}
          onChange={event => setFilterStatus(event.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="active">Active Incidents</option>
          <option value="all">All Incidents</option>
          <option value="triggered">Triggered</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="in-progress">In Progress</option>
          <option value="resolved">Resolved</option>
          {(isCompanyAdmin || isSchoolAdmin) && <option value="review-required">Review Required</option>}
          {isCompanyAdmin && <option value="archived">Archived</option>}
        </select>
        <select
          value={filterPriority}
          onChange={event => setFilterPriority(event.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="all">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filterDateRange}
          onChange={event => setFilterDateRange(event.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
        </select>
        {isCompanyAdmin && (
          <select
            value={filterSchool}
            onChange={event => setFilterSchool(event.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="all">All Schools</option>
            {schoolOptions.map(school => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {isArchivedView ? (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {archivedLoading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading archived incidents...</div>
          ) : archivedError ? (
            <div className="p-8 text-center text-sm text-red-600">{archivedError}</div>
          ) : archivedIncidents.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No archived incidents yet.</div>
          ) : (
            archivedIncidents.map(incident => (
              <div
                key={incident.id}
                className="px-4 py-3 flex items-center gap-3 opacity-75"
              >
                <span className="text-lg">{typeIcons[incident.type] || DEFAULT_INCIDENT_ICON}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{incident.title}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {incident.location} · {incident.triggeredByName}
                    {incident.schoolName ? ` · ${incident.schoolName}` : ''}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${priorityColors[incident.priority]}`}>
                  {incident.priority}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                  archived
                </span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  Archived {incident.archivedAt ? new Date(incident.archivedAt).toLocaleDateString() : ''}
                </span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading incidents...</div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No incidents found.</div>
          ) : (
            filtered.map(incident => {
              const elapsedMinutes = getElapsedMinutes(incident)
              const overdue = isOverdue(incident, overdueThresholdMinutes)

              return (
                <div
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
                    overdue ? 'bg-amber-50 hover:bg-amber-100 border-l-4 border-l-amber-400' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="text-lg">{typeIcons[incident.type] || DEFAULT_INCIDENT_ICON}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {incident.incidentNumber ? `${incident.incidentNumber} · ` : ''}{incident.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {incident.location} · {incident.timestamp} · {incident.triggeredByName}
                      {isCompanyAdmin && incident.schoolName ? ` · ${incident.schoolName}` : ''}
                      {overdue ? ` · Unacknowledged for ${formatDuration(elapsedMinutes)}` : ''}
                    </p>
                  </div>
                  {incident.isTest && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-semibold whitespace-nowrap">
                      TEST
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded ${priorityColors[incident.priority]}`}>
                    {incident.priority}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${statusColors[incident.status]}`}>
                    {incident.status}
                  </span>
                  {overdue && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-medium whitespace-nowrap">
                      ⏰ Overdue
                    </span>
                  )}
                  {!overdue && incident.acknowledgedBy && incident.acknowledgedBy.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                      ✅ Responded
                    </span>
                  )}
                  {incident.reviewRequired && (
                    <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium whitespace-nowrap">
                      🚩 Review
                    </span>
                  )}
                  <span className="text-gray-400">&gt;</span>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
