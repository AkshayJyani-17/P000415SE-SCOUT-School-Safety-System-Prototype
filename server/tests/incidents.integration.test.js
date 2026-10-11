const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

let fakeDb
let nextIncidentId = 1

function makeDoc(id, data) {
  return {
    id,
    exists: !!data,
    data: () => data,
  }
}

function createTestDb({ incidents = {}, notifications = {}, users = {}, schools = {}, notificationRouting = {}, notificationRecipients = {}, deletedIncidents = {}, settings = {}, schoolSettings = {} } = {}) {
  // schoolService caches the school list in a module-level store, so it has to
  // be cleared whenever a test swaps in a fresh database.
  require('../src/schoolCache').resetSchoolCache()

  const incidentStore = new Map(Object.entries(incidents).map(([id, value]) => [id, { ...value }]))
  const deletedIncidentStore = new Map(Object.entries(deletedIncidents).map(([id, value]) => [id, { ...value }]))
  // The delete rule resolves the overdue threshold the same way GET /settings
  // does, so the fake needs the settings document and per-school overrides.
  const settingsStore = new Map(Object.entries(settings).map(([id, value]) => [id, { ...value }]))
  const schoolSettingsStore = new Map(Object.entries(schoolSettings).map(([id, value]) => [id, { ...value }]))
  const notificationStore = new Map(Object.entries(notifications).map(([id, value]) => [id, { ...value }]))
  const userStore = new Map(Object.entries(users).map(([id, value]) => [id, { ...value }]))
  const schoolStore = new Map(Object.entries(schools).map(([id, value]) => [id, { ...value }]))
  const routingStore = new Map(Object.entries(notificationRouting))
  const recipientStore = new Map(Object.entries(notificationRecipients))
  const counterStore = new Map()

  function makeQuery(store, filters = [], limitCount = null) {
    return {
      where(field, operator, value) {
        return makeQuery(store, [...filters, { field, operator, value }], limitCount)
      },
      limit(count) {
        return makeQuery(store, filters, count)
      },
      async get() {
        let entries = [...store.entries()]
          .filter(([, record]) => filters.every(filter => {
            if (filter.operator === 'array-contains') {
              return Array.isArray(record[filter.field]) && record[filter.field].includes(filter.value)
            }

            if (filter.operator !== '==') return false
            return record[filter.field] === filter.value
          }))

        if (limitCount !== null) {
          entries = entries.slice(0, limitCount)
        }

        const docs = entries.map(([id, record]) => makeDoc(id, record))

        return { docs, empty: docs.length === 0 }
      },
    }
  }

  return {
    collection(name) {
      if (name === 'incidents') {
        return {
          where(field, operator, value) {
            return makeQuery(incidentStore).where(field, operator, value)
          },
          async get() {
            return { docs: [...incidentStore.entries()].map(([id, record]) => makeDoc(id, record)) }
          },
          doc(id) {
            return {
              id,
              __store: incidentStore,
              async get() {
                return makeDoc(id, incidentStore.get(id))
              },
              async update(data) {
                const existing = incidentStore.get(id)
                if (!existing) {
                  throw new Error(`Incident ${id} not found`)
                }
                incidentStore.set(id, { ...existing, ...data })
              },
              async delete() {
                incidentStore.delete(id)
              },
            }
          },
          async add(data) {
            const id = `incident-${nextIncidentId++}`
            incidentStore.set(id, { ...data })
            return {
              id,
              async get() {
                return makeDoc(id, incidentStore.get(id))
              },
            }
          },
        }
      }

      if (name === 'schoolSettings') {
        return {
          doc(id) {
            return {
              id,
              async get() {
                return makeDoc(id, schoolSettingsStore.get(id))
              },
            }
          },
        }
      }

      if (name === 'deletedIncidents') {
        return {
          doc(id) {
            return {
              id,
              __store: deletedIncidentStore,
              async get() {
                return makeDoc(id, deletedIncidentStore.get(id))
              },
              async set(data) {
                deletedIncidentStore.set(id, { ...data })
              },
            }
          },
          async get() {
            const docs = [...deletedIncidentStore.entries()].map(([id, record]) => makeDoc(id, record))
            return { docs, empty: docs.length === 0 }
          },
        }
      }

      if (name === 'notifications') {
        return makeQuery(notificationStore)
      }
      if (name === 'notificationRouting') return makeQuery(routingStore)
      if (name === 'notificationRecipients') return makeQuery(recipientStore)

      if (name === 'users') {
        return {
          doc(id) {
            return {
              async get() {
                return makeDoc(id, userStore.get(id))
              },
            }
          },
          where(field, operator, value) {
            return makeQuery(userStore).where(field, operator, value)
          },
        }
      }

      if (name === 'schools') {
        return {
          doc(id) {
            return {
              async get() {
                return makeDoc(id, schoolStore.get(id))
              },
            }
          },
          // schoolService reads the whole collection once and caches it,
          // rather than doing a per-lookup document read.
          async get() {
            const docs = [...schoolStore.entries()].map(([id, record]) => makeDoc(id, record))
            return { docs, empty: docs.length === 0 }
          },
          where(field, operator, value) {
            return makeQuery(schoolStore).where(field, operator, value)
          },
        }
      }

      if (name === 'counters') {
        return {
          doc(id) {
            return {
              id,
              async get() {
                return makeDoc(id, counterStore.get(id))
              },
            }
          },
        }
      }

      throw new Error(`Unexpected collection: ${name}`)
    },

    doc(path) {
      return {
        id: path,
        async get() {
          return makeDoc(path, settingsStore.get(path))
        },
      }
    },

    // Mirrors the subset of the Firestore batch API the routes actually use.
    batch() {
      const operations = []

      return {
        set(ref, data) {
          operations.push(() => ref.__store.set(ref.id, { ...data }))
        },
        delete(ref) {
          operations.push(() => ref.__store.delete(ref.id))
        },
        async commit() {
          for (const apply of operations) apply()
        },
      }
    },

    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          return makeDoc(ref.id, counterStore.get(ref.id))
        },

        set(ref, data, options = {}) {
          const existing = counterStore.get(ref.id) || {}

          counterStore.set(
            ref.id,
            options.merge ? { ...existing, ...data } : { ...data }
          )
        },
      }

      return callback(transaction)
    },

    stores: {
      incidents: incidentStore,
      deletedIncidents: deletedIncidentStore,
      settings: settingsStore,
      schoolSettings: schoolSettingsStore,
      notifications: notificationStore,
      users: userStore,
      schools: schoolStore,
      counters: counterStore,
    },
  }
}

