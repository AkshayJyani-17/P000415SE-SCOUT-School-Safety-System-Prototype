const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildAnalyticsFrom,
  formatTypeLabel,
  getAcknowledgementTime,
  getResolutionTime,
  isUnacknowledged,
} = require('../src/analyticsCache')

// Thursday 10 September 2026, 12:00 in Australia/Melbourne (the reporting zone).
const NOW = new Date('2026-09-10T02:00:00Z')

function incident(overrides = {}) {
  return {
    id: 'i1',
    type: 'medical',
    priority: 'high',
    status: 'triggered',
    location: 'Oval',
    schoolId: 'school_alpha',
    createdAt: '2026-09-10T02:00:00Z',
    ...overrides,
  }
}

function build(incidents, notifications = [], options = {}) {
  return buildAnalyticsFrom(incidents, notifications, { now: NOW, ...options })
}

test('counts totals, resolved and active incidents', () => {
  const result = build([
    incident({ id: '1', status: 'resolved' }),
    incident({ id: '2', status: 'triggered' }),
    incident({ id: '3', status: 'acknowledged' }),
    incident({ id: '4', status: 'archived' }),
  ])

  assert.equal(result.summary.totalIncidents, 4)
  assert.equal(result.summary.resolvedCount, 1)
  assert.equal(result.summary.activeIncidents, 2)
})

test('unacknowledged excludes resolved and archived incidents', () => {
  const acknowledged = incident({
    id: 'ack',
    acknowledgedBy: [{ acknowledgedAt: '2026-09-10T02:05:00Z' }],
  })

  const result = build([
    incident({ id: 'open' }),
    acknowledged,
    incident({ id: 'done', status: 'resolved' }),
    incident({ id: 'old', status: 'archived' }),
  ])

  assert.equal(result.summary.unacknowledgedCount, 1)
  assert.equal(isUnacknowledged(acknowledged), false)
})

test('average response time is the mean minutes to first acknowledgement', () => {
  const result = build([
    incident({
      id: '1',
      createdAt: '2026-09-10T02:00:00Z',
      acknowledgedBy: [{ acknowledgedAt: '2026-09-10T02:10:00Z' }],
    }),
    incident({
      id: '2',
      createdAt: '2026-09-10T02:00:00Z',
      acknowledgedBy: [{ acknowledgedAt: '2026-09-10T02:20:00Z' }],
    }),
    incident({ id: '3' }),
  ])

  assert.equal(result.summary.avgResponseTime, 15)
})

test('the earliest acknowledgement is the one that counts', () => {
  const time = getAcknowledgementTime(
    incident({
      createdAt: '2026-09-10T02:00:00Z',
      acknowledgedBy: [
        { acknowledgedAt: '2026-09-10T02:30:00Z' },
        { acknowledgedAt: '2026-09-10T02:05:00Z' },
      ],
    })
  )

  assert.equal(time, 5)
})

test('resolution time prefers resolvedAt and ignores unresolved incidents', () => {
  assert.equal(
    getResolutionTime(
      incident({
        status: 'resolved',
        createdAt: '2026-09-10T02:00:00Z',
        resolvedAt: '2026-09-10T03:00:00Z',
        updatedAt: '2026-09-10T09:00:00Z',
      })
    ),
    60
  )

  assert.equal(getResolutionTime(incident({ status: 'triggered' })), null)
})

test('incident type labels are humanised for the chart', () => {
  assert.equal(formatTypeLabel('medical'), 'Medical')
  assert.equal(formatTypeLabel('natural_disaster'), 'Natural Disaster')
  assert.equal(formatTypeLabel('lost-property'), 'Lost Property')
  assert.equal(formatTypeLabel(''), 'Unknown')
  assert.equal(formatTypeLabel(undefined), 'Unknown')
})

test('incidents by type are grouped and ordered by volume', () => {
  const result = build([
    incident({ id: '1', type: 'medical' }),
    incident({ id: '2', type: 'natural_disaster' }),
    incident({ id: '3', type: 'medical' }),
  ])

  assert.deepEqual(result.incidentsByType, [
    { type: 'Medical', count: 2 },
    { type: 'Natural Disaster', count: 1 },
  ])
})

