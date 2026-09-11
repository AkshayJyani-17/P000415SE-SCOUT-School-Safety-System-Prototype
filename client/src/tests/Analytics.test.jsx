// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Analytics from '../pages/Analytics'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'admin@school.edu' },
    userRole: 'Company Admin',
    isAdmin: true,
    isCompanyAdmin: true,
    isSchoolAdmin: false,
    isStaff: false,
    authLoading: false,
  }),
}))

vi.mock('../api/client', () => ({
  analyticsAPI: {
    all: vi.fn(() =>
      Promise.resolve({
        summary: {
          totalIncidents: 10,
          resolvedCount: 7,
          avgResponseTime: 5,
          thisWeekIncidents: 3,
        },
        incidentsByType: [],
        statusData: [],
        responseTimeData: [],
        locationData: [],
        incidentsByDay: [],
      })
    ),
  },
}))

describe('Analytics Page', () => {
  test('renders analytics component without crashing', () => {
    render(
      <MemoryRouter>
        <Analytics />
      </MemoryRouter>
    )

    expect(document.body).toBeInTheDocument()
  })

  test('analytics api mock is configured', async () => {
    const { analyticsAPI } = await import('../api/client')

    expect(analyticsAPI.all).toBeDefined()
  })
})