const firebasePath = require.resolve('../src/db/firebase')
const incidentsRoutePath = require.resolve('../src/routes/incidents')
const firebaseAdminPath = require.resolve('firebase-admin')

require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: {
    getDb: () => fakeDb,
    docToObject: doc => (doc && doc.exists ? { id: doc.id, ...doc.data() } : null),
    snapshotToArray: snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    formatTimestamp: value => {
      const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value)
      return date.toISOString()
    },
  },
}

require.cache[firebaseAdminPath] = {
  id: firebaseAdminPath,
  filename: firebaseAdminPath,
  loaded: true,
  exports: {
    auth: () => ({
      async verifyIdToken(token) {
        const usersByToken = {
          'valid-token': {
            uid: 'admin-uid',
            email: 'admin@school.edu',
            name: 'Token Name',
          },
          'company-token': {
            uid: 'company-uid',
            email: 'company@scout.edu',
            name: 'Company Admin',
          },
          'school-token': {
            uid: 'school-admin-uid',
            email: 'principal@school.edu',
            name: 'School Admin',
          },
          'staff-token': {
            uid: 'staff-uid',
            email: 'staff@school.edu',
            name: 'Staff User',
          },
        }

        if (!usersByToken[token]) {
          throw new Error('Invalid token')
        }

        return usersByToken[token]
      },
    }),
  },
}

