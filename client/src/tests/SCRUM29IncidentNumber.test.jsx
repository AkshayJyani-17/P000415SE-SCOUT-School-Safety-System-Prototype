// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
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
    isAdmin: true,
    authLoading: false,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({
    schools: [
      { id: 'school_north', name: 'North Campus', active: true },
    ],
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

vi.mock('../api/client', () => ({
  getIncidents: vi.fn(() =>
    Promise.resolve([
      {
        id: 'incident-1',
        incidentNumber: 'INC001',
        title: 'Incident Number Test',
        type: 'general',
        status: 'triggered',
        location: 'Library',
        priority: 'low',
        triggeredByName: 'Test Staff',
        schoolId: 'school_north',
        schoolName: 'North Campus',
        timestamp: '2026-09-20 10:00',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'incident-2',
        incidentNumber: 'INC002',
        title: 'Testing Incident',
        type: 'general',
        status: 'triggered',
        location: 'Classroom',
        priority: 'medium',
        triggeredByName: 'Test Staff',
        schoolId: 'school_north',
        schoolName: 'North Campus',
        timestamp: '2026-09-20 11:00',
        createdAt: new Date().toISOString(),
      },
    ])
  ),
  settingsAPI: {
    get: vi.fn(() => Promise.resolve({ overdueThresholdMinutes: 15 })),
  },
  archiveAPI: {
    list: vi.fn(() => Promise.resolve([])),
  },
}))

describe('SCRUM-29 - Unique Incident Number', () => {
  test('displays a unique incident number for each incident', async () => {
    render(
      <MemoryRouter>
        <Incidents />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(
        screen.getByText(/INC001.*Incident Number Test/i)
      ).toBeInTheDocument()

      expect(
        screen.getByText(/INC002.*Testing Incident/i)
      ).toBeInTheDocument()
    })
  })

  test('keeps each incident number associated with the correct incident', async () => {
    render(
      <MemoryRouter>
        <Incidents />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(
        screen.getByText(/INC001.*Incident Number Test/i)
      ).toBeInTheDocument()

      expect(
        screen.getByText(/INC002.*Testing Incident/i)
      ).toBeInTheDocument()
    })
  })
})