const test = require('node:test')
const assert = require('node:assert/strict')

// Mock firebase before requiring the settings route (which pulls in the archiver).
const firebasePath = require.resolve('../src/db/firebase')
const firebaseAdminPath = require.resolve('firebase-admin')

require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: {
    getDb: () => { throw new Error('getDb should not be called in unit tests') },
    docToObject: doc => (doc && doc.exists ? { id: doc.id, ...doc.data() } : null),
    snapshotToArray: snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    formatTimestamp: () => '',
  },
}

require.cache[firebaseAdminPath] = {
  id: firebaseAdminPath,
  filename: firebaseAdminPath,
  loaded: true,
  exports: {
    auth: () => ({
      async verifyIdToken() { throw new Error('not called in unit tests') },
    }),
  },
}

const settingsRoutePath = require.resolve('../src/routes/settings')
delete require.cache[settingsRoutePath]
const { isValidThresholdMinutes } = require('../src/routes/settings')

// isValidThresholdMinutes: valid values

test('accepts the minimum allowed value (1)', () => {
  assert.equal(isValidThresholdMinutes(1), true)
})

test('accepts the maximum allowed value (1440)', () => {
  assert.equal(isValidThresholdMinutes(1440), true)
})

test('accepts a typical value in range', () => {
  assert.equal(isValidThresholdMinutes(30), true)
})

// isValidThresholdMinutes: out of range

test('rejects zero', () => {
  assert.equal(isValidThresholdMinutes(0), false)
})

test('rejects values above 1440', () => {
  assert.equal(isValidThresholdMinutes(1441), false)
})

test('rejects negative values', () => {
  assert.equal(isValidThresholdMinutes(-5), false)
})

// isValidThresholdMinutes: wrong type

test('rejects non-integers', () => {
  assert.equal(isValidThresholdMinutes(15.5), false)
})

test('rejects numeric strings', () => {
  assert.equal(isValidThresholdMinutes('15'), false)
})

test('rejects null (used to clear an override, handled separately)', () => {
  assert.equal(isValidThresholdMinutes(null), false)
})

test('rejects undefined', () => {
  assert.equal(isValidThresholdMinutes(undefined), false)
})