delete require.cache[incidentsRoutePath]
const incidentsRouter = require('../src/routes/incidents')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/incidents', incidentsRouter)
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message || 'Internal server error.' })
  })
  return app
}

async function withServer(app, callback) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance))
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    await callback(baseUrl)
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    })
  }
}

test.beforeEach(() => {
  nextIncidentId = 1
})

test('GET /api/incidents returns incidents sorted newest first', async () => {
  fakeDb = createTestDb({
    users: {
      'company-uid': {
        name: 'Company Admin',
        email: 'company@scout.edu',
        role: 'companyAdmin',
      },
    },
    incidents: {
      older: {
        title: 'Older incident',
        status: 'triggered',
        createdAt: '2026-04-29T08:00:00.000Z',
        schoolId: 'school_alpha',
      },
      newer: {
        title: 'Newer incident',
        status: 'acknowledged',
        createdAt: '2026-04-29T09:00:00.000Z',
        schoolId: 'school_beta',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      headers: { Authorization: 'Bearer company-token' },
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.incidents.length, 2)
    assert.equal(payload.incidents[0].id, 'newer')
    assert.equal(payload.incidents[1].id, 'older')
  })
})

test('GET /api/incidents/:id returns incident details and related notifications', async () => {
  fakeDb = createTestDb({
    users: {
      'company-uid': {
        name: 'Company Admin',
        email: 'company@scout.edu',
        role: 'companyAdmin',
      },
    },
    incidents: {
      incident42: {
        title: 'Fire alarm triggered',
        type: 'fire',
        priority: 'critical',
        status: 'acknowledged',
        location: 'Block B',
        createdAt: '2026-04-29T10:00:00.000Z',
        triggeredByName: 'Admin User',
        schoolId: 'school_alpha',
        description: 'Smoke detected near science lab.',
      },
    },
    notifications: {
      note1: {
        incidentId: 'incident42',
        recipientName: 'Riley Principal',
        smsStatus: 'sent',
        emailStatus: 'delivered',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents/incident42`, {
      headers: { Authorization: 'Bearer company-token' },
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.incident.id, 'incident42')
    assert.equal(payload.incident.title, 'Fire alarm triggered')
    assert.equal(payload.incident.notifications.length, 1)
    assert.deepEqual(payload.incident.notifications[0], {
      recipientName: 'Riley Principal',
      sms: 'sent',
      email: 'delivered',
    })
  })
})

test('POST /api/incidents creates a new incident with authenticated reporter details', async () => {
  fakeDb = createTestDb({
    users: {
      'school-admin-uid': {
        name: 'School Admin',
        email: 'principal@school.edu',
        role: 'schoolAdmin',
        schoolId: 'school_alpha',
      },
    },
    schools: {
      school_alpha: {
        name: 'Alpha School',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer school-token' },
      body: JSON.stringify({
        type: 'fire',
        priority: 'critical',
        title: 'Fire alert',
        location: 'Block B',
        description: 'Smoke detected',
        triggeredByName: 'Spoofed User',
      }),
    })

    assert.equal(response.status, 201)

    const payload = await response.json()
    assert.equal(payload.type, 'fire')
    assert.equal(payload.priority, 'critical')
    assert.equal(payload.status, 'triggered')

    const storedIncident = fakeDb.stores.incidents.get(payload.id)
    assert.equal(storedIncident.title, 'Fire alert')
    assert.equal(storedIncident.location, 'Block B')
    assert.equal(storedIncident.triggeredByName, 'School Admin')
    assert.equal(storedIncident.triggeredById, 'school-admin-uid')
    assert.equal(storedIncident.triggeredByEmail, 'principal@school.edu')
    assert.equal(storedIncident.triggeredByRole, 'schoolAdmin')
    assert.equal(storedIncident.schoolId, 'school_alpha')
    assert.equal(storedIncident.schoolName, 'Alpha School')
    assert.deepEqual(storedIncident.assignedUserIds, [])
    assert.deepEqual(storedIncident.assignedUserEmails, [])
  })
})

test('POST /api/incidents requires company admin to select a school', async () => {
  fakeDb = createTestDb({
    users: {
      'company-uid': {
        name: 'Company Admin',
        email: 'company@scout.edu',
        role: 'companyAdmin',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer company-token' },
      body: JSON.stringify({
        type: 'fire',
        priority: 'critical',
        title: 'Company admin should not create this',
        location: 'Block B',
      }),
    })

    assert.equal(response.status, 403)
  })
})

test('preview recipients uses the sender school and does not create an incident', async () => {
  fakeDb = createTestDb({
    users: { 'school-admin-uid': { role: 'schoolAdmin', schoolId: 'school_alpha' } },
    notificationRouting: {
      alpha: { schoolId: 'school_alpha', alertType: 'fire', active: true, recipients: [{ name: 'Fire Warden', email: 'warden@alpha.edu' }] },
      beta: { schoolId: 'school_beta', alertType: 'fire', active: true, recipients: [{ name: 'Other Warden', email: 'warden@beta.edu' }] },
    },
  })
  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents/preview/recipients?type=fire&schoolId=school_beta`, { headers: { Authorization: 'Bearer school-token' } })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).recipients, [{ name: 'Fire Warden', email: 'warden@alpha.edu' }])
    assert.equal(fakeDb.stores.incidents.size, 0)
  })
})

