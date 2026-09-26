// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import Setup from '../pages/Setup'
import SchoolManagement from '../pages/SchoolManagement'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')

  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'schooladmin@school.edu' },
    userRole: 'School Admin',
    isCompanyAdmin: false,
    isSchoolAdmin: true,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({
    allSchools: [],
    loading: false,
    error: null,
    createSchool: vi.fn(),
    renameSchool: vi.fn(),
    setSchoolActive: vi.fn(),
  }),
}))

// Mirrors what a Company Admin has configured, including general types and a
// duplicate label that differs only by casing.
const ALERT_TYPES = [
  { id: '1', label: 'Fire', emoji: '🔥', category: 'emergency' },
  { id: '2', label: 'Lockdown', emoji: '🔒', category: 'emergency' },
  { id: '3', label: 'Natural Disaster', emoji: '🌊', category: 'emergency' },
  { id: '4', label: 'Medical', emoji: '🏥', category: 'general' },
  { id: '5', label: 'Behaviour', emoji: '⚠️', category: 'general' },
  { id: '6', label: 'Weather', emoji: '🌩️', category: 'general' },
  { id: '7', label: 'Maintenance', emoji: '🔧', category: 'general' },
  { id: '8', label: 'General', emoji: '📢', category: 'general' },
  { id: '9', label: 'Threat', emoji: '🛡️', category: 'emergency' },
  { id: '10', label: 'fire', emoji: '🔥', category: 'emergency' },
]

const getAlertTypes = vi.fn(() => Promise.resolve({ alertTypes: ALERT_TYPES }))

vi.mock('../api/client', () => ({
  settingsAPI: { get: vi.fn(() => Promise.resolve({})) },
  archiveAPI: { run: vi.fn(() => Promise.resolve({})) },
  setupAPI: {
    getAlertTypes: (...args) => getAlertTypes(...args),
    getLocations: vi.fn(() => Promise.resolve({ locations: [] })),
    getRouting: vi.fn(() => Promise.resolve({ routing: [] })),
    getSchoolUsers: vi.fn(() => Promise.resolve({ users: [] })),
    updateRouting: vi.fn(() => Promise.resolve({})),
    updateUserPhone: vi.fn(() => Promise.resolve({})),
  },
}))

// Option labels render as "<emoji> <label>", so match on the trailing label.
const optionNamed = label => new RegExp(`${label}$`)

async function openDropdown() {
  render(<Setup />)
  const trigger = await screen.findByRole('button', { name: /emergency type/i })
  fireEvent.click(trigger)
  return within(await screen.findByRole('listbox'))
}

describe('School Admin emergency type dropdown', () => {
  test('requests every alert type, not only the emergency category', async () => {
    render(<Setup />)
    await waitFor(() => expect(getAlertTypes).toHaveBeenCalled())
    expect(getAlertTypes).toHaveBeenCalledWith()
  })

  test('lists every configured type, grouped by category', async () => {
    const list = await openDropdown()

    expect(list.getByText('Emergency Types')).toBeInTheDocument()
    expect(list.getByText('General Types')).toBeInTheDocument()

    const labels = ['Fire', 'Lockdown', 'Natural Disaster', 'Threat', 'Medical', 'Behaviour', 'Weather', 'Maintenance', 'General']
    for (const label of labels) {
      expect(list.getByRole('option', { name: optionNamed(label) })).toBeInTheDocument()
    }
    expect(list.getAllByRole('option')).toHaveLength(labels.length)
  })

  test('drops duplicate labels that differ only by case', async () => {
    const list = await openDropdown()
    expect(list.getAllByRole('option', { name: /fire$/i })).toHaveLength(1)
  })

  test('is searchable when many types exist', async () => {
    const list = await openDropdown()
    const search = screen.getByLabelText(/search alert types/i)

    fireEvent.change(search, { target: { value: 'lock' } })

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option', { name: /lockdown$/i })).toBeInTheDocument()
    expect(list.queryByRole('option', { name: /medical$/i })).not.toBeInTheDocument()
  })

  test('selecting a type opens its recipient panel', async () => {
    await openDropdown()
    fireEvent.click(screen.getByRole('option', { name: /natural disaster$/i }))

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { name: 'Natural Disaster' })).toBeInTheDocument()
  })
})

describe('PBI 3 school management page', () => {
  test('shows school management on its own page', () => {
    render(<SchoolManagement />)

    expect(screen.getByRole('heading', { name: /school management/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/school name/i)).toBeInTheDocument()
  })
})
