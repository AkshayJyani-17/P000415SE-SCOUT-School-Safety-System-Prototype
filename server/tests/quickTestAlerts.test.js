const test = require('node:test')
const assert = require('node:assert/strict')

// Test alerts sent from the School Admin Alert Testing page carry isTest: true so a drill
// never distorts a school's reported statistics.
const { excludeTestIncidents, buildAnalyticsFrom } = require('../src/analyticsCache')

const NOW = new Date('2026-09-10T02:00:00Z')

function incident(overrides = {}) {
  return {
    id: 'i1',
    type: 'fire',
    priority: 'critical',
    status: 'triggered',
    location: 'Alert testing',
    schoolId: 'school_alpha',
    createdAt: '2026-09-10T02:00:00Z',
    ...overrides,
  }
}

test('excludeTestIncidents keeps real incidents', () => {
  const real = [incident({ id: '1' }), incident({ id: '2', isTest: false })]
  assert.deepEqual(excludeTestIncidents(real).map(item => item.id), ['1', '2'])
})

test('excludeTestIncidents drops incidents flagged as tests', () => {
  const mixed = [incident({ id: '1' }), incident({ id: '2', isTest: true })]
  assert.deepEqual(excludeTestIncidents(mixed).map(item => item.id), ['1'])
})

test('excludeTestIncidents treats a missing flag as a real incident', () => {
  assert.equal(excludeTestIncidents([incident({ id: '1', isTest: undefined })]).length, 1)
})

test('test alerts are left out of the analytics totals', () => {
  const incidents = [
    incident({ id: '1' }),
    incident({ id: '2', isTest: true }),
    incident({ id: '3', isTest: true }),
  ]

  const result = buildAnalyticsFrom(excludeTestIncidents(incidents), [], { now: NOW })

  assert.equal(result.summary.totalIncidents, 1)
})

test('a school that only ran test alerts reports no incidents', () => {
  const incidents = [incident({ id: '1', isTest: true }), incident({ id: '2', isTest: true })]

  const result = buildAnalyticsFrom(excludeTestIncidents(incidents), [], { now: NOW })

  assert.equal(result.summary.totalIncidents, 0)
  assert.deepEqual(result.incidentsByType, [])
})
