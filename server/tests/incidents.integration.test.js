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

function createTestDb({ incidents = {}, notifications = {}, users = {}, schools = {} } = {}) {
  // schoolService caches the school list in a module-level store, so it has to
  // be cleared whenever a test swaps in a fresh database.
  require('../src/schoolCache').resetSchoolCache()

  const incidentStore = new Map(Object.entries(incidents).map(([id, value]) => [id, { ...value }]))
  const notificationStore = new Map(Object.entries(notifications).map(([id, value]) => [id, { ...value }]))
  const userStore = new Map(Object.entries(users).map(([id, value]) => [id, { ...value }]))
  const schoolStore = new Map(Object.entries(schools).map(([id, value]) => [id, { ...value }]))
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

      if (name === 'notifications') {
        return makeQuery(notificationStore)
      }

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

test('POST /api/incidents rejects company admin incident creation', async () => {
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
