
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Incidents from '../pages/Incidents'

afterEach(() => {
  cleanup()
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
      { id: 'school_alpha', name: 'Alpha School', active: true },
      { id: 'school_beta', name: 'Beta School', active: true },
      { id: 'school_gamma', name: 'Gamma School', active: true },
    ],
    schoolsById: new Map(),
    loading: false,
    error: '',
    version: 1,
    refresh: vi.fn(),
    getSchoolName: vi.fn(),
  }),
}))

vi.mock('../api/client', () => ({
  getIncidents: vi.fn(() =>
    Promise.resolve([
      {
        id: '1',
        title: 'Alpha Fire Alert',
        type: 'fire',
        status: 'triggered',
        priority: 'high',
        location: 'Library',
        schoolId: 'school_alpha',
        schoolName: 'Alpha School',
        triggeredByName: 'Staff',
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        title: 'Beta Medical Alert',
        type: 'medical',
        status: 'acknowledged',
        priority: 'critical',
        location: 'Classroom',
        schoolId: 'school_beta',
        schoolName: 'Beta School',
        triggeredByName: 'Staff',
        createdAt: new Date().toISOString(),
      },
      {
        id: '3',
        title: 'Gamma Lockdown Alert',
        type: 'lockdown',
        status: 'triggered',
        priority: 'high',
        location: 'Main Building',
        schoolId: 'school_gamma',
        schoolName: 'Gamma School',
        triggeredByName: 'Staff',
        createdAt: new Date().toISOString(),
      },
    ])
  ),
  settingsAPI: {
    get: vi.fn(() =>
      Promise.resolve({ overdueThresholdMinutes: 15 })
    ),
  },
  archiveAPI: {
    list: vi.fn(() => Promise.resolve([])),
  },
}))

function renderIncidents() {
  return render(
    <MemoryRouter>
      <Incidents />
    </MemoryRouter>
  )
}

function getSchoolDropdown() {
  return screen.getAllByRole('combobox')[3]
}
describe('SCRUM-28 - Incident School Filter', () => {
  test('shows All Schools as the default source', async () => {
    renderIncidents()

    expect(
      await screen.findByText(/showing incidents from:/i)
    ).toHaveTextContent('All Schools')
  })

  test('filters incidents by Alpha School', async () => {
    renderIncidents()

    await screen.findByText('Alpha Fire Alert')

    fireEvent.change(getSchoolDropdown(), {
      target: { value: 'school_alpha' },
    })

    await waitFor(() => {
      expect(screen.getByText('Alpha Fire Alert')).toBeInTheDocument()
      expect(screen.queryByText('Beta Medical Alert')).not.toBeInTheDocument()
      expect(screen.queryByText('Gamma Lockdown Alert')).not.toBeInTheDocument()
      expect(screen.getByText(/1 active incident$/i)).toBeInTheDocument()
    })
  })

  test('filters incidents by Beta School', async () => {
    renderIncidents()

    await screen.findByText('Alpha Fire Alert')

    fireEvent.change(getSchoolDropdown(), {
      target: { value: 'school_beta' },
    })

    await waitFor(() => {
      expect(screen.getByText('Beta Medical Alert')).toBeInTheDocument()
      expect(screen.queryByText('Alpha Fire Alert')).not.toBeInTheDocument()
      expect(screen.queryByText('Gamma Lockdown Alert')).not.toBeInTheDocument()
    })
  })

  test('filters incidents by Gamma School', async () => {
    renderIncidents()

    await screen.findByText('Alpha Fire Alert')

    fireEvent.change(getSchoolDropdown(), {
      target: { value: 'school_gamma' },
    })

    await waitFor(() => {
      expect(screen.getByText('Gamma Lockdown Alert')).toBeInTheDocument()
      expect(screen.queryByText('Alpha Fire Alert')).not.toBeInTheDocument()
      expect(screen.queryByText('Beta Medical Alert')).not.toBeInTheDocument()
    })
  })

  test('restores all incidents when All Schools is selected', async () => {
    renderIncidents()

    await screen.findByText('Alpha Fire Alert')

    fireEvent.change(getSchoolDropdown(), {
      target: { value: 'school_alpha' },
    })

    fireEvent.change(getSchoolDropdown(), {
      target: { value: 'all' },
    })

    await waitFor(() => {
      expect(screen.getByText('Alpha Fire Alert')).toBeInTheDocument()
      expect(screen.getByText('Beta Medical Alert')).toBeInTheDocument()
      expect(screen.getByText('Gamma Lockdown Alert')).toBeInTheDocument()
      expect(screen.getByText(/3 active incidents/i)).toBeInTheDocument()
    })
  })


    test('sorts incidents alphabetically by school when All Schools is selected', async () => {
        renderIncidents()

        await screen.findByText('Alpha Fire Alert')

        const alpha = screen.getByText('Alpha Fire Alert')
        const beta = screen.getByText('Beta Medical Alert')
        const gamma = screen.getByText('Gamma Lockdown Alert')

        expect(
            alpha.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()

        expect(
            beta.compareDocumentPosition(gamma) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
    })
})