test('company admin submits to the selected active school', async () => {
  fakeDb = createTestDb({
    users: { 'company-uid': { name: 'Company Admin', role: 'companyAdmin' } },
    schools: { school_alpha: { name: 'Alpha School', active: true } },
  })
  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer company-token' },
      body: JSON.stringify({ schoolId: 'school_alpha', type: 'fire', title: 'Fire alert', location: 'Block A' }),
    })
    assert.equal(response.status, 201)
    const incident = fakeDb.stores.incidents.get((await response.json()).id)
    assert.equal(incident.schoolName, 'Alpha School')
    assert.equal(incident.schoolId, 'school_alpha')
  })
})

test('GET /api/incidents scopes school admin to their school', async () => {
  fakeDb = createTestDb({
    users: {
      'school-admin-uid': {
        name: 'School Admin',
        email: 'principal@school.edu',
        role: 'schoolAdmin',
        schoolId: 'school_alpha',
      },
    },
    incidents: {
      alpha: {
        title: 'Alpha incident',
        createdAt: '2026-04-29T09:00:00.000Z',
        schoolId: 'school_alpha',
      },
      beta: {
        title: 'Beta incident',
        createdAt: '2026-04-29T10:00:00.000Z',
        schoolId: 'school_beta',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      headers: { Authorization: 'Bearer school-token' },
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.deepEqual(payload.incidents.map(incident => incident.id), ['alpha'])
  })
})

test('GET /api/incidents scopes staff to submitted or assigned incidents', async () => {
  fakeDb = createTestDb({
    users: {
      'staff-uid': {
        name: 'Staff User',
        email: 'staff@school.edu',
        role: 'staff',
        schoolId: 'school_alpha',
      },
    },
    incidents: {
      submitted: {
        title: 'Submitted by staff',
        createdAt: '2026-04-29T09:00:00.000Z',
        triggeredById: 'staff-uid',
        schoolId: 'school_alpha',
      },
      assignedById: {
        title: 'Assigned by uid',
        createdAt: '2026-04-29T10:00:00.000Z',
        assignedUserIds: ['staff-uid'],
        schoolId: 'school_alpha',
      },
      assignedByEmail: {
        title: 'Assigned by email',
        createdAt: '2026-04-29T11:00:00.000Z',
        assignedUserEmails: ['staff@school.edu'],
        schoolId: 'school_alpha',
      },
      unrelated: {
        title: 'Unrelated incident',
        createdAt: '2026-04-29T12:00:00.000Z',
        schoolId: 'school_alpha',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      headers: { Authorization: 'Bearer staff-token' },
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.deepEqual(payload.incidents.map(incident => incident.id), [
      'assignedByEmail',
      'assignedById',
      'submitted',
    ])
  })
})

test('GET /api/incidents/:id prevents staff from opening unrelated incidents', async () => {
  fakeDb = createTestDb({
    users: {
      'staff-uid': {
        name: 'Staff User',
        email: 'staff@school.edu',
        role: 'staff',
        schoolId: 'school_alpha',
      },
    },
    incidents: {
      unrelated: {
        title: 'Unrelated incident',
        createdAt: '2026-04-29T12:00:00.000Z',
        schoolId: 'school_alpha',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents/unrelated`, {
      headers: { Authorization: 'Bearer staff-token' },
    })

    assert.equal(response.status, 403)
  })
})

test('PATCH /api/incidents/:id/status updates incident status', async () => {
  fakeDb = createTestDb({
    users: {
      'admin-uid': {
        name: 'Admin User',
        email: 'admin@school.edu',
        role: 'companyAdmin',
      },
    },
    incidents: {
      incident77: {
        title: 'Medical alert',
        status: 'triggered',
        createdAt: '2026-04-29T10:30:00.000Z',
        updatedAt: '2026-04-29T10:30:00.000Z',
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents/incident77/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
      body: JSON.stringify({ status: 'acknowledged' }),
    })

    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.success, true)
    assert.equal(payload.incident.status, 'acknowledged')
    assert.equal(payload.incident.acknowledgedBy.length, 1)
    assert.equal(payload.incident.acknowledgedBy[0].name, 'Admin User')

    const updated = fakeDb.stores.incidents.get('incident77')
    assert.equal(updated.status, 'acknowledged')
    assert.equal(typeof updated.updatedAt, 'string')
    assert.equal(updated.acknowledgedBy[0].email, 'admin@school.edu')
  })
})

test('POST /api/incidents stores and returns the isTest flag for quick test alerts', async () => {
  fakeDb = createTestDb({
    users: { 'school-admin-uid': { name: 'School Admin', role: 'schoolAdmin', schoolId: 'school_alpha' } },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer school-token' },
      body: JSON.stringify({
        isTest: true,
        type: 'fire',
        priority: 'critical',
        title: 'TEST: Fire alert',
        location: 'Alert testing',
      }),
    })

    assert.equal(response.status, 201)
    const payload = await response.json()
    assert.equal(payload.isTest, true)
    assert.equal(fakeDb.stores.incidents.get(payload.id).isTest, true)
  })
})

test('POST /api/incidents marks a normal alert as not a test', async () => {
  fakeDb = createTestDb({
    users: { 'school-admin-uid': { name: 'School Admin', role: 'schoolAdmin', schoolId: 'school_alpha' } },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer school-token' },
      body: JSON.stringify({ type: 'fire', priority: 'critical', title: 'Fire in Block A', location: 'Block A' }),
    })

    assert.equal(response.status, 201)
    assert.equal((await response.json()).isTest, false)
  })
})

// ── DELETE /api/incidents/:id ─────────────────────────────────────────────────
// Deletion is a soft delete: the record moves to deletedIncidents with who,
// when and why. Only test alerts or resolved incidents are eligible.

const DELETE_USERS = {
  'company-uid': { name: 'Company Admin', email: 'company@scout.edu', role: 'companyAdmin' },
  'school-admin-uid': { name: 'Riley Principal', email: 'principal@school.edu', role: 'schoolAdmin', schoolId: 'school_alpha' },
  'staff-uid': { name: 'Staff User', email: 'staff@school.edu', role: 'staff', schoolId: 'school_alpha' },
}

function deletableDb(overrides = {}) {
  return createTestDb({
    users: DELETE_USERS,
    incidents: {
      resolvedAlpha: {
        title: 'Duplicate fire report',
        type: 'fire',
        incidentNumber: 'INC-0007',
        status: 'resolved',
        schoolId: 'school_alpha',
        schoolName: 'Alpha High',
        createdAt: '2026-04-29T10:00:00.000Z',
      },
      ...overrides,
    },
  })
}

// A drill raised by the School Admin, the only thing that role may delete.
function ownDrillRecord() {
  return {
    title: 'TEST: Fire alert',
    type: 'fire',
    status: 'triggered',
    isTest: true,
    schoolId: 'school_alpha',
    triggeredById: 'school-admin-uid',
    triggeredByEmail: 'principal@school.edu',
    createdAt: '2026-04-29T10:00:00.000Z',
  }
}

function deleteRequest(baseUrl, id, token, body = { reasonCode: 'duplicate', reason: 'Logged twice' }) {
  return fetch(`${baseUrl}/api/incidents/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('DELETE /api/incidents/:id lets a Company Admin delete a resolved incident', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'resolvedAlpha', 'company-token')
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.success, true)
    assert.equal(fakeDb.stores.incidents.has('resolvedAlpha'), false)
    assert.equal(fakeDb.stores.deletedIncidents.has('resolvedAlpha'), true)
  })
})

test('DELETE /api/incidents/:id stores who deleted it, when and why', async () => {
  fakeDb = deletableDb({ ownDrill: ownDrillRecord() })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'ownDrill', 'school-token', {
      reasonCode: 'test_or_drill',
      reason: 'Finished the drill',
    })
    assert.equal(response.status, 200)

    const record = fakeDb.stores.deletedIncidents.get('ownDrill')
    assert.equal(record.deletionReasonCode, 'test_or_drill')
    assert.equal(record.deletionReason, 'Finished the drill')
    assert.equal(record.deletedBy.email, 'principal@school.edu')
    assert.equal(record.deletedBy.role, 'schoolAdmin')
    assert.ok(record.deletedAt, 'deletedAt should be recorded')
    // The original incident data is retained for audit.
    assert.equal(record.title, 'TEST: Fire alert')
  })
})

test('DELETE /api/incidents/:id lets a School Admin delete a test alert they raised', async () => {
  fakeDb = deletableDb({ ownDrill: ownDrillRecord() })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'ownDrill', 'school-token', {
      reasonCode: 'test_or_drill',
      reason: '',
    })
    assert.equal(response.status, 200)
    assert.equal(fakeDb.stores.incidents.has('ownDrill'), false)
  })
})

