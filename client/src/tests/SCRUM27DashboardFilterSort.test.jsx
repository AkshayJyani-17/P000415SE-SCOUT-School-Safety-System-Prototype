// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

beforeEach(() => {
  sessionStorage.clear()
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'admin@school.edu' },
    userRole: 'Company Admin',
    isCompanyAdmin: true,
    isSchoolAdmin: false,
    isStaff: false,
    isAdmin: true,
    authLoading: false,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({
    schools: [
      { id: 'school_north', name: 'North Campus', active: true },
      { id: 'school_south', name: 'South Campus', active: true },
    ],
  }),
}))

const todayAt = (hour) => {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}
vi.mock('../api/client', () => ({
  incidentAPI: {
    list: vi.fn(() =>
      Promise.resolve([
        {
          id: '1',
          title: 'North Medical Incident',
          type: 'medical',
          status: 'acknowledged',
          location: 'North Library',
          priority: 'medium',
          schoolId: 'school_north',
          triggeredByName: 'North Staff',
          timestamp: 'Today',
          createdAt: todayAt(9),
        },
        {
          id: '2',
          title: 'South Fire Incident',
          type: 'fire',
          status: 'acknowledged',
          location: 'South Science Block',
          priority: 'critical',
          schoolId: 'school_south',
          triggeredByName: 'South Staff',
          timestamp: 'Today',
          createdAt: todayAt(10),
        },
        {
          id: '3',
          title: 'North Behaviour Incident',
          type: 'behaviour',
          status: 'acknowledged',
          location: 'North Classroom',
          priority: 'high',
          schoolId: 'school_north',
          triggeredByName: 'North Staff',
          timestamp: 'Today',
          createdAt: todayAt(11),
        },
      ])
    ),
  },

  settingsAPI: {
    get: vi.fn(() =>
      Promise.resolve({
        overdueThresholdMinutes: 15,
      })
    ),
  },
}))

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
}

describe('SCRUM-27 - Dashboard School Filter and Sort', () => {
  test('displays All Schools and specific schools in school filter', async () => {
    renderDashboard()

    await screen.findByText(/today's recent incidents/i)

    expect(
      screen.getByRole('option', { name: 'All Schools' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('option', { name: 'North Campus' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('option', { name: 'South Campus' })
    ).toBeInTheDocument()
  })

  test('filters dashboard incidents by selected school', async () => {
    renderDashboard()

    await screen.findByText('North Medical Incident')

    const schoolDropdown = screen.getAllByRole('combobox')[0]

    fireEvent.change(schoolDropdown, {
      target: { value: 'school_north' },
    })

    await waitFor(() => {
      expect(
        screen.getByText('North Medical Incident')
      ).toBeInTheDocument()

      expect(
        screen.getByText('North Behaviour Incident')
      ).toBeInTheDocument()

      expect(
        screen.queryByText('South Fire Incident')
      ).not.toBeInTheDocument()
    })
  })

  test('sorts recent incidents newest first', async () => {
    renderDashboard()

    await screen.findByText('North Medical Incident')

    const sortDropdown = screen.getAllByRole('combobox')[1]

    fireEvent.change(sortDropdown, {
      target: { value: 'newest' },
    })

    const incidents = screen.getAllByText(/Incident$/)

    expect(incidents[0]).toHaveTextContent('North Behaviour Incident')
    expect(incidents[1]).toHaveTextContent('South Fire Incident')
    expect(incidents[2]).toHaveTextContent('North Medical Incident')
  })

  test('sorts recent incidents oldest first', async () => {
    renderDashboard()

    await screen.findByText('North Medical Incident')

    const sortDropdown = screen.getAllByRole('combobox')[1]

    fireEvent.change(sortDropdown, {
      target: { value: 'oldest' },
    })

    const incidents = screen.getAllByText(/Incident$/)

    expect(incidents[0]).toHaveTextContent('North Medical Incident')
    expect(incidents[1]).toHaveTextContent('South Fire Incident')
    expect(incidents[2]).toHaveTextContent('North Behaviour Incident')
  })

  test('sorts recent incidents by priority', async () => {
    renderDashboard()

    await screen.findByText('North Medical Incident')

    const sortDropdown = screen.getAllByRole('combobox')[1]

    fireEvent.change(sortDropdown, {
      target: { value: 'priority' },
    })

    const incidents = screen.getAllByText(/Incident$/)

    expect(incidents[0]).toHaveTextContent('South Fire Incident')
    expect(incidents[1]).toHaveTextContent('North Behaviour Incident')
    expect(incidents[2]).toHaveTextContent('North Medical Incident')
  })
})