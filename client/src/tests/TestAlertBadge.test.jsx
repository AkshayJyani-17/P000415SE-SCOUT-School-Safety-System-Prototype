// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import Incidents from '../pages/Incidents'
import IncidentDetail from '../pages/IncidentDetail'

// Alerts sent from the Alert Testing page carry isTest: true. Admins reviewing incidents
// need to see at a glance which ones were drills.
const TEST_INCIDENT = {
  id: 'test-1',
  incidentNumber: 'INC-0009',
  title: 'TEST: Fire alert',
  type: 'fire',
  status: 'triggered',
  priority: 'critical',
  location: 'Alert testing',
  triggeredByName: 'School Admin',
  timestamp: '2026-09-25 09:00',
  createdAt: new Date().toISOString(),
  description: 'Test alert triggered from the Alert Testing page using a quick action.',
  isTest: true,
}

const REAL_INCIDENT = {
  id: 'real-1',
  incidentNumber: 'INC-0010',
  title: 'Fire in Block A',
  type: 'fire',
  status: 'triggered',
  priority: 'critical',
  location: 'Block A',
  triggeredByName: 'Staff Member',
  timestamp: '2026-09-25 09:30',
  createdAt: new Date().toISOString(),
  description: 'Smoke reported near the stairwell.',
  isTest: false,
}

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'admin@school.edu', uid: 'admin-uid' },
    userRole: 'School Admin',
    isSchoolAdmin: true,
    isCompanyAdmin: false,
    isAdmin: true,
    isStaff: false,
    authLoading: false,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({
    schools: [{ id: 'school_north', name: 'North Campus', active: true }],
    schoolsById: new Map(),
    loading: false,
    error: '',
    version: 1,
    refresh: vi.fn(),
    getSchoolName: vi.fn(),
    createSchool: vi.fn(),
    renameSchool: vi.fn(),
    setSchoolActive: vi.fn(),
  }),
}))

const INCIDENTS = [TEST_INCIDENT, REAL_INCIDENT]

vi.mock('../api/client', () => ({
  getIncidents: vi.fn(() => Promise.resolve(INCIDENTS)),
  getIncidentById: vi.fn(id => Promise.resolve(INCIDENTS.find(item => item.id === id) || null)),
  incidentAPI: {
    updateStatus: vi.fn(() => Promise.resolve({})),
    setReviewFlag: vi.fn(() => Promise.resolve({})),
    addReviewComment: vi.fn(() => Promise.resolve({})),
  },
  settingsAPI: { get: vi.fn(() => Promise.resolve({ overdueThresholdMinutes: 15 })) },
  archiveAPI: { list: vi.fn(() => Promise.resolve([])) },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TEST badge on test alerts', () => {
  test('the incident list badges a test alert once, and not a real one', async () => {
    render(<MemoryRouter><Incidents /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText(/TEST: Fire alert/)).toBeInTheDocument())
    expect(screen.getByText(/Fire in Block A/)).toBeInTheDocument()
    // One badge for the one test alert in the list.
    expect(screen.getAllByText('TEST')).toHaveLength(1)
  })

  test('the incident detail page badges a test alert', async () => {
    render(
      <MemoryRouter initialEntries={['/incidents/test-1']}>
        <Routes><Route path="/incidents/:id" element={<IncidentDetail />} /></Routes>
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('TEST')).toBeInTheDocument())
    expect(screen.getByText('TEST')).toHaveAttribute('title', 'Sent from Alert Testing. Not a real emergency.')
  })

  test('the incident detail page shows no badge for a real alert', async () => {
    render(
      <MemoryRouter initialEntries={['/incidents/real-1']}>
        <Routes><Route path="/incidents/:id" element={<IncidentDetail />} /></Routes>
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText(/Fire in Block A/)).toBeInTheDocument())
    expect(screen.queryByText('TEST')).not.toBeInTheDocument()
  })
})
