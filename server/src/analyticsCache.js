// analyticsCache.js - Analytics aggregation and in-memory cache for SCOUT.
//
// Incidents and notifications are loaded once and every view (system-wide or a
// single school, summary or trends) is derived from that one snapshot in
// memory. Switching the school filter therefore costs no Firestore reads.
//
// Freshness comes from two signals: explicit invalidation whenever an incident
// or notification changes, and a TTL that bounds how long a missed
// invalidation can serve stale data.

const { getDb } = require('./db/firebase')

// Schools are Australian, so a UTC server would otherwise report incidents
// under the wrong day and hour. Override per deployment if that changes.
const REPORTING_TIME_ZONE = process.env.ANALYTICS_TIME_ZONE || 'Australia/Melbourne'

const SOURCE_TTL_MS = 30 * 1000

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']

const STATUS_LABELS = {
  triggered: 'Triggered',
  acknowledged: 'Acknowledged',
  'in-progress': 'In Progress',
  resolved: 'Resolved',
  archived: 'Archived',
}

const VALID_RANGES = ['week', 'month', 'quarter', 'year', 'all']

// ── Time helpers ──────────────────────────────────────────────────────────────

const zonedFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORTING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

// Labels are rendered from civil dates held as UTC midnight, so they must be
// formatted in UTC to avoid shifting back across a day boundary.
const dayLabelFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
})
const shortDayLabelFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short',
})
const monthLabelFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', month: 'short', year: '2-digit',
})

