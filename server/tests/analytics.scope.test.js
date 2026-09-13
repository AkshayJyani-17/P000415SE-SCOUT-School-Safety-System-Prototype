const test = require('node:test')
const assert = require('node:assert/strict')

// ── In-memory Firestore double ────────────────────────────────────────────────

let stores = {}

function makeSnapshot(name) {
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

for (const modulePath of ['../src/services/schoolService', '../src/routes/analytics']) {
  delete require.cache[require.resolve(modulePath)]
}

const { resolveScope, ScopeError } = require('../src/routes/analytics')
const { resetSchoolCache } = require('../src/schoolCache')

function seedSchools() {
  stores = {
    schools: [
      { id: 'school_alpha', name: 'Alpha School', active: true },
      { id: 'school_beta', name: 'Beta School', active: true },
    ],
  }
  resetSchoolCache()
}

const companyAdmin = { role: 'companyAdmin', schoolId: null }
const schoolAdmin = { role: 'schoolAdmin', schoolId: 'school_alpha' }

test.beforeEach(seedSchools)

test('a Company Admin defaults to every school', async () => {
  const scope = await resolveScope(companyAdmin, undefined)

  assert.equal(scope.schoolId, null)
  assert.equal(scope.isSystemWide, true)
})

test('a Company Admin can ask for every school explicitly', async () => {
  const scope = await resolveScope(companyAdmin, 'all')

  assert.equal(scope.schoolId, null)
  assert.equal(scope.isSystemWide, true)
})

test('a Company Admin can narrow to one school', async () => {
  const scope = await resolveScope(companyAdmin, 'school_beta')

  assert.equal(scope.schoolId, 'school_beta')
  assert.equal(scope.schoolName, 'Beta School')
  assert.equal(scope.isSystemWide, false)
})

test('a Company Admin asking for an unknown school gets a 404', async () => {
  await assert.rejects(
    () => resolveScope(companyAdmin, 'school_nowhere'),
    error => error instanceof ScopeError && error.status === 404
  )
})

test('a School Admin is pinned to their own school', async () => {
  const scope = await resolveScope(schoolAdmin, undefined)

  assert.equal(scope.schoolId, 'school_alpha')
  assert.equal(scope.schoolName, 'Alpha School')
  assert.equal(scope.isSystemWide, false)
})

test('a School Admin requesting their own school is allowed', async () => {
  const scope = await resolveScope(schoolAdmin, 'school_alpha')

  assert.equal(scope.schoolId, 'school_alpha')
})

test('a School Admin cannot read another school', async () => {
  await assert.rejects(
    () => resolveScope(schoolAdmin, 'school_beta'),
    error => error instanceof ScopeError && error.status === 403
  )
})

test('a School Admin cannot widen the scope to every school', async () => {
  const scope = await resolveScope(schoolAdmin, 'all')

  assert.equal(scope.schoolId, 'school_alpha')
  assert.equal(scope.isSystemWide, false)
})

test('a blank or whitespace school id is treated as no filter', async () => {
  assert.equal((await resolveScope(companyAdmin, '')).schoolId, null)
  assert.equal((await resolveScope(companyAdmin, '   ')).schoolId, null)
  assert.equal((await resolveScope(schoolAdmin, '  ')).schoolId, 'school_alpha')
})

test('role matching tolerates casing and separator differences', async () => {
  const scope = await resolveScope({ role: 'company_admin', schoolId: null }, 'school_beta')

  assert.equal(scope.schoolId, 'school_beta')
})
