const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

// ── In-memory Firestore double ────────────────────────────────────────────────

let stores = {}

function getStore(name) {
  if (!stores[name]) stores[name] = new Map()
  return stores[name]
}

function makeSnapshot(collectionName, id) {
  const data = getStore(collectionName).get(id)
  return {
    id,
    exists: Boolean(data),
    data: () => (data ? { ...data } : undefined),
  }
}

function makeDocRef(collectionName, id) {
  return {
    id,
    _collection: collectionName,
    async get() {
      return makeSnapshot(collectionName, id)
    },
    async set(data, options = {}) {
      const existing = options.merge ? getStore(collectionName).get(id) || {} : {}
      getStore(collectionName).set(id, { ...existing, ...data })
    },
  }
}

function makeQuery(collectionName, filters = [], limit = null) {
  return {
    where(field, _op, value) {
      return makeQuery(collectionName, [...filters, { field, value }], limit)
    },
    limit(count) {
      return makeQuery(collectionName, filters, count)
    },
    async get() {
      let rows = [...getStore(collectionName).entries()].filter(([, data]) =>
        filters.every(filter => data[filter.field] === filter.value)
      )
      if (limit !== null) rows = rows.slice(0, limit)

      return {
        empty: rows.length === 0,
        docs: rows.map(([id, data]) => ({ id, exists: true, data: () => ({ ...data }) })),
      }
    },
  }
}

const fakeDb = {
  collection(name) {
    return {
      ...makeQuery(name),
      doc(id) {
        return makeDocRef(name, id)
      },
    }
  },
  async runTransaction(handler) {
    return handler({
      async get(ref) {
        return makeSnapshot(ref._collection, ref.id)
      },
      set(ref, data, options = {}) {
        const existing = options.merge ? getStore(ref._collection).get(ref.id) || {} : {}
        getStore(ref._collection).set(ref.id, { ...existing, ...data })
      },
    })
  },
}

// ── Stub firebase-admin: the bearer token is the caller's uid ─────────────────

const adminPath = require.resolve('firebase-admin')

