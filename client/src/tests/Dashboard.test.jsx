// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard'

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
      { id: 'school-1', name: 'Alpha School' },
      { id: 'school-2', name: 'Beta School' },
      { id: 'school-3', name: 'Gamma School' },
    ],
  }),
}))
vi.mock('../api/client', () => ({
  incidentAPI: {
    list: vi.fn(() =>
      Promise.resolve([
        {
          id: '1',
          title: 'Fire Alert',
          type: 'fire',
          status: 'acknowledged',
          location: 'Science Block',
          priority: 'high',
          timestamp: '2026-05-12 10:00',
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          title: 'Medical Emergency',
          type: 'medical',
          status: 'resolved',
          location: 'Library',
          priority: 'medium',
          timestamp: '2026-05-12 11:00',
          createdAt: new Date().toISOString(),
        },
      ])
    ),
  },
  analyticsAPI: {
    summary: vi.fn(() =>
      Promise.resolve({
        activeIncidents: 1,
        criticalCount: 0,
        highCount: 1,
        avgResponseTime: 4.2,
      })
    ),
  },
  settingsAPI: {
    get: vi.fn(() => Promise.resolve({ overdueThresholdMinutes: 15 })),
  },
  notificationsAPI: {
    list: vi.fn(() => Promise.resolve([])),
  },
}))

describe('Dashboard Page', () => {
  test('renders dashboard heading', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    expect(
      await screen.findByText(/dashboard/i)
    ).toBeInTheDocument()
  })

  test('renders recent incident data', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/fire alert/i)).toBeInTheDocument()
      expect(screen.getByText(/science block/i)).toBeInTheDocument()
    })
  })

  test('renders multiple incident records', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/fire alert/i)).toBeInTheDocument()
      expect(screen.getByText(/medical emergency/i)).toBeInTheDocument()
    })
  })
})