test('DELETE /api/incidents/:id returns 403 when a School Admin deletes a drill someone else raised', async () => {
  fakeDb = deletableDb({
    othersDrill: { ...ownDrillRecord(), triggeredById: 'another-admin-uid', triggeredByEmail: 'other@school.edu' },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'othersDrill', 'school-token', {
      reasonCode: 'test_or_drill',
      reason: '',
    })
    assert.equal(response.status, 403)
    assert.equal(fakeDb.stores.incidents.has('othersDrill'), true)
  })
})

test('DELETE /api/incidents/:id returns 403 when a School Admin deletes a real incident at their own school', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    // Resolved and at their school, so the old rule allowed this. A school
    // must not be able to erase its own genuine records.
    const response = await deleteRequest(baseUrl, 'resolvedAlpha', 'school-token')
    assert.equal(response.status, 403)
    assert.equal(fakeDb.stores.incidents.has('resolvedAlpha'), true)
    assert.equal(fakeDb.stores.deletedIncidents.size, 0)
  })
})

test('DELETE /api/incidents/:id returns 403 when a School Admin deletes their own real incident', async () => {
  fakeDb = deletableDb({
    ownRealIncident: {
      title: 'Injury on the oval',
      status: 'resolved',
      schoolId: 'school_alpha',
      triggeredById: 'school-admin-uid',
      createdAt: '2026-04-29T10:00:00.000Z',
    },
  })

  await withServer(createApp(), async baseUrl => {
    // Raising it does not grant the right to remove it; only drills qualify.
    const response = await deleteRequest(baseUrl, 'ownRealIncident', 'school-token')
    assert.equal(response.status, 403)
    assert.equal(fakeDb.stores.incidents.has('ownRealIncident'), true)
  })
})

