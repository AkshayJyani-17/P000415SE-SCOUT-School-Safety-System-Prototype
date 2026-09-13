import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSchools } from '../context/SchoolsContext'
import { analyticsAPI } from '../api/client'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const PIE_COLORS = ['#22c55e', '#3b82f6', '#ef4444', '#9ca3af', '#f97316']

const PRIORITY_COLORS = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#eab308',
  Low: '#22c55e',
}

const ALL_SCHOOLS = 'all'

const EMPTY_SUMMARY = {
  totalIncidents: 0,
  resolvedCount: 0,
  avgResponseTime: 0,
  unacknowledgedCount: 0,
  thisWeekIncidents: 0,
}

const TREND_RANGES = [
  { value: 'week', label: 'This Week', helper: 'Daily totals for the last 7 days' },
  { value: 'month', label: 'Last Month', helper: 'Weekly totals for the last 4 weeks' },
  { value: 'quarter', label: 'Last 3 Months', helper: 'Monthly totals for the last 3 months' },
  { value: 'year', label: 'Last Year', helper: 'Monthly totals for the last 12 months' },
  { value: 'all', label: 'All Time', helper: 'All incidents grouped by month' },
]

export default function Analytics() {
  const { isCompanyAdmin, isSchoolAdmin, userSchoolName, authLoading, userRole } = useAuth()
  const { schools } = useSchools()

  const canViewAnalytics = isCompanyAdmin || isSchoolAdmin

  const [schoolFilter, setSchoolFilter] = useState(ALL_SCHOOLS)
  const [trendsRange, setTrendsRange] = useState('week')

  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState(null)

  const [trends, setTrends] = useState(null)
  const [trendsLoading, setTrendsLoading] = useState(true)
  const [trendsError, setTrendsError] = useState(null)

  // Only a Company Admin can change scope; a School Admin is pinned to their
  // own school by the backend, so no filter is sent for them.
  const requestedSchoolId = isCompanyAdmin && schoolFilter !== ALL_SCHOOLS ? schoolFilter : null

  // Responses that are not from the newest request are discarded, so switching
  // schools quickly can never leave an older school's figures on screen.
  const analyticsSeq = useRef(0)
  const trendsSeq = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadAnalytics = useCallback(async () => {
    if (!canViewAnalytics) return

    const seq = analyticsSeq.current + 1
    analyticsSeq.current = seq

    setAnalyticsLoading(true)
    setAnalyticsError(null)

    try {
      const data = await analyticsAPI.all(requestedSchoolId)
      if (!mounted.current || seq !== analyticsSeq.current) return
      setAnalytics(data)
    } catch (err) {
      if (!mounted.current || seq !== analyticsSeq.current) return
      setAnalyticsError(err.message || 'Failed to load analytics data')
    } finally {
      if (mounted.current && seq === analyticsSeq.current) setAnalyticsLoading(false)
    }
  }, [canViewAnalytics, requestedSchoolId])

  const loadTrends = useCallback(async () => {
    if (!canViewAnalytics) return

    const seq = trendsSeq.current + 1
    trendsSeq.current = seq

    setTrendsLoading(true)
    setTrendsError(null)

    try {
      const data = await analyticsAPI.trends(trendsRange, requestedSchoolId)
      if (!mounted.current || seq !== trendsSeq.current) return
      setTrends(data)
    } catch (err) {
      if (!mounted.current || seq !== trendsSeq.current) return
      setTrendsError(err.message || 'Failed to load trend data')
    } finally {
      if (mounted.current && seq === trendsSeq.current) setTrendsLoading(false)
    }
  }, [canViewAnalytics, requestedSchoolId, trendsRange])

  // Both requests are issued independently so they run in parallel, and a
  // change of range refetches the trends alone rather than the whole page.
  useEffect(() => { loadAnalytics() }, [loadAnalytics])
  useEffect(() => { loadTrends() }, [loadTrends])

  const refresh = useCallback(() => {
    loadAnalytics()
    loadTrends()
  }, [loadAnalytics, loadTrends])

  const summary = analytics?.summary || EMPTY_SUMMARY
  const failedAlerts = analytics?.failedAlerts || { total: 0, sms: 0, email: 0 }
  const incidentsByType = analytics?.incidentsByType || []
  const statusBreakdown = analytics?.statusBreakdown || []
  const incidentsByPriority = analytics?.incidentsByPriority || []

  const topLocations = useMemo(() => getTopLocations(analytics?.locationData || []), [analytics])

  const scopeLabel = useMemo(() => {
    if (isSchoolAdmin) return userSchoolName || analytics?.scope?.schoolName || 'your school'
    if (schoolFilter === ALL_SCHOOLS) return null
    return schools.find(school => school.id === schoolFilter)?.name
      || analytics?.scope?.schoolName
      || 'the selected school'
  }, [isSchoolAdmin, userSchoolName, analytics, schoolFilter, schools])

  const rangeHelper = TREND_RANGES.find(range => range.value === trendsRange)?.helper

  if (authLoading || userRole === null) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-gray-500 text-center py-12">Loading...</p>
      </div>
    )
  }

  if (!canViewAnalytics) {
    return <Navigate to="/dashboard" replace />
  }

  // A failure with nothing cached is the only case that replaces the page;
  // a failed refresh keeps the previous figures on screen instead.
  if (analyticsError && !analytics) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium mb-1">Failed to load analytics data</p>
          <p className="text-red-500 text-sm mb-4">{analyticsError}</p>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (analyticsLoading && !analytics) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-gray-500 text-center py-12">Loading analytics...</p>
      </div>
    )
  }

  const busy = analyticsLoading || trendsLoading

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">Operational insights</p>
        </div>

        <div className="flex items-center gap-2">
          {busy && <span className="text-xs text-gray-400">Updating...</span>}

          {isCompanyAdmin && (
            <select
              value={schoolFilter}
              onChange={event => setSchoolFilter(event.target.value)}
              aria-label="Filter analytics by school"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value={ALL_SCHOOLS}>All schools</option>
              {schools.map(school => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          )}

          <button
            onClick={refresh}
            disabled={busy}
            className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {busy ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 mb-6 text-xs text-purple-800">
        {scopeLabel ? (
          <><strong>Scoped to {scopeLabel}</strong> — all figures below reflect this school only.</>
        ) : (
          <><strong>All schools</strong> — figures below cover every school in the system.</>
        )}
      </div>

      {analyticsError && analytics && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4 text-xs text-amber-800">
          Showing the last loaded figures — refresh failed: {analyticsError}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Total Incidents" value={formatCount(summary.totalIncidents)} color="text-gray-700" />
        <SummaryCard label="Resolved" value={formatCount(summary.resolvedCount)} color="text-green-600" />
        <SummaryCard label="This Week" value={formatCount(summary.thisWeekIncidents)} color="text-orange-600" />
        <SummaryCard label="Avg Response" value={formatMinutes(summary.avgResponseTime)} color="text-blue-600" />
        <SummaryCard
          label="Unacknowledged"
          value={formatCount(summary.unacknowledgedCount)}
          color={summary.unacknowledgedCount > 0 ? 'text-amber-600' : 'text-green-600'}
        />
        <SummaryCard
          label="Failed Alerts"
          value={formatCount(failedAlerts.total)}
          color={failedAlerts.total > 0 ? 'text-red-600' : 'text-green-600'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <ChartPanel title="Incidents by Type">
          {incidentsByType.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={incidentsByType} margin={{ top: 0, right: 0, left: -20, bottom: 40 }}>
                <XAxis dataKey="type" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={value => [value, 'Incidents']} />
                <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartPanel>

        <ChartPanel title="Status Breakdown">
          <div className="flex items-center justify-end mb-2">
            {summary.unacknowledgedCount > 0 ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                {summary.unacknowledgedCount} unacknowledged
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                All acknowledged
              </span>
            )}
          </div>
          {statusBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {statusBreakdown.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={value => [value, 'Incidents']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartPanel>
      </div>

      <ChartPanel title="Incidents by Location" className="mb-4">
        {topLocations.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={topLocations} dataKey="count" nameKey="location" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {topLocations.map((entry, index) => (
                  <Cell key={entry.location} fill={entry.location === 'Others' ? '#ec4899' : PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={value => [value, 'Incidents']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartPanel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartPanel title="Incidents by Priority" helper="Total incidents across all statuses grouped by severity">
          {incidentsByPriority.some(entry => entry.count > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart layout="vertical" data={incidentsByPriority} margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="priority" tick={{ fontSize: 12 }} width={65} />
                <Tooltip formatter={value => [value, 'Incidents']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={32}>
                  {incidentsByPriority.map(entry => (
                    <Cell key={entry.priority} fill={PRIORITY_COLORS[entry.priority] || '#9ca3af'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartPanel>

        <ChartPanel title="Failed Alerts">
          <div className="mb-4 flex justify-end">
            {failedAlerts.total > 0 ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                {failedAlerts.total} failed
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                No failures
              </span>
            )}
          </div>
          {failedAlerts.total > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={[{ name: 'Failures', sms: failedAlerts.sms, email: failedAlerts.email }]}
                margin={{ top: 0, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="sms" name="SMS Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="email" name="Email Failed" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-center py-8 text-sm">All notifications delivered successfully.</p>
          )}
        </ChartPanel>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Incident Trends</h2>
            <p className="text-xs text-gray-400">Identify patterns by time of day, day of week, and volume over time</p>
          </div>
          <div className="flex items-center gap-2">
            {trendsLoading && <span className="text-xs text-gray-400">Updating...</span>}
            <select
              value={trendsRange}
              onChange={event => setTrendsRange(event.target.value)}
              aria-label="Trend date range"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {TREND_RANGES.map(range => (
                <option key={range.value} value={range.value}>{range.label}</option>
              ))}
            </select>
          </div>
        </div>

        {trendsError && !trends ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center text-sm text-red-600">
            {trendsError}
          </div>
        ) : (
          <>
            <ChartPanel title="Incidents Over Time" helper={rangeHelper}>
              <TrendChart loading={trendsLoading} data={trends?.incidentsByPeriod}>
                <BarChart
                  data={trends?.incidentsByPeriod || []}
                  margin={{ top: 0, right: 10, left: -20, bottom: trendsRange === 'week' ? 40 : 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    angle={trendsRange === 'week' ? -35 : 0}
                    textAnchor={trendsRange === 'week' ? 'end' : 'middle'}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={value => [value, 'Incidents']} />
                  <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </TrendChart>
            </ChartPanel>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <ChartPanel title="Incidents by Day of Week" helper="Which days consistently see the most incidents">
                <TrendChart loading={trendsLoading} data={trends?.incidentsByDayOfWeek}>
                  <BarChart data={trends?.incidentsByDayOfWeek || []} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={value => [value, 'Incidents']} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </TrendChart>
              </ChartPanel>

              <ChartPanel title="Incidents by Hour of Day" helper="When during the day incidents are most likely to occur">
                <TrendChart loading={trendsLoading} data={trends?.incidentsByHour}>
                  <BarChart data={trends?.incidentsByHour || []} margin={{ top: 0, right: 10, left: -20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" interval={1} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={value => [value, 'Incidents']} />
                    <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </TrendChart>
              </ChartPanel>
            </div>

            {trends && (
              <p className="text-xs text-gray-400 text-right mt-2">
                {trends.totalInRange} incident{trends.totalInRange !== 1 ? 's' : ''} in selected range
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function getTopLocations(locationData) {
  const sorted = [...locationData].sort((a, b) => b.count - a.count)
  const top = sorted.slice(0, 5)
  const othersTotal = sorted.slice(5).reduce((sum, entry) => sum + entry.count, 0)
  return othersTotal > 0 ? [...top, { location: 'Others', count: othersTotal }] : top
}

function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString() : '0'
}

// An average of zero means nothing has been acknowledged yet, which is not the
// same as a zero-minute response, so it is shown as "no data" instead.
function formatMinutes(value) {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1) return '<1 min'
  if (value < 60) return `${Math.round(value)} min`
  const hours = value / 60
  return hours < 24 ? `${hours.toFixed(1)} hr` : `${(hours / 24).toFixed(1)} d`
}

// Keeps the previous chart visible while a new range or school is loading.
function TrendChart({ loading, data, children }) {
  if (!data) {
    return <div className="py-10 text-center text-sm text-gray-400">{loading ? 'Loading...' : 'No data'}</div>
  }

  if (data.length === 0) {
    return <EmptyChart />
  }

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <ResponsiveContainer width="100%" height={200}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function ChartPanel({ title, helper, className = '', children }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-5 ${className}`}>
      <h2 className="font-semibold text-gray-900 mb-1">{title}</h2>
      {helper && <p className="text-xs text-gray-400 mb-3">{helper}</p>}
      {children}
    </div>
  )
}

function EmptyChart() {
  return <p className="text-gray-400 text-center py-10">No data available</p>
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
