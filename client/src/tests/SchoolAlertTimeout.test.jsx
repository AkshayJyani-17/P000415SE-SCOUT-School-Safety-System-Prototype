// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import Setup from '../pages/Setup'
import { settingsAPI } from '../api/client'

// Backlog ID 11. The School Admin alert timeout used parseInt, so 7.5 was
// saved as 7 with a "Saved." message, and a blank Save showed an error even
// though the help text says to leave the field blank to use the company default.

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'admin@school.edu' },
    userRole: 'School Admin',
    isCompanyAdmin: false,
    isSchoolAdmin: true,
    isStaff: false,
    isAdmin: true,
    authLoading: false,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({
    schools: [],
    allSchools: [],
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
        overdueThresholdMinutes: 10,
        companyOverdueThresholdMinutes: 15,
        schoolOverdueThresholdMinutes: 10,
        archiveRetentionDays: 30,
      })
    ),
    updateSchoolThreshold: vi.fn(() => Promise.resolve({ success: true })),
    updateArchiveRetention: vi.fn(() => Promise.resolve({ success: true })),
  },
  setupAPI: {
    getAlertTypes: vi.fn(() => Promise.resolve({ alertTypes: [] })),
    getLocations: vi.fn(() => Promise.resolve({ locations: [] })),
    getRouting: vi.fn(() => Promise.resolve({ routing: [] })),
    getSchoolUsers: vi.fn(() => Promise.resolve({ users: [] })),
    updateRouting: vi.fn(),
    updateSchoolUser: vi.fn(),
  },
  archiveAPI: {
    trigger: vi.fn(() => Promise.resolve({ archivedCount: 0 })),
  },
}))

const ERROR = 'Timeout must be a whole number between 1 and 1440 minutes.'

async function renderSetup() {
  render(
    <MemoryRouter>
      <Setup />
    </MemoryRouter>
  )

  const input = await screen.findByPlaceholderText('Company default: 15')
  await waitFor(() => expect(input).toHaveValue(10))

  return input
}

async function saveValue(value) {
  const input = await renderSetup()
  fireEvent.change(input, { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  return input
}

describe('School Admin alert timeout', () => {
  test('saves a whole number of minutes', async () => {
    await saveValue('20')

    await waitFor(() => expect(settingsAPI.updateSchoolThreshold).toHaveBeenCalledWith(20))
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  test('refuses a decimal instead of rounding it down', async () => {
    await saveValue('7.5')

    expect(await screen.findByText(ERROR)).toBeInTheDocument()
    expect(settingsAPI.updateSchoolThreshold).not.toHaveBeenCalled()
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
  })

  test('refuses values outside 1 to 1440', async () => {
    await saveValue('0')
    expect(await screen.findByText(ERROR)).toBeInTheDocument()

    cleanup()
    await saveValue('1441')
    expect(await screen.findByText(ERROR)).toBeInTheDocument()

    expect(settingsAPI.updateSchoolThreshold).not.toHaveBeenCalled()
  })

  test('a blank Save goes back to the company default', async () => {
    await saveValue('')

    await waitFor(() => expect(settingsAPI.updateSchoolThreshold).toHaveBeenCalledWith(null))
    expect(screen.queryByText(ERROR)).not.toBeInTheDocument()
    expect(await screen.findByText(/currently in use/)).toBeInTheDocument()
  })

  test('Reset to company default still clears the override', async () => {
    await renderSetup()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to company default' }))

    await waitFor(() => expect(settingsAPI.updateSchoolThreshold).toHaveBeenCalledWith(null))
  })
})