test('DELETE /api/incidents/:id lets a Company Admin delete a drill raised by a School Admin', async () => {
  fakeDb = deletableDb({ ownDrill: ownDrillRecord() })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'ownDrill', 'company-token', {
      reasonCode: 'test_or_drill',
      reason: '',
    })
    assert.equal(response.status, 200)
    assert.equal(fakeDb.stores.incidents.has('ownDrill'), false)
  })
})

test('DELETE /api/incidents/:id returns 403 when a School Admin targets another school', async () => {
  fakeDb = deletableDb({
    resolvedBeta: {
      title: 'Resolved at another school',
      status: 'resolved',
      schoolId: 'school_beta',
      createdAt: '2026-04-29T10:00:00.000Z',
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'resolvedBeta', 'school-token')
    assert.equal(response.status, 403)
    assert.equal(fakeDb.stores.incidents.has('resolvedBeta'), true)
    assert.equal(fakeDb.stores.deletedIncidents.size, 0)
  })
})

test('DELETE /api/incidents/:id returns 403 for staff', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'resolvedAlpha', 'staff-token')
    assert.equal(response.status, 403)
    assert.equal(fakeDb.stores.incidents.has('resolvedAlpha'), true)
    assert.equal(fakeDb.stores.deletedIncidents.size, 0)
  })
})

