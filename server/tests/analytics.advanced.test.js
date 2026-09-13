const test = require('node:test')
const assert = require('node:assert/strict')

// ── In-memory Firestore double ────────────────────────────────────────────────

let stores = {}
let readCounts = {}

function makeSnapshot(name) {
  readCounts[name] = (readCounts[name] || 0) + 1
  const rows = stores[name] || []
  return { docs: rows.map(({ id, ...data }) => ({ id, data: () => ({ ...data }) })) }
}

const fakeDb = {
  collection(name) {
    return { async get() { return makeSnapshot(name) } }
  },
}

const firebasePath = require.resolve('../src/db/firebase')

require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: {
    getDb: () => fakeDb,
    docToObject: doc => (doc && doc.exists ? { id: doc.id, ...doc.data() } : null),
    snapshotToArray: snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    formatTimestamp: () => '',
  },
}

const cachePath = require.resolve('../src/analyticsCache')
delete require.cache[cachePath]

const {
  buildTrendsFrom,
  getAnalytics,
  getTrends,
  invalidateAnalyticsCache,
} = require(cachePath)

// Thursday 10 September 2026, 12:00 in Australia/Melbourne.
const NOW = new Date('2026-09-10T02:00:00Z')

function seed({ incidents = [], notifications = [] } = {}) {
  stores = { incidents, notifications }
  readCounts = {}
  invalidateAnalyticsCache()
}

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

function trends(incidents, range) {
  return buildTrendsFrom(incidents, { range, now: NOW })
}

function sumOf(buckets) {
  return buckets.reduce((total, bucket) => total + bucket.count, 0)
}

// ── Timeline buckets ──────────────────────────────────────────────────────────

test('the week view shows seven daily buckets ending today', () => {
  const result = trends([incident()], 'week')

  assert.equal(result.incidentsByPeriod.length, 7)
  assert.equal(result.incidentsByPeriod.at(-1).label, 'Thu 10 Sept')
  assert.equal(result.incidentsByPeriod.at(0).label, 'Fri 4 Sept')
})

test("today's incidents appear in the week view", () => {
  const result = trends([incident({ createdAt: '2026-09-10T02:00:00Z' })], 'week')

  assert.equal(result.incidentsByPeriod.at(-1).count, 1)
  assert.equal(result.totalInRange, 1)
})

test("today's incidents appear in the month view", () => {
  const result = trends([incident({ createdAt: '2026-09-10T02:00:00Z' })], 'month')

  assert.equal(result.incidentsByPeriod.length, 4)
  assert.equal(result.incidentsByPeriod.at(-1).count, 1)
  assert.equal(result.totalInRange, 1)
})

test('the quarter view shows three monthly buckets and the year view twelve', () => {
  assert.equal(trends([], 'quarter').incidentsByPeriod.length, 3)
  assert.equal(trends([], 'year').incidentsByPeriod.length, 12)
  assert.equal(trends([], 'quarter').incidentsByPeriod.at(-1).label, 'Sept 26')
})

test('the all-time view groups by month in ascending order', () => {
  const result = trends(
    [
      incident({ id: '1', createdAt: '2026-09-10T02:00:00Z' }),
      incident({ id: '2', createdAt: '2025-01-15T02:00:00Z' }),
      incident({ id: '3', createdAt: '2026-09-01T02:00:00Z' }),
    ],
    'all'
  )

  assert.deepEqual(result.incidentsByPeriod.map(bucket => bucket.label), ['Jan 25', 'Sept 26'])
  assert.deepEqual(result.incidentsByPeriod.map(bucket => bucket.count), [1, 2])
  assert.equal(result.totalInRange, 3)
})

test('the chart always sums to the reported total for every range', () => {
  const incidents = [
    incident({ id: 'today', createdAt: '2026-09-10T02:00:00Z' }),
    incident({ id: 'this-week', createdAt: '2026-09-07T02:00:00Z' }),
    incident({ id: 'three-weeks', createdAt: '2026-08-22T02:00:00Z' }),
    incident({ id: 'two-months', createdAt: '2026-07-12T02:00:00Z' }),
    incident({ id: 'six-months', createdAt: '2026-03-12T02:00:00Z' }),
    incident({ id: 'two-years', createdAt: '2024-03-12T02:00:00Z' }),
  ]

  for (const range of ['week', 'month', 'quarter', 'year', 'all']) {
    const result = trends(incidents, range)
    assert.equal(
      sumOf(result.incidentsByPeriod),
      result.totalInRange,
      `chart total mismatch for range "${range}"`
    )
  }
})

test('incidents outside the selected range are excluded from every breakdown', () => {
  const result = trends(
    [
      incident({ id: 'in', createdAt: '2026-09-10T02:00:00Z' }),
      incident({ id: 'out', createdAt: '2026-01-10T02:00:00Z' }),
    ],
    'week'
  )

  assert.equal(result.totalInRange, 1)
  assert.equal(sumOf(result.incidentsByDayOfWeek), 1)
  assert.equal(sumOf(result.incidentsByHour), 1)
})

