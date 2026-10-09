// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Incidents from '../pages/Incidents'

// The delete flow starts from a row icon on the incident list, so these cover
// the entry point rather than the dialog internals (see IncidentDelete.test.jsx).

const RESOLVED = {
  id: 'res-1',
  incidentNumber: 'INC-0007',
  title: 'Duplicate fire report',
  type: 'fire',
  status: 'resolved',
  location: 'Science Block',
  priority: 'high',
  triggeredByName: 'Sam Staff',
  schoolName: 'Alpha High',
  timestamp: '2026-05-12 10:00',
  createdAt: new Date().toISOString(),
  acknowledgedBy: [{ name: 'Riley Principal' }],
}

const LIVE = {
  id: 'live-1',
  incidentNumber: 'INC-0008',
  title: 'Fire alarm sounding',
  type: 'fire',
  status: 'triggered',
  location: 'Block B',
  priority: 'critical',
  triggeredByName: 'Sam Staff',
  schoolName: 'Alpha High',
  timestamp: '2026-05-12 11:00',
  createdAt: new Date().toISOString(),
}

let mockAuth
let mockIncidents

const mockRemove = vi.fn(() => Promise.resolve({ success: true }))
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { email: 'admin@school.edu' }, authLoading: false, ...mockAuth }),
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

vi.mock('../api/client', () => ({
  getIncidents: vi.fn(() => Promise.resolve(mockIncidents)),
  settingsAPI: { get: vi.fn(() => Promise.resolve({ overdueThresholdMinutes: 15 })) },
  archiveAPI: { list: vi.fn(() => Promise.resolve([])) },
  incidentAPI: { remove: (...args) => mockRemove(...args) },
}))

const COMPANY_ADMIN = { userRole: 'Company Admin', isCompanyAdmin: true, isSchoolAdmin: false, isAdmin: true }
const STAFF = { userRole: 'Staff', isCompanyAdmin: false, isSchoolAdmin: false, isAdmin: false }

beforeEach(() => {
  mockAuth = COMPANY_ADMIN
  mockIncidents = [RESOLVED, LIVE]
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderList() {
  render(
    <MemoryRouter>
      <Incidents />
    </MemoryRouter>
  )
  await screen.findByText(/fire alarm sounding/i)
  // The list opens on "Active Incidents", which excludes resolved ones.
  fireEvent.change(screen.getByDisplayValue('Active Incidents'), { target: { value: 'all' } })
  await screen.findByText(/duplicate fire report/i)
}

const deleteButton = label => screen.getByRole('button', { name: new RegExp(`delete ${label}`, 'i') })

describe('Deleting from the incident list', () => {
  test('each row offers a delete action to an admin', async () => {
    await renderList()
    expect(deleteButton('INC-0007')).toBeInTheDocument()
  })

  test('a live incident offers no delete action', async () => {
    await renderList()

    expect(deleteButton('INC-0007')).toBeEnabled()
    expect(screen.queryByRole('button', { name: /delete inc-0008/i })).not.toBeInTheDocument()
  })

  test('an overdue alert nobody acknowledged is deletable from the list', async () => {
    // Exactly the stale junk the delete action exists to clear out.
    mockIncidents = [{
      ...LIVE,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    }]
    render(
      <MemoryRouter>
        <Incidents />
      </MemoryRouter>
    )
    await screen.findByText(/fire alarm sounding/i)

    expect(deleteButton('INC-0008')).toBeInTheDocument()
  })

  test('a test alert is deletable from the list even while triggered', async () => {
    mockIncidents = [{ ...LIVE, isTest: true }]
    render(
      <MemoryRouter>
        <Incidents />
      </MemoryRouter>
    )
    await screen.findByText(/fire alarm sounding/i)

    expect(deleteButton('INC-0008')).toBeInTheDocument()
  })

  test('staff get no delete action on any row', async () => {
    mockAuth = STAFF
    await renderList()

    expect(screen.queryByRole('button', { name: /delete inc-0007/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete inc-0008/i })).not.toBeInTheDocument()
  })

  test('the icon opens the confirmation dialog without opening the incident', async () => {
    await renderList()
    fireEvent.click(deleteButton('INC-0007'))

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/fire · INC-0007/i)).toBeInTheDocument()
    expect(dialog.getByText(/cannot be undone/i)).toBeInTheDocument()
    // The row itself navigates, so the click must not bubble to it.
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('confirming removes the row from the list', async () => {
    await renderList()
    fireEvent.click(deleteButton('INC-0007'))

    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('res-1', {
      reasonCode: 'duplicate',
      reason: '',
    }))
    await waitFor(() => expect(screen.queryByText(/duplicate fire report/i)).not.toBeInTheDocument())
    // The untouched incident stays put.
    expect(screen.getByText(/fire alarm sounding/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('cancelling leaves the list unchanged', async () => {
    await renderList()
    fireEvent.click(deleteButton('INC-0007'))

    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockRemove).not.toHaveBeenCalled()
    expect(screen.getByText(/duplicate fire report/i)).toBeInTheDocument()
  })
})
