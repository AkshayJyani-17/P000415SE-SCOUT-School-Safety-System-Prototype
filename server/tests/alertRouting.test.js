const test = require('node:test')
const assert = require('node:assert/strict')

const { alertTypeKey, findSchoolRoutingRule } = require('../src/services/alertRouting')

// SCRUM-38. The preview and the real send used to look the alert type name up
// in different ways. The preview ignored capital letters, the send needed an
// exact match, so the preview could list people the send would never reach.
// Both now go through findSchoolRoutingRule, and these tests pin down the
// behaviour they share.

// Minimal stand in for the Firestore calls the lookup makes.
function fakeDb(routingDocs) {
  return {
    collection() {
      return {
        where(field, op, value) {
          const matches = routingDocs.filter(doc => doc[field] === value)
          return {
            async get() {
              return { docs: matches.map(doc => ({ data: () => doc })) }
            },
          }
        },
      }
    },
  }
}

const WARDEN = { name: 'Fire Warden', email: 'warden@alpha.edu' }

test('alertTypeKey ignores capitals, spaces and surrounding whitespace', () => {
  assert.equal(alertTypeKey('Fire'), 'fire')
  assert.equal(alertTypeKey('FIRE'), 'fire')
  assert.equal(alertTypeKey('  Fire  '), 'fire')
  assert.equal(alertTypeKey('Natural Disaster'), 'natural_disaster')
  assert.equal(alertTypeKey('natural_disaster'), 'natural_disaster')
})

test('alertTypeKey copes with a missing name', () => {
  assert.equal(alertTypeKey(undefined), '')
  assert.equal(alertTypeKey(null), '')
})

test('the label and the slug find the same saved list', async () => {
  const db = fakeDb([
    { schoolId: 'school_alpha', alertType: 'Natural Disaster', active: true, recipients: [WARDEN] },
  ])

  // The real send passes the label, the preview passes the slug.
  const fromLabel = await findSchoolRoutingRule(db, 'school_alpha', 'Natural Disaster')
  const fromSlug = await findSchoolRoutingRule(db, 'school_alpha', 'natural_disaster')

  assert.equal(fromLabel.recipients[0].email, WARDEN.email)
  assert.equal(fromSlug.recipients[0].email, WARDEN.email)
})

test('a saved list is still found when only the capitals differ', async () => {
  const db = fakeDb([
    { schoolId: 'school_alpha', alertType: 'Fire', active: true, recipients: [WARDEN] },
  ])

  // This is the bug. The send used to miss this because it matched exactly.
  const rule = await findSchoolRoutingRule(db, 'school_alpha', 'FIRE')

  assert.ok(rule, 'FIRE should match a list saved as Fire')
  assert.equal(rule.recipients[0].email, WARDEN.email)
})

test('a saved list with no active field still counts as active', async () => {
  const db = fakeDb([
    { schoolId: 'school_alpha', alertType: 'Fire', recipients: [WARDEN] },
  ])

  // The send used to require active to be exactly true, so older lists saved
  // without the field were skipped while the preview still showed them.
  const rule = await findSchoolRoutingRule(db, 'school_alpha', 'Fire')

  assert.ok(rule, 'a list without an active field should be used')
})

test('a switched off list is ignored', async () => {
  const db = fakeDb([
    { schoolId: 'school_alpha', alertType: 'Fire', active: false, recipients: [WARDEN] },
  ])

  assert.equal(await findSchoolRoutingRule(db, 'school_alpha', 'Fire'), null)
})

test('another school list is never used', async () => {
  const db = fakeDb([
    { schoolId: 'school_beta', alertType: 'Fire', active: true, recipients: [WARDEN] },
  ])

  assert.equal(await findSchoolRoutingRule(db, 'school_alpha', 'Fire'), null)
})

test('a different alert type is never used', async () => {
  const db = fakeDb([
    { schoolId: 'school_alpha', alertType: 'Medical', active: true, recipients: [WARDEN] },
  ])

  assert.equal(await findSchoolRoutingRule(db, 'school_alpha', 'Fire'), null)
})

test('nothing is looked up without a school or an alert type', async () => {
  const db = fakeDb([
    { schoolId: 'school_alpha', alertType: 'Fire', active: true, recipients: [WARDEN] },
  ])

  assert.equal(await findSchoolRoutingRule(db, null, 'Fire'), null)
  assert.equal(await findSchoolRoutingRule(db, 'school_alpha', ''), null)
})