test('hour of day is reported in the reporting zone, not UTC', () => {
  // 23:00 UTC on 9 September is 09:00 on 10 September in Melbourne.
  const result = trends([incident({ createdAt: '2026-09-09T23:00:00Z' })], 'week')

  const nineAm = result.incidentsByHour.find(entry => entry.hour === '09:00')
  const elevenPm = result.incidentsByHour.find(entry => entry.hour === '23:00')

  assert.equal(nineAm.count, 1)
  assert.equal(elevenPm.count, 0)
  assert.equal(result.incidentsByHour.length, 24)
})

test('day of week always lists Monday to Sunday', () => {
  const result = trends([], 'week')

  assert.deepEqual(
    result.incidentsByDayOfWeek.map(entry => entry.day),
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  )
})

// ── School scoping ────────────────────────────────────────────────────────────

test('omitting a school id aggregates every school', async () => {
  seed({
    incidents: [
      incident({ id: 'a', schoolId: 'school_alpha' }),
      incident({ id: 'b', schoolId: 'school_beta' }),
    ],
  })

  const result = await getAnalytics({})

  assert.equal(result.summary.totalIncidents, 2)
})

test('a school id restricts the figures to that school only', async () => {
  seed({
    incidents: [
      incident({ id: 'a', schoolId: 'school_alpha', location: 'Oval' }),
      incident({ id: 'b', schoolId: 'school_beta', location: 'Library' }),
      incident({ id: 'c', schoolId: 'school_beta', location: 'Library' }),
    ],
  })

  const alpha = await getAnalytics({ schoolId: 'school_alpha' })
  const beta = await getAnalytics({ schoolId: 'school_beta' })

  assert.equal(alpha.summary.totalIncidents, 1)
  assert.equal(beta.summary.totalIncidents, 2)
  assert.deepEqual(alpha.locationData, [{ location: 'Oval', count: 1 }])
  assert.deepEqual(beta.locationData, [{ location: 'Library', count: 2 }])
})

test('failed alerts are scoped to the same school as the incidents', async () => {
  seed({
    incidents: [incident({ id: 'a', schoolId: 'school_alpha' })],
    notifications: [
      { id: 'n1', schoolId: 'school_alpha', sms: 'failed' },
      { id: 'n2', schoolId: 'school_beta', sms: 'failed' },
      { id: 'n3', schoolId: 'school_beta', email: 'failed' },
    ],
  })

  const alpha = await getAnalytics({ schoolId: 'school_alpha', includeFailedAlerts: true })
  const everySchool = await getAnalytics({ includeFailedAlerts: true })

  assert.deepEqual(alpha.failedAlerts, { total: 1, sms: 1, email: 0 })
  assert.deepEqual(everySchool.failedAlerts, { total: 3, sms: 2, email: 1 })
})

test('trends are scoped by school as well', async () => {
  seed({
    incidents: [
      incident({ id: 'a', schoolId: 'school_alpha' }),
      incident({ id: 'b', schoolId: 'school_beta' }),
      incident({ id: 'c', schoolId: 'school_beta' }),
    ],
  })

  const alpha = await getTrends({ schoolId: 'school_alpha', range: 'week' })
  const beta = await getTrends({ schoolId: 'school_beta', range: 'week' })

  assert.equal(alpha.totalInRange, 1)
  assert.equal(beta.totalInRange, 2)
})

test('an unknown range falls back to the week view', async () => {
  seed({ incidents: [incident()] })

  const result = await getTrends({ range: 'decade' })

  assert.equal(result.incidentsByPeriod.length, 7)
})

// ── Caching ───────────────────────────────────────────────────────────────────

test('repeated reads are served from one Firestore snapshot', async () => {
  seed({ incidents: [incident()] })

  await getAnalytics({})
  await getAnalytics({})
  await getAnalytics({})

  assert.equal(readCounts.incidents, 1)
})

test('switching school filters costs no extra Firestore reads', async () => {
  seed({
    incidents: [
      incident({ id: 'a', schoolId: 'school_alpha' }),
      incident({ id: 'b', schoolId: 'school_beta' }),
    ],
  })

  await getAnalytics({})
  await getAnalytics({ schoolId: 'school_alpha' })
  await getAnalytics({ schoolId: 'school_beta' })
  await getTrends({ schoolId: 'school_beta', range: 'month' })

  assert.equal(readCounts.incidents, 1)
})

test('notifications are only read when failed alerts are requested', async () => {
  seed({ incidents: [incident()], notifications: [{ id: 'n1', sms: 'failed' }] })

  await getAnalytics({})
  assert.equal(readCounts.notifications, undefined)

  await getAnalytics({ includeFailedAlerts: true })
  assert.equal(readCounts.notifications, 1)
})

test('invalidating the cache forces a fresh read and reflects new data', async () => {
  seed({ incidents: [incident({ id: 'a' })] })

  const before = await getAnalytics({})
  assert.equal(before.summary.totalIncidents, 1)

  stores.incidents.push(incident({ id: 'b' }))

  const stillCached = await getAnalytics({})
  assert.equal(stillCached.summary.totalIncidents, 1)

  invalidateAnalyticsCache()

  const after = await getAnalytics({})
  assert.equal(after.summary.totalIncidents, 2)
  assert.equal(readCounts.incidents, 2)
})

test('concurrent requests share a single Firestore read', async () => {
  seed({ incidents: [incident()] })

  await Promise.all([getAnalytics({}), getAnalytics({ schoolId: 'school_alpha' }), getTrends({})])

  assert.equal(readCounts.incidents, 1)
})
