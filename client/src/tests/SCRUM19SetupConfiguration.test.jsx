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
import Setup from '../pages/Setup'
import { settingsAPI } from '../api/client'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

let mockIsCompanyAdmin = false
let mockIsSchoolAdmin = true

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'admin@school.edu' },
    userRole: mockIsCompanyAdmin ? 'Company Admin' : 'School Admin',
    isCompanyAdmin: mockIsCompanyAdmin,
    isSchoolAdmin: mockIsSchoolAdmin,
    isStaff: false,
    isAdmin: true,
    authLoading: false,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({
    schools: [
      {
        id: 'school_north',
        name: 'North Campus',
        active: true,
      },
    ],
        allSchools: [
      {
        id: 'school_north',
        name: 'North Campus',
        active: true,
      },
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
  settingsAPI: {
    get: vi.fn(() =>
      Promise.resolve({
        overdueThresholdMinutes: 15,
        companyOverdueThresholdMinutes: 15,
        schoolOverdueThresholdMinutes: null,
        archiveRetentionDays: 30,
      })
    ),

    updateSchoolThreshold: vi.fn(() =>
      Promise.resolve({
        success: true,
      })
    ),

    updateArchiveRetention: vi.fn(() =>
      Promise.resolve({
        success: true,
        archiveRetentionDays: 25,
      })
    ),
  },

  setupAPI: {
    getAlertTypes: vi.fn(() =>
      Promise.resolve({
        alertTypes: [],
      })
    ),

    getLocations: vi.fn(() =>
      Promise.resolve({
        locations: [],
      })
    ),

    getRouting: vi.fn(() =>
      Promise.resolve({
        routing: [],
      })
    ),

    getSchoolUsers: vi.fn(() =>
      Promise.resolve({
        users: [],
      })
    ),

    createAlertType: vi.fn(),
    updateAlertType: vi.fn(),
    deleteAlertType: vi.fn(),

    createLocation: vi.fn(),
    updateLocation: vi.fn(),
    deleteLocation: vi.fn(),

    updateRouting: vi.fn(),
    updateSchoolUser: vi.fn(),
  },

  archiveAPI: {
    trigger: vi.fn(() =>
      Promise.resolve({
        archivedCount: 0,
      })
    ),
  },
}))

function renderSetup() {
  return render(
    <MemoryRouter>
      <Setup />
    </MemoryRouter>
  )
}

describe('SCRUM-19 - Remove System-wide Configuration', () => {
  test('does not display System-wide Configuration for Company Admin', async () => {
    mockIsCompanyAdmin = true
    mockIsSchoolAdmin = false

    renderSetup()

    await waitFor(() => {
      expect(settingsAPI.get).toHaveBeenCalled()
    })

    expect(
      screen.queryByText(/system-wide configuration/i)
    ).not.toBeInTheDocument()
  })

  test('displays resolved incident retention period for School Admin', async () => {
    mockIsCompanyAdmin = false
    mockIsSchoolAdmin = true

    renderSetup()

    expect(
      await screen.findByText(/resolved incident retention period \(days\)/i)
    ).toBeInTheDocument()

    expect(
      screen.getByDisplayValue('30')
    ).toBeInTheDocument()
  })

  test('School Admin can save a new retention period', async () => {
    mockIsCompanyAdmin = false
    mockIsSchoolAdmin = true

    renderSetup()

    const retentionInput = await screen.findByDisplayValue('30')

    fireEvent.change(retentionInput, {
      target: {
        value: '25',
      },
    })

    expect(retentionInput).toHaveValue(25)

    fireEvent.click(
      screen.getByRole('button', {
        name: /save retention period/i,
      })
    )

    await waitFor(() => {
      expect(
        settingsAPI.updateArchiveRetention
      ).toHaveBeenCalledWith(25)
    })
  })

  test('shows success message after retention period is saved', async () => {
    mockIsCompanyAdmin = false
    mockIsSchoolAdmin = true

    renderSetup()

    const retentionInput = await screen.findByDisplayValue('30')

    fireEvent.change(retentionInput, {
      target: {
        value: '25',
      },
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: /save retention period/i,
      })
    )

    expect(
      await screen.findByText(/settings saved/i)
    ).toBeInTheDocument()
  })
})