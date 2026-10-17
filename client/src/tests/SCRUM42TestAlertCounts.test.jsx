// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import QuickViewStrip from '../components/QuickViewStrip'

// SCRUM-42. Drills used to be added into the dashboard count boxes, so firing
// three test alerts pushed Active Incidents, the critical figure,
// Unacknowledged and Incidents Created Today up by three each. Analytics
// already leaves drills out, through excludeTestIncidents, so the two screens
// reported different numbers for the same day.

const TODAY = new Date().toISOString()

function incident(overrides) {
  return {
    id: 'inc-1',
    incidentNumber: 'INC-0001',
    title: 'Fire in Block A',
    type: 'fire',
    status: 'triggered',
    priority: 'critical',
    createdAt: TODAY,
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

// The counts are rendered as the only large numbers on each card, so each one
// is read from its own card rather than from the whole strip.
function countFor(title) {
  const heading = screen.getByText(title)
  const card = heading.closest('div').parentElement

  return card.querySelector('.text-3xl').textContent
}

function noteFor(title) {
  const heading = screen.getByText(title)
  const card = heading.closest('div').parentElement
  const note = card.querySelector('.text-amber-700')

  return note ? note.textContent : null
}

afterEach(cleanup)

describe('dashboard counts and test alerts', () => {
  test('counts a real incident', () => {
    render(<QuickViewStrip incidents={[REAL]} />)

    expect(countFor('Active Incidents')).toBe('1')
    expect(countFor('Unacknowledged')).toBe('1')
    expect(countFor('Incidents Created Today')).toBe('1')
    expect(screen.getByText('1 critical')).toBeInTheDocument()
  })

  test('does not count a test alert as a real incident', () => {
    // This is the bug. All three of these used to read 1.
    render(<QuickViewStrip incidents={[DRILL]} />)

    expect(countFor('Active Incidents')).toBe('0')
    expect(countFor('Unacknowledged')).toBe('0')
    expect(countFor('Incidents Created Today')).toBe('0')
  })

  test('a test alert does not add to the critical figure', () => {
    render(<QuickViewStrip incidents={[REAL, DRILL]} />)

    expect(screen.getByText('1 critical')).toBeInTheDocument()
  })

  test('three drills leave the real counts alone', () => {
    const drills = [
      { ...DRILL, id: 'drill-1' },
      { ...DRILL, id: 'drill-2' },
      { ...DRILL, id: 'drill-3' },
    ]

    render(<QuickViewStrip incidents={[REAL, ...drills]} />)

    expect(countFor('Active Incidents')).toBe('1')
    expect(countFor('Unacknowledged')).toBe('1')
    expect(countFor('Incidents Created Today')).toBe('1')
  })

  test('says how many test alerts were left out', () => {
    render(<QuickViewStrip incidents={[REAL, DRILL]} />)

    expect(noteFor('Active Incidents')).toBe('Plus 1 test alert, not counted')
    expect(noteFor('Incidents Created Today')).toBe('Plus 1 test alert, not counted')
  })

  test('uses the plural for more than one test alert', () => {
    render(<QuickViewStrip incidents={[{ ...DRILL, id: 'd1' }, { ...DRILL, id: 'd2' }]} />)

    expect(noteFor('Active Incidents')).toBe('Plus 2 test alerts, not counted')
  })

  test('shows no note at all when there are no test alerts', () => {
    render(<QuickViewStrip incidents={[REAL]} />)

    expect(noteFor('Active Incidents')).toBe(null)
    expect(noteFor('Unacknowledged')).toBe(null)
    expect(noteFor('Incidents Created Today')).toBe(null)
  })

  test('a resolved drill is not reported as an active test alert', () => {
    render(<QuickViewStrip incidents={[REAL, { ...DRILL, status: 'resolved' }]} />)

    // It is not active, so there is nothing to say it was left out of Active
    // Incidents. It was still created today.
    expect(noteFor('Active Incidents')).toBe(null)
    expect(noteFor('Incidents Created Today')).toBe('Plus 1 test alert, not counted')
  })

  test('an acknowledged drill is not reported as unacknowledged', () => {
    render(<QuickViewStrip incidents={[{ ...DRILL, status: 'acknowledged' }]} />)

    expect(noteFor('Active Incidents')).toBe('Plus 1 test alert, not counted')
    expect(noteFor('Unacknowledged')).toBe(null)
  })

  test('an incident with no isTest field still counts as real', () => {
    // Records saved before the Alert Testing page existed have no isTest field.
    const older = { ...REAL }
    delete older.isTest

    render(<QuickViewStrip incidents={[older]} />)

    expect(countFor('Active Incidents')).toBe('1')
  })

  test('resolved and archived incidents are still left out of the active count', () => {
    render(<QuickViewStrip incidents={[
      REAL,
      { ...REAL, id: 'real-2', status: 'resolved' },
      { ...REAL, id: 'real-3', status: 'archived' },
    ]} />)

    // This was already correct and must stay that way.
    expect(countFor('Active Incidents')).toBe('1')
    expect(countFor('Incidents Created Today')).toBe('3')
  })

  test('the explanation says test alerts are left out', () => {
    render(<QuickViewStrip incidents={[REAL]} />)

    expect(
      screen.getByLabelText(/Active Incidents:.*Test alerts are left out/s)
    ).toBeInTheDocument()
  })
})
