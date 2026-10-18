import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { notificationsAPI } from '../api/client'

const statusStyle = {
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
  skipped: 'bg-gray-100 text-gray-600',
}

export default function Notifications() {
  const { isCompanyAdmin, isSchoolAdmin, authLoading, userRole } = useAuth()
  const [filterChannel, setFilterChannel] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSchool, setFilterSchool] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const canViewNotifications = isCompanyAdmin || isSchoolAdmin

  const fetchNotifications = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await notificationsAPI.list()
      setNotifications(data)
    } catch (err) {
      setError(err.message || 'Failed to fetch notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canViewNotifications) return
    fetchNotifications()
  }, [canViewNotifications])

  if (authLoading || userRole === null) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-gray-500 text-center py-10">Loading notifications...</p>
      </div>
    )
  }

  if (!canViewNotifications) {
    return <Navigate to="/dashboard" replace />
  }

  const visibleNotifications = notifications
  const totalSent = visibleNotifications.filter(n => n.sms === 'sent' || n.email === 'sent').length
  const totalFailed = visibleNotifications.filter(n => n.sms === 'failed' || n.email === 'failed').length
  const smsFailed = visibleNotifications.filter(n => n.sms === 'failed').length
  const emailFailed = visibleNotifications.filter(n => n.email === 'failed').length

  const schoolKey = n => n.schoolId ? `id:${n.schoolId}` : n.schoolName ? `name:${n.schoolName}` : 'unknown'
  const schools = [...new Map(visibleNotifications.map(n => [schoolKey(n), n.schoolName || n.schoolId || 'Unknown school'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const typeKey = n => String(n.type || '').trim().toLowerCase() || 'unknown'
  const types = [...new Set(visibleNotifications.map(typeKey))].sort()
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo)
  const activeFilters = [
    isCompanyAdmin && filterSchool !== 'all' && `School: ${schools.find(([id]) => id === filterSchool)?.[1] || filterSchool}`,
    filterType !== 'all' && `Type: ${filterType}`,
    filterChannel !== 'all' && `Channel: ${filterChannel.toUpperCase()}`,
    filterStatus !== 'all' && `Status: ${filterStatus}`,
    dateFrom && `From: ${dateFrom}`,
    dateTo && `To: ${dateTo}`,
  ].filter(Boolean)

  const filtered = visibleNotifications.filter(n => {
    if (invalidDateRange) return false
    if (isCompanyAdmin && filterSchool !== 'all' && schoolKey(n) !== filterSchool) return false
    if (filterType !== 'all' && typeKey(n) !== filterType) return false
    if (dateFrom || dateTo) {
      const date = n.timestamp ? new Date(n.timestamp) : null
      if (!date || Number.isNaN(date.getTime())) return false
      // Match the Sydney calendar date used by the delivery log, including both endpoints.
      const parts = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date)
      const part = name => parts.find(p => p.type === name).value
      const day = `${part('year')}-${part('month')}-${part('day')}`
      if ((dateFrom && day < dateFrom) || (dateTo && day > dateTo)) return false
    }
    if (filterChannel === 'sms') return filterStatus === 'all' || n.sms === filterStatus
    if (filterChannel === 'email') return filterStatus === 'all' || n.email === filterStatus
    if (filterStatus === 'all') return true
    return n.sms === filterStatus || n.email === filterStatus
  })

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-gray-500 text-center py-10">Loading notifications...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500">
            {isCompanyAdmin
              ? 'Track and verify SMS and email delivery across all schools.'
              : 'Track and verify which SMS and email messages were sent within your school.'}
          </p>
        </div>
        <button
          onClick={fetchNotifications}
          disabled={loading}
          className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Total Sent" value={totalSent} icon="📥" color="text-green-600" />
        <SummaryCard label="Failed" value={totalFailed} icon="❌" color="text-red-600" />
        <SummaryCard label="SMS Failed" value={smsFailed} icon="📱" color="text-orange-600" />
        <SummaryCard label="Email Failed" value={emailFailed} icon="📧" color="text-orange-600" />
      </div>

      {totalFailed > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm text-red-800">
            <strong>{totalFailed} notification(s)</strong> failed to deliver. Check the log below and follow up manually if needed.
          </p>
        </div>
      )}

      <div className="flex gap-3 mb-4 flex-wrap items-end">
        {isCompanyAdmin && (
          <label className="text-sm text-gray-600 flex flex-col gap-1">
            School
            <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm max-w-full">
              <option value="all">All Schools</option>
              {schools.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm text-gray-600 flex flex-col gap-1">
          Notification type
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="all">All Types</option>
            {types.map(type => <option key={type} value={type}>{type === 'unknown' ? 'Unknown type' : type}</option>)}
          </select>
        </label>
        <select
          aria-label="Channel"
          value={filterChannel}
          onChange={e => setFilterChannel(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="all">All Channels</option>
          <option value="sms">SMS Only</option>
          <option value="email">Email Only</option>
        </select>
        <select
          aria-label="Status"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="all">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="skipped">Skipped</option>
        </select>
        <label className="text-sm text-gray-600 flex flex-col gap-1">
          From date (Sydney)
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-invalid={invalidDateRange} aria-describedby={invalidDateRange ? 'notification-date-error' : undefined} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </label>
        <label className="text-sm text-gray-600 flex flex-col gap-1">
          To date (Sydney)
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-invalid={invalidDateRange} aria-describedby={invalidDateRange ? 'notification-date-error' : undefined} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </label>
        <button onClick={() => {
          setFilterSchool('all')
          setFilterType('all')
          setFilterChannel('all')
          setFilterStatus('all')
          setDateFrom('')
          setDateTo('')
        }} disabled={activeFilters.length === 0} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
          Clear All Filters
        </button>
      </div>
      {invalidDateRange && <p id="notification-date-error" role="alert" className="text-sm text-red-700 mb-4">From date must be on or before To date.</p>}
      <div role="status" className="flex flex-wrap gap-2 text-xs text-gray-600 mb-4">
        {activeFilters.length ? <>
          <span>Active filters:</span>
          {activeFilters.map(filter => <span key={filter} className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{filter}</span>)}
        </> : <span>No active filters</span>}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Delivery Log - {filtered.length} records
          </p>
          {isSchoolAdmin && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
              School view only
            </span>
          )}
        </div>
        <div className="divide-y divide-gray-100">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No notifications match your filters.
            </div>
          ) : (
            filtered.map(n => (
              <div key={n.id} className="px-4 py-4 flex items-start gap-4">
                <span className="mt-0.5 text-lg">{getTypeIcon(n.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{n.incidentTitle}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    👤 {n.recipientName} · 📧 {n.recipientEmail}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    🕐 {formatTimestamp(n.timestamp)}
                    {n.schoolName ? ` - ${n.schoolName}` : ''}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0 items-end">
                  <StatusBadge label="SMS" status={n.sms} />
                  <StatusBadge label="Email" status={n.email} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function getTypeIcon(type) {
  const icons = {
    medical: '🚑',
    behaviour: '⚠️',
    fire: '🔥',
    lockdown: '🔒',
    weather: '🌊',
    maintenance: '🛠️',
    general: '🔔',
    'natural disaster': '🌊',
    naturaldisaster: '🌊',
  }
  return icons[String(type || '').toLowerCase().replace(/\s/g, '')] ||
    icons[String(type || '').toLowerCase()] ||
    '🔔'
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown time'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function StatusBadge({ label, status = 'pending' }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${statusStyle[status] || statusStyle.pending}`}>
      {label === 'SMS' ? '📱' : '📧'} {label} {status}
    </span>
  )
}

function SummaryCard({ label, value, icon, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="mb-2 text-sm">{icon}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}