require.cache[adminPath] = {
  id: adminPath,
  filename: adminPath,
  loaded: true,
  exports: {
    auth: () => ({
      async verifyIdToken(token) {
        if (token === 'invalid') throw new Error('bad token')
        const user = getStore('users').get(token)
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

delete require.cache[require.resolve('../src/routes/quickAlerts')]
const quickAlertRoutes = require('../src/routes/quickAlerts')
const { MAX_QUICK_ALERTS } = quickAlertRoutes

// ── Server under test ─────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
app.use('/api/quick-alerts', quickAlertRoutes)
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
  stores = {}

  getStore('users').set('staffUid', { email: 'staff@school.edu', role: 'staff', schoolId: 'school_north' })
  getStore('users').set('otherStaffUid', { email: 'other@school.edu', role: 'staff', schoolId: 'school_north' })
  getStore('users').set('adminUid', { email: 'admin@school.edu', role: 'schoolAdmin', schoolId: 'school_north' })

  getStore('alertTypes').set('at_medical', {
    label: 'Medical', value: 'medical', emoji: '🏥', category: 'emergency', active: true,
  })
  getStore('alertTypes').set('at_behaviour', {
    label: 'Behaviour', value: 'behaviour', emoji: '⚠️', category: 'general', active: true,
  })
  getStore('alertTypes').set('at_retired', {
    label: 'Retired', value: 'retired', category: 'general', active: false,
  })

  getStore('locations').set('loc_oval', { label: 'Oval' })
  getStore('locations').set('loc_library', { label: 'Library' })
}

async function call(method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const get = (token) => call('GET', '/api/quick-alerts', token)
const create = (token, body) => call('POST', '/api/quick-alerts', token, body)
const update = (token, id, body) => call('PUT', `/api/quick-alerts/${id}`, token, body)
const remove = (token, id) => call('DELETE', `/api/quick-alerts/${id}`, token)

const VALID = { label: 'Oval asthma', alertTypeId: 'at_medical', location: 'Oval' }

test.beforeEach(seed)

// ── Access ────────────────────────────────────────────────────────────────────

test('a request without a token is rejected', async () => {
  assert.equal((await get()).status, 401)
})

test('an invalid token is rejected', async () => {
  assert.equal((await get('invalid')).status, 401)
})

test('a School Admin cannot use staff quick alerts', async () => {
  const { status, body } = await get('adminUid')
  assert.equal(status, 403)
  assert.match(body.error, /staff accounts only/i)
})

// ── Reading ───────────────────────────────────────────────────────────────────

test('a staff member with no shortcuts gets an empty list and the limit', async () => {
  const { status, body } = await get('staffUid')

  assert.equal(status, 200)
  assert.deepEqual(body.quickAlerts, [])
  assert.equal(body.limit, MAX_QUICK_ALERTS)
  assert.equal(body.remaining, MAX_QUICK_ALERTS)
})

// ── Creating ──────────────────────────────────────────────────────────────────

test('a staff member can create a quick alert', async () => {
  const { status, body } = await create('staffUid', VALID)

  assert.equal(status, 201)
  assert.equal(body.quickAlerts.length, 1)
  assert.equal(body.remaining, MAX_QUICK_ALERTS - 1)

  const [saved] = body.quickAlerts
  assert.equal(saved.label, 'Oval asthma')
  assert.equal(saved.alertTypeId, 'at_medical')
  assert.equal(saved.location, 'Oval')
  assert.equal(saved.available, true)
  assert.equal(saved.alertType.label, 'Medical')
  assert.ok(saved.id)
  assert.ok(saved.createdAt)
})

test('priority defaults from the alert type category when not given', async () => {
  const emergency = await create('staffUid', { label: 'Med', alertTypeId: 'at_medical' })
  assert.equal(emergency.body.quickAlerts[0].priority, 'critical')

  const general = await create('staffUid', { label: 'Beh', alertTypeId: 'at_behaviour' })
  const saved = general.body.quickAlerts.find(entry => entry.label === 'Beh')
  assert.equal(saved.priority, 'medium')
})

test('an explicit priority is honoured', async () => {
  const { body } = await create('staffUid', { ...VALID, priority: 'low' })
  assert.equal(body.quickAlerts[0].priority, 'low')
})

test('a missing or invalid name is rejected', async () => {
  assert.equal((await create('staffUid', { alertTypeId: 'at_medical' })).status, 400)
  assert.equal((await create('staffUid', { label: 'x', alertTypeId: 'at_medical' })).status, 400)
})

test('an alert type is required and must exist', async () => {
  assert.equal((await create('staffUid', { label: 'No type' })).status, 400)

  const unknown = await create('staffUid', { label: 'Bad type', alertTypeId: 'nope' })
  assert.equal(unknown.status, 400)
  assert.match(unknown.body.error, /not available/i)
})

test('a deactivated alert type cannot be used', async () => {
  const { status } = await create('staffUid', { label: 'Old', alertTypeId: 'at_retired' })
  assert.equal(status, 400)
})

test('a location that is not configured is rejected', async () => {
  const { status, body } = await create('staffUid', { ...VALID, location: 'Rooftop' })
  assert.equal(status, 400)
  assert.match(body.error, /location is not configured/i)
})

test('a configured location is matched case-insensitively and stored canonically', async () => {
  const { body } = await create('staffUid', { ...VALID, location: '  oVaL ' })
  assert.equal(body.quickAlerts[0].location, 'Oval')
})

test('an over-long note is rejected', async () => {
  const { status } = await create('staffUid', { ...VALID, description: 'x'.repeat(281) })
  assert.equal(status, 400)
})

test('duplicate names are rejected regardless of case and spacing', async () => {
  await create('staffUid', VALID)

  const duplicate = await create('staffUid', { label: '  oval   ASTHMA ', alertTypeId: 'at_behaviour' })
  assert.equal(duplicate.status, 409)
  assert.match(duplicate.body.error, /already have a quick alert/i)
})

test('the per-staff limit is enforced', async () => {
  for (let index = 0; index < MAX_QUICK_ALERTS; index += 1) {
    const { status } = await create('staffUid', { label: `Alert ${index}`, alertTypeId: 'at_medical' })
    assert.equal(status, 201)
  }

  const overflow = await create('staffUid', { label: 'One too many', alertTypeId: 'at_medical' })
  assert.equal(overflow.status, 409)
  assert.match(overflow.body.error, new RegExp(`up to ${MAX_QUICK_ALERTS}`))

  const { body } = await get('staffUid')
  assert.equal(body.quickAlerts.length, MAX_QUICK_ALERTS)
  assert.equal(body.remaining, 0)
})

// ── Updating ──────────────────────────────────────────────────────────────────

test('a quick alert can be edited', async () => {
  const created = await create('staffUid', VALID)
  const { id } = created.body.quickAlerts[0]

  const { status, body } = await update('staffUid', id, {
    label: 'Library asthma',
    alertTypeId: 'at_behaviour',
    priority: 'high',
    location: 'Library',
    description: 'Check the first-aid room',
  })

  assert.equal(status, 200)
  const saved = body.quickAlerts.find(entry => entry.id === id)
  assert.equal(saved.label, 'Library asthma')
  assert.equal(saved.alertTypeId, 'at_behaviour')
  assert.equal(saved.priority, 'high')
  assert.equal(saved.location, 'Library')
  assert.equal(saved.description, 'Check the first-aid room')
  assert.notEqual(saved.updatedAt, undefined)
})

test('editing keeps the original id and does not add an entry', async () => {
  const created = await create('staffUid', VALID)
  const { id } = created.body.quickAlerts[0]

  const { body } = await update('staffUid', id, { label: 'Renamed', alertTypeId: 'at_medical' })

  assert.equal(body.quickAlerts.length, 1)
  assert.equal(body.quickAlerts[0].id, id)
})

test('an entry may keep its own name when edited', async () => {
  const created = await create('staffUid', VALID)
  const { id } = created.body.quickAlerts[0]

  const { status } = await update('staffUid', id, { label: 'Oval asthma', alertTypeId: 'at_behaviour' })
  assert.equal(status, 200)
})

test('editing to another entry name is rejected', async () => {
  const first = await create('staffUid', VALID)
  await create('staffUid', { label: 'Library fight', alertTypeId: 'at_behaviour' })

  const { status } = await update('staffUid', first.body.quickAlerts[0].id, {
    label: 'Library fight',
    alertTypeId: 'at_medical',
  })

  assert.equal(status, 409)
})

test('editing an unknown quick alert returns 404', async () => {
  const { status } = await update('staffUid', 'missing', VALID)
  assert.equal(status, 404)
})

test('editing still validates the alert type', async () => {
  const created = await create('staffUid', VALID)
  const { status } = await update('staffUid', created.body.quickAlerts[0].id, {
    label: 'Oval asthma',
    alertTypeId: 'nope',
  })
  assert.equal(status, 400)
})

// ── Removing ──────────────────────────────────────────────────────────────────

test('a quick alert can be removed and frees a slot', async () => {
  const created = await create('staffUid', VALID)
  const { id } = created.body.quickAlerts[0]

  const { status, body } = await remove('staffUid', id)

  assert.equal(status, 200)
  assert.deepEqual(body.quickAlerts, [])
  assert.equal(body.remaining, MAX_QUICK_ALERTS)
})

test('removing an unknown quick alert returns 404', async () => {
  assert.equal((await remove('staffUid', 'missing')).status, 404)
})

// ── Ownership and resilience ──────────────────────────────────────────────────

test('one staff member never sees another staff member shortcuts', async () => {
  await create('staffUid', VALID)

  const other = await get('otherStaffUid')
  assert.deepEqual(other.body.quickAlerts, [])

  const mine = await get('staffUid')
  assert.equal(mine.body.quickAlerts.length, 1)
})

test('a staff member cannot edit or delete another staff member shortcut', async () => {
  const created = await create('staffUid', VALID)
  const { id } = created.body.quickAlerts[0]

  assert.equal((await update('otherStaffUid', id, VALID)).status, 404)
  assert.equal((await remove('otherStaffUid', id)).status, 404)

  const mine = await get('staffUid')
  assert.equal(mine.body.quickAlerts.length, 1)
})

test('a shortcut survives its alert type being deleted and is flagged for repair', async () => {
  await create('staffUid', VALID)

  getStore('alertTypes').delete('at_medical')

  const { body } = await get('staffUid')
  const [saved] = body.quickAlerts

  assert.equal(saved.available, false)
  assert.equal(saved.alertType, null)
  assert.match(saved.unavailableReason, /no longer available/i)
})

test('a renamed alert type flows through to the shortcut', async () => {
  await create('staffUid', VALID)

  getStore('alertTypes').set('at_medical', {
    label: 'Medical Response', value: 'medical_response', emoji: '🏥', category: 'emergency', active: true,
  })

  const { body } = await get('staffUid')
  assert.equal(body.quickAlerts[0].alertType.label, 'Medical Response')
})
