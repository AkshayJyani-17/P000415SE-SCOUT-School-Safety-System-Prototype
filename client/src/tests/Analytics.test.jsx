// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Analytics from '../pages/Analytics'

const mocks = vi.hoisted(() => ({
  auth: {},
  schools: [],
  all: vi.fn(),
  trends: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({ schools: mocks.schools, loading: false, error: '' }),
}))

vi.mock('../api/client', () => ({
  analyticsAPI: {
    all: (...args) => mocks.all(...args),
    trends: (...args) => mocks.trends(...args),
  },
}))

const SUMMARY = {
  totalIncidents: 42,
  resolvedCount: 30,
  thisWeekIncidents: 7,
  avgResponseTime: 12,
  unacknowledgedCount: 5,
}

function analyticsPayload(overrides = {}) {
  return {
    summary: { ...SUMMARY, ...(overrides.summary || {}) },
    incidentsByType: [{ type: 'Medical', count: 12 }],
    statusBreakdown: [{ name: 'Resolved', value: 30 }],
    locationData: [{ location: 'Oval', count: 9 }],
    incidentsByPriority: [{ priority: 'Critical', count: 3 }],
    failedAlerts: { total: 2, sms: 1, email: 1 },
    scope: { schoolId: null, schoolName: null, isSystemWide: true },
    ...overrides,
  }
}

function trendsPayload() {
  return {
    incidentsByPeriod: [{ label: 'Mon 1 Sep', count: 3 }],
    incidentsByDayOfWeek: [{ day: 'Mon', count: 3 }],
    incidentsByHour: [{ hour: '09:00', count: 3 }],
    totalInRange: 3,
    range: 'week',
  }
}

function asCompanyAdmin() {
  mocks.auth = {
    currentUser: { email: 'admin@scout.edu' },
    userRole: 'Company Admin',
    userSchoolId: null,
    userSchoolName: null,
    isAdmin: true,
    isCompanyAdmin: true,
    isSchoolAdmin: false,
    isStaff: false,
    authLoading: false,
  }
}

function asSchoolAdmin() {
  mocks.auth = {
    currentUser: { email: 'principal@school.edu' },
    userRole: 'School Admin',
    userSchoolId: 'school_northvale',
    userSchoolName: 'Northvale College',
    isAdmin: true,
    isCompanyAdmin: false,
    isSchoolAdmin: true,
    isStaff: false,
    authLoading: false,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Analytics />
    </MemoryRouter>
  )
}

beforeEach(() => {
  mocks.schools = [
    { id: 'school_northvale', name: 'Northvale College', active: true },
    { id: 'school_riverside', name: 'Riverside High', active: true },
  ]
  mocks.all.mockReset()
  mocks.trends.mockReset()
  mocks.all.mockResolvedValue(analyticsPayload())
  mocks.trends.mockResolvedValue(trendsPayload())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Analytics page access', () => {
  test('a Company Admin can open the page', async () => {
    asCompanyAdmin()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
  })

  test('a School Admin can open the page', async () => {
    asSchoolAdmin()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
  })
})

describe('Analytics summary', () => {
  test('renders the figures returned by the API', async () => {
    asCompanyAdmin()
    renderPage()

    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('12 min')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  test('shows an em dash rather than 0 when nothing has been acknowledged', async () => {
    asCompanyAdmin()
    mocks.all.mockResolvedValue(analyticsPayload({ summary: { avgResponseTime: 0 } }))
    renderPage()

    expect(await screen.findByText('—')).toBeInTheDocument()
  })

  test('keeps the previous figures visible when a refresh fails', async () => {
    asCompanyAdmin()
    renderPage()

    await screen.findByText('42')

    mocks.all.mockRejectedValue(new Error('network down'))
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(await screen.findByText(/refresh failed/i)).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })
})

describe('School filtering', () => {
  test('a Company Admin gets a school filter listing every school', async () => {
    asCompanyAdmin()
    renderPage()

    const filter = await screen.findByLabelText('Filter analytics by school')
    expect(filter).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'All schools' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Northvale College' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Riverside High' })).toBeInTheDocument()
  })

  test('defaults to every school and sends no school id', async () => {
    asCompanyAdmin()
    renderPage()

    await screen.findByRole('heading', { name: 'Analytics' })

    expect(mocks.all).toHaveBeenCalledWith(null)
    expect(mocks.trends).toHaveBeenCalledWith('week', null)
    expect(await screen.findByText(/figures below cover every school/i)).toBeInTheDocument()
  })

  test('selecting a school refetches both the summary and the trends for it', async () => {
    asCompanyAdmin()
    renderPage()

    const filter = await screen.findByLabelText('Filter analytics by school')
    mocks.all.mockClear()
    mocks.trends.mockClear()

    fireEvent.change(filter, { target: { value: 'school_riverside' } })

    await waitFor(() => {
      expect(mocks.all).toHaveBeenCalledWith('school_riverside')
      expect(mocks.trends).toHaveBeenCalledWith('week', 'school_riverside')
    })

    expect(await screen.findByText(/Scoped to Riverside High/)).toBeInTheDocument()
  })

  test('a School Admin gets no filter and stays scoped to their own school', async () => {
    asSchoolAdmin()
    renderPage()

    await screen.findByRole('heading', { name: 'Analytics' })

    expect(screen.queryByLabelText('Filter analytics by school')).not.toBeInTheDocument()
    expect(mocks.all).toHaveBeenCalledWith(null)
    expect(await screen.findByText(/Scoped to Northvale College/)).toBeInTheDocument()
  })
})

describe('Trend range', () => {
  test('changing the range refetches the trends without refetching the summary', async () => {
    asCompanyAdmin()
    renderPage()

    const rangeSelect = await screen.findByLabelText('Trend date range')
    mocks.all.mockClear()
    mocks.trends.mockClear()

    fireEvent.change(rangeSelect, { target: { value: 'quarter' } })

    await waitFor(() => expect(mocks.trends).toHaveBeenCalledWith('quarter', null))
    expect(mocks.all).not.toHaveBeenCalled()
  })
})
