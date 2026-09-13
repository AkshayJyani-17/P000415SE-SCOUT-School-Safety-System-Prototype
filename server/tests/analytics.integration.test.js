const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

// ── In-memory Firestore double ────────────────────────────────────────────────

let stores = {}

function rows(name) {
  return stores[name] || []
}

function toDoc(row) {
  const { id, ...data } = row
  return { id, exists: true, data: () => ({ ...data }) }
}

function makeQuery(name, filters = [], limit = null) {
  return {
    where(field, _op, value) {
      return makeQuery(name, [...filters, { field, value }], limit)
    },
    limit(count) {
      return makeQuery(name, filters, count)
    },
    async get() {
      let matched = rows(name).filter(row =>
        filters.every(filter => row[filter.field] === filter.value)
      )
      if (limit !== null) matched = matched.slice(0, limit)
      return { docs: matched.map(toDoc), empty: matched.length === 0 }
    },
  }
}

const fakeDb = {
  collection(name) {
    return {
      ...makeQuery(name),
      doc(id) {
        return {
          async get() {
            const row = rows(name).find(entry => entry.id === id)
            return row
              ? toDoc(row)
              : { id, exists: false, data: () => undefined }
          },
        }
      },
    }
  },
}

// ── Stub firebase-admin so tokens resolve without a real project ──────────────
// The bearer token is treated as the caller's uid.

const adminPath = require.resolve('firebase-admin')

require.cache[adminPath] = {
  id: adminPath,
  filename: adminPath,
  loaded: true,
  exports: {
    auth: () => ({
      async verifyIdToken(token) {
        if (token === 'invalid') throw new Error('bad token')
        const user = rows('users').find(entry => entry.id === token)
        return { uid: token, email: user?.email || null }
      },
    }),
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

for (const modulePath of [
  '../src/analyticsCache',
  '../src/services/schoolService',
  '../src/routes/analytics',
]) {
  delete require.cache[require.resolve(modulePath)]
}

const analyticsRoutes = require('../src/routes/analytics')
const { invalidateAnalyticsCache } = require('../src/analyticsCache')
const { resetSchoolCache } = require('../src/schoolCache')

// ── Server under test ─────────────────────────────────────────────────────────

const app = express()
app.use('/api/analytics', analyticsRoutes)
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }))

let baseUrl

test.before(async () => {
  await new Promise(resolve => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
    server.unref()
  })
})

function seed() {
  stores = {
    users: [
      { id: 'companyAdminUid', email: 'admin@scout.edu', role: 'companyAdmin', schoolId: null },
      { id: 'northAdminUid', email: 'north@school.edu', role: 'schoolAdmin', schoolId: 'school_north' },
      { id: 'staffUid', email: 'staff@school.edu', role: 'staff', schoolId: 'school_north' },
      { id: 'unassignedAdminUid', email: 'nowhere@school.edu', role: 'schoolAdmin', schoolId: null },
    ],
    schools: [
      { id: 'school_north', name: 'Northvale College', active: true },
      { id: 'school_river', name: 'Riverside High', active: true },
    ],
    incidents: [
      incident({ id: 'n1', schoolId: 'school_north', location: 'Oval' }),
      incident({ id: 'r1', schoolId: 'school_river', location: 'Library' }),
      incident({ id: 'r2', schoolId: 'school_river', location: 'Library', status: 'resolved' }),
    ],
    notifications: [
      { id: 'x1', schoolId: 'school_north', sms: 'failed' },
      { id: 'x2', schoolId: 'school_river', email: 'failed' },
    ],
  }
  resetSchoolCache()
  invalidateAnalyticsCache()
}

