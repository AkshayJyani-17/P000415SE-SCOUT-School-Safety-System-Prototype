// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import SchoolAdminStatus from '../components/SchoolAdminStatus'

// SCRUM-42 follow-up. The first fix kept drills out of QuickViewStrip, which
// only the Company Admin sees. The School Admin dashboard uses
// SchoolAdminStatus, which still added each drill into Currently Active and
// Need Response, so a School Admin who ran one test alert saw both go up.

const NOW = new Date().toISOString()

function incident(overrides) {
  return {
    id: 'inc-1',
    incidentNumber: 'INC-0001',
    title: 'Fire in Block A',
    type: 'fire',
    status: 'triggered',
    priority: 'critical',
    createdAt: NOW,
    updatedAt: NOW,
    acknowledgedBy: [],
    isTest: false,
    ...overrides,
  }
}

const REAL = incident({ id: 'real-1' })

const DRILL = incident({
  id: 'drill-1',
  incidentNumber: 'INC-0002',
  title: 'TEST: Fire alert',
  isTest: true,
})

function cardFor(title) {
  return screen.getByText(title).closest('div').parentElement
}

function countFor(title) {
  return cardFor(title).querySelector('.text-2xl').textContent
}

function noteFor(title) {
  const note = cardFor(title).querySelector('.text-amber-700')

  return note ? note.textContent : null
}

afterEach(cleanup)

describe('School Admin dashboard counts and test alerts', () => {
  test('counts a real incident', () => {
    render(<SchoolAdminStatus incidents={[REAL]} />)

    expect(countFor('Currently Active')).toBe('1')
    expect(countFor('Need Response')).toBe('1')
  })

  test('does not count a test alert', () => {
    render(<SchoolAdminStatus incidents={[REAL, DRILL]} />)

    expect(countFor('Currently Active')).toBe('1')
    expect(countFor('Need Response')).toBe('1')
  })

  test('says how many test alerts were left out', () => {
    render(<SchoolAdminStatus incidents={[REAL, DRILL]} />)

    expect(noteFor('Currently Active')).toBe('Plus 1 test alert, not counted')
    expect(noteFor('Need Response')).toBe('Plus 1 test alert, not counted')
  })

  test('uses the plural for more than one test alert', () => {
    const second = { ...DRILL, id: 'drill-2', incidentNumber: 'INC-0003' }
    render(<SchoolAdminStatus incidents={[DRILL, second]} />)

    expect(countFor('Currently Active')).toBe('0')
    expect(noteFor('Currently Active')).toBe('Plus 2 test alerts, not counted')
  })

  test('shows no note when there are no test alerts', () => {
    render(<SchoolAdminStatus incidents={[REAL]} />)

    expect(noteFor('Currently Active')).toBeNull()
    expect(noteFor('Need Response')).toBeNull()
  })

  test('an acknowledged drill is left out of Being Handled', () => {
    const handledDrill = { ...DRILL, status: 'acknowledged', acknowledgedBy: ['staff-1'] }
    render(<SchoolAdminStatus incidents={[handledDrill]} />)

    expect(countFor('Being Handled')).toBe('0')
    expect(noteFor('Being Handled')).toBe('Plus 1 test alert, not counted')
    expect(noteFor('Need Response')).toBeNull()
  })

  test('a resolved drill is left out of Resolved in Last 7 Days', () => {
    const resolvedDrill = { ...DRILL, status: 'resolved' }
    render(<SchoolAdminStatus incidents={[resolvedDrill]} />)

    expect(countFor('Resolved in Last 7 Days')).toBe('0')
    expect(noteFor('Currently Active')).toBeNull()
  })

  test('an incident with no isTest field still counts as real', () => {
    const { isTest: _ignored, ...legacy } = REAL
    render(<SchoolAdminStatus incidents={[legacy]} />)

    expect(countFor('Currently Active')).toBe('1')
  })
})