test('DELETE /api/incidents/:id deletes a test alert whatever its status', async () => {
  fakeDb = deletableDb({
    testDrill: {
      title: 'Lockdown drill',
      status: 'triggered',
      isTest: true,
      schoolId: 'school_alpha',
      createdAt: '2026-04-29T10:00:00.000Z',
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'testDrill', 'company-token', {
      reasonCode: 'test_or_drill',
      reason: '',
    })
    assert.equal(response.status, 200)
    assert.equal(fakeDb.stores.incidents.has('testDrill'), false)
  })
})

const minutesAgo = minutes => new Date(Date.now() - minutes * 60 * 1000).toISOString()

for (const liveStatus of ['acknowledged', 'in-progress']) {
  test(`DELETE /api/incidents/:id returns 409 for a live ${liveStatus} incident`, async () => {
    fakeDb = deletableDb({
      liveIncident: {
        title: 'Live emergency',
        status: liveStatus,
        schoolId: 'school_alpha',
        createdAt: minutesAgo(600),
      },
    })

    await withServer(createApp(), async baseUrl => {
      const response = await deleteRequest(baseUrl, 'liveIncident', 'company-token')
      assert.equal(response.status, 409)
      // A live incident must survive untouched so responders keep seeing it.
      assert.equal(fakeDb.stores.incidents.has('liveIncident'), true)
      assert.equal(fakeDb.stores.deletedIncidents.size, 0)
    })
  })
}

test('DELETE /api/incidents/:id returns 409 for an alert still inside the overdue window', async () => {
  fakeDb = deletableDb({
    freshAlert: {
      title: 'Just triggered',
      status: 'triggered',
      schoolId: 'school_alpha',
      createdAt: minutesAgo(2),
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'freshAlert', 'company-token')
    assert.equal(response.status, 409)
    // Dispatch may still be in flight, so this one is protected.
    assert.equal(fakeDb.stores.incidents.has('freshAlert'), true)
  })
})