function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') {
    const converted = value.toDate()
    return Number.isNaN(converted?.getTime?.()) ? null : converted
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function zonedParts(date) {
  const parts = {}
  for (const { type, value } of zonedFormatter.formatToParts(date)) {
    parts[type] = value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    weekday: parts.weekday,
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

// The calendar date in the reporting zone, carried as UTC midnight so that date
// arithmetic is free of daylight-saving jumps.
function civilDate(date) {
  const { year, month, day } = zonedParts(date)
  return new Date(Date.UTC(year, month - 1, day))
}

function dayKey(civil) {
  return civil.toISOString().slice(0, 10)
}

function monthKey(civil) {
  return `${civil.getUTCFullYear()}-${pad(civil.getUTCMonth() + 1)}`
}

function addDays(civil, days) {
  const next = new Date(civil)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMonths(civil, months) {
  return new Date(Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth() + months, 1))
}

// Monday-first start of the calendar week containing `civil`.
function startOfWeek(civil) {
  const weekday = civil.getUTCDay()
  return addDays(civil, weekday === 0 ? -6 : 1 - weekday)
}

// ── Incident metrics ──────────────────────────────────────────────────────────

function getAcknowledgementTime(incident) {
  const created = toDate(incident.createdAt)
  if (!created) return null

  const entries = Array.isArray(incident.acknowledgedBy) ? incident.acknowledgedBy : []
  const acknowledgedAt = entries
    .map(entry => toDate(entry?.acknowledgedAt))
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || toDate(incident.acknowledgedAt)

  if (!acknowledgedAt) return null
  const minutes = (acknowledgedAt - created) / 60000
  return minutes >= 0 ? minutes : null
}

function getResolutionTime(incident) {
  if (incident.status !== 'resolved') return null
  const created = toDate(incident.createdAt)
  const resolved = toDate(incident.resolvedAt) || toDate(incident.updatedAt)
  if (!created || !resolved) return null
  const minutes = (resolved - created) / 60000
  return minutes >= 0 ? minutes : null
}

function isUnacknowledged(incident) {
  const acknowledged = Array.isArray(incident.acknowledgedBy) && incident.acknowledgedBy.length > 0
  return !acknowledged && incident.status !== 'resolved' && incident.status !== 'archived'
}

function average(values) {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round((total / values.length) * 10) / 10
}

// Incident types are stored in the `snake_case` form used by the alert config;
// charts need the human label back.
function formatTypeLabel(type) {
  const raw = String(type || '').trim()
  if (!raw) return 'Unknown'
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function hasFailedSms(notification) {
  return notification.sms === 'failed' || notification.smsStatus === 'failed'
}

function hasFailedEmail(notification) {
  return notification.email === 'failed' || notification.emailStatus === 'failed'
}

function countBy(items, resolveKey) {
  const counts = new Map()
  for (const item of items) {
    const key = resolveKey(item)
    if (key === null || key === undefined) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

// ── Aggregation (pure) ────────────────────────────────────────────────────────

function buildAnalyticsFrom(incidents, notifications, { includeFailedAlerts = false, now = new Date() } = {}) {
  const today = civilDate(now)
  const weekStartKey = dayKey(startOfWeek(today))

  const resolvedCount = incidents.filter(incident => incident.status === 'resolved').length
  const activeIncidents = incidents.filter(
    incident => incident.status !== 'resolved' && incident.status !== 'archived'
  )

  const ackTimes = incidents.map(getAcknowledgementTime).filter(value => value !== null)
  const resolutionTimes = incidents.map(getResolutionTime).filter(value => value !== null)
  const avgAckTime = average(ackTimes)

  const dated = incidents
    .map(incident => ({ incident, date: toDate(incident.createdAt) }))
    .filter(entry => entry.date !== null)
    .map(entry => ({ ...entry, civil: civilDate(entry.date) }))

  const thisWeek = dated.filter(entry => dayKey(entry.civil) >= weekStartKey)

  const typeCounts = countBy(incidents, incident => formatTypeLabel(incident.type))
  const incidentsByType = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))

  const statusCounts = countBy(incidents, incident => STATUS_LABELS[incident.status] || 'Unknown')
  const statusBreakdown = [...statusCounts.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter(entry => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))

  const locationCounts = new Map()
  for (const incident of incidents) {
    const display = String(incident.location || '').trim() || 'Unknown'
    const key = display.toLowerCase()
    const existing = locationCounts.get(key)
    if (existing) existing.count += 1
    else locationCounts.set(key, { location: display, count: 1 })
  }
  const locationData = [...locationCounts.values()].sort(
    (a, b) => b.count - a.count || a.location.localeCompare(b.location)
  )

  const dayCounts = new Map(DAY_NAMES.map(day => [day, 0]))
  for (const entry of thisWeek) {
    const weekday = zonedParts(entry.date).weekday
    if (dayCounts.has(weekday)) dayCounts.set(weekday, dayCounts.get(weekday) + 1)
  }
  const incidentsByDay = DAY_NAMES.map(day => ({ day, incidents: dayCounts.get(day) }))

  const priorityCounts = new Map(PRIORITY_ORDER.map(priority => [priority, 0]))
  for (const incident of incidents) {
    const priority = String(incident.priority || '').toLowerCase()
    if (priorityCounts.has(priority)) priorityCounts.set(priority, priorityCounts.get(priority) + 1)
  }
  const incidentsByPriority = PRIORITY_ORDER.map(priority => ({
    priority: priority.charAt(0).toUpperCase() + priority.slice(1),
    count: priorityCounts.get(priority),
  }))

  const responseTimeData = buildResponseTimeSeries(dated, today)

  let failedAlerts = null
  if (includeFailedAlerts) {
    const sms = notifications.filter(hasFailedSms).length
    const email = notifications.filter(hasFailedEmail).length
    failedAlerts = { total: sms + email, sms, email }
  }

  return {
    summary: {
      totalIncidents: incidents.length,
      resolvedCount,
      activeIncidents: activeIncidents.length,
      criticalCount: activeIncidents.filter(incident => incident.priority === 'critical').length,
      highCount: activeIncidents.filter(incident => incident.priority === 'high').length,
      unacknowledgedCount: incidents.filter(isUnacknowledged).length,
      avgResponseTime: avgAckTime,
      avgAckTime,
      avgResolutionTime: average(resolutionTimes),
      thisWeekIncidents: thisWeek.length,
      ...(failedAlerts ? { failedAlerts: failedAlerts.total } : {}),
    },
    incidentsByType,
    statusBreakdown,
    locationData,
    incidentsByDay,
    responseTimeData,
    incidentsByPriority,
    ...(failedAlerts ? { failedAlerts } : {}),
  }
}

// Four rolling 7-day windows, oldest first, ending today.
function buildResponseTimeSeries(dated, today) {
  const windows = []
  for (let index = 3; index >= 0; index -= 1) {
    const end = addDays(today, -index * 7)
    const start = addDays(end, -6)
    windows.push({ startKey: dayKey(start), endKey: dayKey(end), ack: [], resolution: [] })
  }

  for (const entry of dated) {
    const key = dayKey(entry.civil)
    const window = windows.find(candidate => key >= candidate.startKey && key <= candidate.endKey)
    if (!window) continue

    const ackTime = getAcknowledgementTime(entry.incident)
    const resolutionTime = getResolutionTime(entry.incident)
    if (ackTime !== null) window.ack.push(ackTime)
    if (resolutionTime !== null) window.resolution.push(resolutionTime)
  }

  return windows.map((window, index) => ({
    week: `Week ${index + 1}`,
    avgAckMinutes: average(window.ack),
    avgResolutionMinutes: average(window.resolution),
  }))
}

// Buckets and the range filter are derived from one definition, so the chart
// always sums to `totalInRange`.
function buildPeriodBuckets(range, today, dated) {
  if (range === 'week') {
    const buckets = []
    for (let index = 6; index >= 0; index -= 1) {
      const civil = addDays(today, -index)
      buckets.push({ label: dayLabelFormatter.format(civil), keys: [dayKey(civil)], count: 0 })
    }
    return buckets
  }

  if (range === 'month') {
    const buckets = []
    for (let index = 3; index >= 0; index -= 1) {
      const end = addDays(today, -index * 7)
      const start = addDays(end, -6)
      const keys = []
      for (let offset = 0; offset < 7; offset += 1) keys.push(dayKey(addDays(start, offset)))
      buckets.push({ label: shortDayLabelFormatter.format(start), keys, count: 0 })
    }
    return buckets
  }

  if (range === 'quarter' || range === 'year') {
    const span = range === 'quarter' ? 3 : 12
    const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const buckets = []
    for (let index = span - 1; index >= 0; index -= 1) {
      const civil = addMonths(firstOfThisMonth, -index)
      buckets.push({ label: monthLabelFormatter.format(civil), keys: [monthKey(civil)], count: 0, monthly: true })
    }
    return buckets
  }

  const months = new Map()
  for (const entry of dated) {
    const key = monthKey(entry.civil)
    if (!months.has(key)) {
      months.set(key, {
        label: monthLabelFormatter.format(new Date(Date.UTC(entry.civil.getUTCFullYear(), entry.civil.getUTCMonth(), 1))),
        keys: [key],
        count: 0,
        monthly: true,
      })
    }
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => bucket)
}

function buildTrendsFrom(incidents, { range = 'week', now = new Date() } = {}) {
  const today = civilDate(now)

  const dated = incidents
    .map(incident => toDate(incident.createdAt))
    .filter(Boolean)
    .map(date => ({ date, civil: civilDate(date) }))

  const buckets = buildPeriodBuckets(range, today, dated)

  const bucketByKey = new Map()
  buckets.forEach((bucket, index) => {
    for (const key of bucket.keys) bucketByKey.set(key, index)
  })

  const inRange = []
  for (const entry of dated) {
    const dayIndex = bucketByKey.get(dayKey(entry.civil))
    const monthIndex = bucketByKey.get(monthKey(entry.civil))
    const index = dayIndex !== undefined ? dayIndex : monthIndex
    if (index === undefined) continue
    buckets[index].count += 1
    inRange.push(entry)
  }

  const dowCounts = new Map(DAY_NAMES.map(day => [day, 0]))
  const hourCounts = new Array(24).fill(0)
  for (const entry of inRange) {
    const { weekday, hour } = zonedParts(entry.date)
    if (dowCounts.has(weekday)) dowCounts.set(weekday, dowCounts.get(weekday) + 1)
    hourCounts[hour] += 1
  }

  return {
    incidentsByDayOfWeek: DAY_NAMES.map(day => ({ day, count: dowCounts.get(day) })),
    incidentsByHour: hourCounts.map((count, hour) => ({ hour: `${pad(hour)}:00`, count })),
    incidentsByPeriod: buckets.map(({ label, count }) => ({ label, count })),
    totalInRange: inRange.length,
  }
}

// ── Source snapshots ──────────────────────────────────────────────────────────

const sources = {
  incidents: { data: null, loadedAt: 0, inFlight: null },
  notifications: { data: null, loadedAt: 0, inFlight: null },
}

let derivedCache = new Map()

function loadSource(name) {
  const source = sources[name]
  const isFresh = source.data !== null && Date.now() - source.loadedAt < SOURCE_TTL_MS

  if (isFresh) return Promise.resolve(source.data)
  if (source.inFlight) return source.inFlight

  source.inFlight = getDb()
    .collection(name)
    .get()
    .then(snapshot => {
      source.data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      source.loadedAt = Date.now()
      return source.data
    })
    .finally(() => {
      source.inFlight = null
    })

  return source.inFlight
}

// Test alerts from the Alert Testing page must not distort a school's real statistics.
function excludeTestIncidents(incidents) {
  return incidents.filter(incident => incident.isTest !== true)
}

function scopeToSchool(records, schoolId) {
  return schoolId ? records.filter(record => record.schoolId === schoolId) : records
}

// The stamp changes whenever a snapshot is reloaded or invalidated, which
// expires every derived entry built from it without tracking them individually.
function sourceStamp(includeNotifications) {
  return includeNotifications
    ? `${sources.incidents.loadedAt}:${sources.notifications.loadedAt}`
    : `${sources.incidents.loadedAt}`
}

function readDerived(key, stamp) {
  const entry = derivedCache.get(key)
  return entry && entry.stamp === stamp ? entry.data : null
}

function writeDerived(key, stamp, data) {
  derivedCache.set(key, { stamp, data })
  return data
}

// ── Public API ────────────────────────────────────────────────────────────────

async function getAnalytics(options = {}) {
  const schoolId = options.schoolId || null
  const includeFailedAlerts = Boolean(options.includeFailedAlerts)

  const [incidents, notifications] = await Promise.all([
    loadSource('incidents'),
    includeFailedAlerts ? loadSource('notifications') : Promise.resolve([]),
  ])

  const stamp = sourceStamp(includeFailedAlerts)
  const key = `analytics:${schoolId}:${includeFailedAlerts}`

  const cached = readDerived(key, stamp)
  if (cached) return cached

  const data = buildAnalyticsFrom(
    scopeToSchool(excludeTestIncidents(incidents), schoolId),
    scopeToSchool(notifications, schoolId),
    { includeFailedAlerts }
  )

  return writeDerived(key, stamp, data)
}

async function getTrends(options = {}) {
  const schoolId = options.schoolId || null
  const range = VALID_RANGES.includes(options.range) ? options.range : 'week'

  const incidents = await loadSource('incidents')

  const stamp = sourceStamp(false)
  const key = `trends:${schoolId}:${range}`

  const cached = readDerived(key, stamp)
  if (cached) return cached

  const data = buildTrendsFrom(scopeToSchool(excludeTestIncidents(incidents), schoolId), { range })
  return writeDerived(key, stamp, data)
}

function invalidateAnalyticsCache() {
  for (const source of Object.values(sources)) {
    source.data = null
    source.loadedAt = 0
  }
  derivedCache.clear()
}

module.exports = {
  getAnalytics,
  excludeTestIncidents,
  getTrends,
  invalidateAnalyticsCache,
  buildAnalyticsFrom,
  buildTrendsFrom,
  formatTypeLabel,
  getAcknowledgementTime,
  getResolutionTime,
  isUnacknowledged,
  REPORTING_TIME_ZONE,
  VALID_RANGES,
}
