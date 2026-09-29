const test = require('node:test')
const assert = require('node:assert/strict')
const { watchIncidents } = require('../src/incidentStream')
function fixture() {
  const listeners = []
  const collection = { where: (...filter) => ({ onSnapshot: (data, error) => { const item = { filter, data, error, stopped: false }; listeners.push(item); return () => { item.stopped = true } } }) }
  return { db: { collection: () => collection }, listeners }
}
const snapshot = records => ({ docs: records.map(record => ({ id: record.id, data: () => record })) })
test('staff scope merges submitted and assigned snapshots, removes records, and cleans up', () => {
  const { db, listeners } = fixture()
  let latest
  const stop = watchIncidents(db, { uid: 'u1', email: 'staff@example.com', role: 'Staff' }, data => { latest = data }, () => {})
  assert.deepEqual(listeners.map(item => item.filter), [['triggeredById', '==', 'u1'], ['assignedUserIds', 'array-contains', 'u1'], ['assignedUserEmails', 'array-contains', 'staff@example.com']])
  listeners[0].data(snapshot([{ id: '1', status: 'triggered' }]))
  assert.equal(latest, undefined)
  listeners[1].data(snapshot([{ id: '1', status: 'triggered' }]))
  listeners[2].data(snapshot([]))
  assert.equal(latest.length, 1)
  listeners[0].data(snapshot([]))
  assert.equal(latest.length, 1)
  listeners[1].data(snapshot([{ id: '1', status: 'resolved' }]))
  assert.equal(latest[0].status, 'resolved')
  listeners[1].data(snapshot([]))
  assert.deepEqual(latest, [])
  stop()
  assert.ok(listeners.every(item => item.stopped))
})
test('school administrator stream is school scoped', () => {
  const { db, listeners } = fixture()
  watchIncidents(db, { role: 'School Admin', schoolId: 'school1' }, () => {}, () => {})
  assert.deepEqual(listeners[0].filter, ['schoolId', '==', 'school1'])
})