test('status breakdown omits statuses with no incidents', () => {
  const result = build([
    incident({ id: '1', status: 'resolved' }),
    incident({ id: '2', status: 'triggered' }),
  ])

  const names = result.statusBreakdown.map(entry => entry.name)
  assert.deepEqual(names.sort(), ['Resolved', 'Triggered'])
  assert.ok(result.statusBreakdown.every(entry => entry.value > 0))
})

test('locations are grouped case-insensitively and keep their original spelling', () => {
  const result = build([
    incident({ id: '1', location: 'Oval' }),
    incident({ id: '2', location: 'oval' }),
    incident({ id: '3', location: '  ' }),
    incident({ id: '4', location: 'Library' }),
  ])

  assert.deepEqual(result.locationData, [
    { location: 'Oval', count: 2 },
    { location: 'Library', count: 1 },
    { location: 'Unknown', count: 1 },
  ])
})

test('priority breakdown always reports all four levels in severity order', () => {
  const result = build([
    incident({ id: '1', priority: 'critical' }),
    incident({ id: '2', priority: 'low' }),
    incident({ id: '3', priority: 'unknown-value' }),
  ])

  assert.deepEqual(result.incidentsByPriority, [
    { priority: 'Critical', count: 1 },
    { priority: 'High', count: 0 },
    { priority: 'Medium', count: 0 },
    { priority: 'Low', count: 1 },
  ])
})

test('this week counts the current Monday-to-Sunday week in the reporting zone', () => {
  const result = build([
    // Monday 7 September, inside the current week.
    incident({ id: 'mon', createdAt: '2026-09-06T23:00:00Z' }),
    // Thursday 10 September, today.
    incident({ id: 'today', createdAt: '2026-09-10T02:00:00Z' }),
    // Sunday 6 September, the previous week.
    incident({ id: 'last-week', createdAt: '2026-09-06T01:00:00Z' }),
  ])

  assert.equal(result.summary.thisWeekIncidents, 2)
})

test('incident timestamps are bucketed in the reporting zone, not UTC', () => {
  // 23:00 UTC on 9 September is 09:00 on Thursday 10 September in Melbourne.
  const result = build([incident({ id: 'edge', createdAt: '2026-09-09T23:00:00Z' })])

  const thursday = result.incidentsByDay.find(entry => entry.day === 'Thu')
  const wednesday = result.incidentsByDay.find(entry => entry.day === 'Wed')

  assert.equal(thursday.incidents, 1)
  assert.equal(wednesday.incidents, 0)
})

test('failed alerts are split by channel and only included when requested', () => {
  const notifications = [
    { sms: 'failed', email: 'sent' },
    { smsStatus: 'failed', emailStatus: 'failed' },
    { sms: 'sent', email: 'sent' },
  ]

  const withAlerts = build([incident()], notifications, { includeFailedAlerts: true })
  assert.deepEqual(withAlerts.failedAlerts, { total: 3, sms: 2, email: 1 })
  assert.equal(withAlerts.summary.failedAlerts, 3)

  const withoutAlerts = build([incident()], notifications)
  assert.equal(withoutAlerts.failedAlerts, undefined)
  assert.equal(withoutAlerts.summary.failedAlerts, undefined)
})

test('incidents with a missing or invalid createdAt do not break the build', () => {
  const result = build([
    incident({ id: 'no-date', createdAt: null }),
    incident({ id: 'bad-date', createdAt: 'not-a-date' }),
    incident({ id: 'ok' }),
  ])

  assert.equal(result.summary.totalIncidents, 3)
  assert.equal(result.summary.thisWeekIncidents, 1)
})

test('an empty dataset produces zeroed figures rather than throwing', () => {
  const result = build([], [], { includeFailedAlerts: true })

  assert.equal(result.summary.totalIncidents, 0)
  assert.equal(result.summary.avgResponseTime, 0)
  assert.deepEqual(result.incidentsByType, [])
  assert.deepEqual(result.statusBreakdown, [])
  assert.deepEqual(result.failedAlerts, { total: 0, sms: 0, email: 0 })
})