function incident(overrides = {}) {
  return {
    type: 'medical',
    priority: 'high',
    status: 'triggered',
    location: 'Oval',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

test.beforeEach(seed)

// ── Authentication and authorisation ──────────────────────────────────────────

test('a request without a token is rejected', async () => {
  const { status } = await get('/api/analytics/all')
  assert.equal(status, 401)
})

test('an invalid token is rejected', async () => {
  const { status } = await get('/api/analytics/all', 'invalid')
  assert.equal(status, 401)
})

test('a Staff member cannot read analytics', async () => {
  const { status } = await get('/api/analytics/all', 'staffUid')
  assert.equal(status, 403)
})

test('a School Admin with no school assigned is rejected', async () => {
  const { status } = await get('/api/analytics/all', 'unassignedAdminUid')
  assert.equal(status, 403)
})

// ── Company Admin ─────────────────────────────────────────────────────────────

test('a Company Admin sees every school by default', async () => {
  const { status, body } = await get('/api/analytics/all', 'companyAdminUid')

  assert.equal(status, 200)
  assert.equal(body.summary.totalIncidents, 3)
  assert.equal(body.scope.isSystemWide, true)
  assert.equal(body.scope.schoolId, null)
})

test('a Company Admin can filter to a single school', async () => {
  const { status, body } = await get('/api/analytics/all?schoolId=school_river', 'companyAdminUid')

  assert.equal(status, 200)
  assert.equal(body.summary.totalIncidents, 2)
  assert.equal(body.summary.resolvedCount, 1)
  assert.equal(body.scope.schoolId, 'school_river')
  assert.equal(body.scope.schoolName, 'Riverside High')
  assert.deepEqual(body.locationData, [{ location: 'Library', count: 2 }])
})

test('failed alerts follow the selected school', async () => {
  const river = await get('/api/analytics/all?schoolId=school_river', 'companyAdminUid')
  const everySchool = await get('/api/analytics/all', 'companyAdminUid')

  assert.deepEqual(river.body.failedAlerts, { total: 1, sms: 0, email: 1 })
  assert.deepEqual(everySchool.body.failedAlerts, { total: 2, sms: 1, email: 1 })
})

test('filtering to an unknown school returns 404', async () => {
  const { status } = await get('/api/analytics/all?schoolId=school_missing', 'companyAdminUid')
  assert.equal(status, 404)
})

test('schoolId=all is accepted as every school', async () => {
  const { status, body } = await get('/api/analytics/all?schoolId=all', 'companyAdminUid')

  assert.equal(status, 200)
  assert.equal(body.summary.totalIncidents, 3)
  assert.equal(body.scope.isSystemWide, true)
})

// ── School Admin ──────────────────────────────────────────────────────────────

test('a School Admin only ever sees their own school', async () => {
  const { status, body } = await get('/api/analytics/all', 'northAdminUid')

  assert.equal(status, 200)
  assert.equal(body.summary.totalIncidents, 1)
  assert.equal(body.scope.schoolId, 'school_north')
  assert.equal(body.scope.isSystemWide, false)
})

test('a School Admin cannot read another school through the query string', async () => {
  const { status, body } = await get('/api/analytics/all?schoolId=school_river', 'northAdminUid')

  assert.equal(status, 403)
  assert.match(body.error, /your own school/i)
})

test('a School Admin cannot widen the scope to every school', async () => {
  const { body } = await get('/api/analytics/all?schoolId=all', 'northAdminUid')

  assert.equal(body.summary.totalIncidents, 1)
  assert.equal(body.scope.schoolId, 'school_north')
})

// ── Trends ────────────────────────────────────────────────────────────────────

test('trends honour both the range and the school filter', async () => {
  const { status, body } = await get(
    '/api/analytics/trends?range=quarter&schoolId=school_river',
    'companyAdminUid'
  )

  assert.equal(status, 200)
  assert.equal(body.range, 'quarter')
  assert.equal(body.scope.schoolId, 'school_river')
  assert.equal(body.totalInRange, 2)
  assert.equal(body.incidentsByPeriod.length, 3)
})

test('an unsupported trend range falls back to the week view', async () => {
  const { body } = await get('/api/analytics/trends?range=decade', 'companyAdminUid')

  assert.equal(body.range, 'week')
  assert.equal(body.incidentsByPeriod.length, 7)
})

test('a School Admin cannot read another school through the trends route', async () => {
  const { status } = await get(
    '/api/analytics/trends?schoolId=school_river',
    'northAdminUid'
  )

  assert.equal(status, 403)
})

// ── Sub-resources stay scoped ─────────────────────────────────────────────────

test('the summary route applies the same school filter', async () => {
  const { body } = await get('/api/analytics/summary?schoolId=school_north', 'companyAdminUid')
  assert.equal(body.totalIncidents, 1)
})

test('the by-location route applies the same school filter', async () => {
  const { body } = await get('/api/analytics/by-location?schoolId=school_north', 'companyAdminUid')
  assert.deepEqual(body, [{ location: 'Oval', count: 1 }])
})