test('DELETE /api/incidents/:id deletes an overdue alert nobody acknowledged', async () => {
  fakeDb = deletableDb({
    abandoned: {
      title: 'asdsfgfg',
      status: 'triggered',
      schoolId: 'school_alpha',
      createdAt: minutesAgo(60),
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'abandoned', 'company-token')
    assert.equal(response.status, 200)
    assert.equal(fakeDb.stores.incidents.has('abandoned'), false)
    assert.equal(fakeDb.stores.deletedIncidents.has('abandoned'), true)
  })
})

test('DELETE /api/incidents/:id returns 409 for an overdue alert someone acknowledged', async () => {
  fakeDb = deletableDb({
    answered: {
      title: 'Overdue but answered',
      status: 'triggered',
      schoolId: 'school_alpha',
      createdAt: minutesAgo(60),
      acknowledgedBy: [{ name: 'Riley Principal', acknowledgedAt: minutesAgo(30) }],
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'answered', 'company-token')
    assert.equal(response.status, 409)
    // Someone responded, so the record of that response is protected.
    assert.equal(fakeDb.stores.incidents.has('answered'), true)
  })
})

test('DELETE /api/incidents/:id honours a school overdue threshold override', async () => {
  fakeDb = createTestDb({
    users: DELETE_USERS,
    // The company default of 15 minutes would make this deletable; the school
    // override of 24 hours must win, exactly as GET /settings resolves it.
    settings: { 'settings/global': { overdueThresholdMinutes: 15 } },
    schoolSettings: { school_alpha: { overdueThresholdMinutes: 1440 } },
    incidents: {
      recentForSchool: {
        title: 'Two hours old',
        status: 'triggered',
        schoolId: 'school_alpha',
        createdAt: minutesAgo(120),
      },
    },
  })

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'recentForSchool', 'company-token')
    assert.equal(response.status, 409)
    assert.equal(fakeDb.stores.incidents.has('recentForSchool'), true)
  })
})

test('DELETE /api/incidents/:id returns 400 when no reason is given', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'resolvedAlpha', 'company-token', {})
    assert.equal(response.status, 400)
    assert.equal(fakeDb.stores.incidents.has('resolvedAlpha'), true)
  })
})

test('DELETE /api/incidents/:id returns 400 for an unrecognised reason code', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'resolvedAlpha', 'company-token', {
      reasonCode: 'because_i_said_so',
      reason: 'No',
    })
    assert.equal(response.status, 400)
    assert.equal(fakeDb.stores.incidents.has('resolvedAlpha'), true)
  })
})

test('DELETE /api/incidents/:id requires detail when the reason is "other"', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'resolvedAlpha', 'company-token', {
      reasonCode: 'other',
      reason: '   ',
    })
    assert.equal(response.status, 400)
    assert.equal(fakeDb.stores.incidents.has('resolvedAlpha'), true)
  })
})

test('DELETE /api/incidents/:id rejects an over-long reason', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'resolvedAlpha', 'company-token', {
      reasonCode: 'duplicate',
      reason: 'x'.repeat(501),
    })
    assert.equal(response.status, 400)
    assert.equal(fakeDb.stores.incidents.has('resolvedAlpha'), true)
  })
})

test('DELETE /api/incidents/:id returns 404 for an unknown incident', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    const response = await deleteRequest(baseUrl, 'does-not-exist', 'company-token')
    assert.equal(response.status, 404)
  })
})

test('a deleted incident no longer appears in the incident list', async () => {
  fakeDb = deletableDb()

  await withServer(createApp(), async baseUrl => {
    await deleteRequest(baseUrl, 'resolvedAlpha', 'company-token')

    const response = await fetch(`${baseUrl}/api/incidents`, {
      headers: { Authorization: 'Bearer company-token' },
    })
    const payload = await response.json()
    assert.equal(payload.incidents.some(incident => incident.id === 'resolvedAlpha'), false)
  })
})
