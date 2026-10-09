// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import IncidentDetail from '../pages/IncidentDetail'

const RESOLVED_INCIDENT = {
  id: '1',
  title: 'Duplicate fire report',
  type: 'fire',
  incidentNumber: 'INC-0007',
  status: 'resolved',
  location: 'Science Block',
  description: 'Reported twice by mistake',
  priority: 'high',
  schoolName: 'Alpha High',
  timestamp: '2026-05-12 10:00',
  createdAt: new Date().toISOString(),
  acknowledgedBy: [{ name: 'Riley Principal' }, { name: 'Sam Teacher' }],
  notifications: [{ recipientName: 'Riley Principal' }, { recipientName: 'Sam Teacher' }],
}

// The auth role and the incident under test are swapped per test. The mock
// factories close over these, so they read whatever the test last set.
let mockAuth
let mockIncident

const mockNavigate = vi.fn()
const mockRemove = vi.fn(() => Promise.resolve({ success: true, id: '1' }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ id: '1' }), useNavigate: () => mockNavigate }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { email: 'admin@school.edu' }, authLoading: false, ...mockAuth }),
}))

vi.mock('../api/client', () => ({
  getIncidentById: vi.fn(() => Promise.resolve(mockIncident)),
  settingsAPI: { get: vi.fn(() => Promise.resolve({ overdueThresholdMinutes: 15 })) },
  incidentAPI: {
    remove: (...args) => mockRemove(...args),
    updateStatus: vi.fn(() => Promise.resolve({})),
    setReviewFlag: vi.fn(() => Promise.resolve({})),
    addReviewComment: vi.fn(() => Promise.resolve({})),
  },
}))

const COMPANY_ADMIN = { userRole: 'Company Admin', isCompanyAdmin: true, isSchoolAdmin: false, isAdmin: true }
const STAFF = { userRole: 'Staff', isCompanyAdmin: false, isSchoolAdmin: false, isAdmin: false }

beforeEach(() => {
  mockAuth = COMPANY_ADMIN
  mockIncident = RESOLVED_INCIDENT
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderPage() {
  render(
    <MemoryRouter>
      <IncidentDetail />
    </MemoryRouter>
  )
  await screen.findByText(/duplicate fire report/i)
}

async function openDialog() {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: /^delete incident$/i }))
  return within(await screen.findByRole('dialog'))
}

describe('Incident deletion: availability', () => {
  test('an admin sees the delete action on a resolved incident', async () => {
    await renderPage()
    expect(screen.getByRole('button', { name: /^delete incident$/i })).toBeInTheDocument()
  })

  test('a live incident cannot be deleted and explains why', async () => {
    mockIncident = { ...RESOLVED_INCIDENT, status: 'triggered' }
    await renderPage()

    expect(screen.queryByRole('button', { name: /^delete incident$/i })).not.toBeInTheDocument()
    expect(screen.getByText(/only test alerts and resolved incidents can be deleted/i)).toBeInTheDocument()
  })

  test('a test alert can be deleted even while still triggered', async () => {
    mockIncident = { ...RESOLVED_INCIDENT, status: 'triggered', isTest: true }
    await renderPage()

    expect(screen.getByRole('button', { name: /^delete incident$/i })).toBeInTheDocument()
  })

  test('staff see no delete action at all', async () => {
    mockAuth = STAFF
    await renderPage()

    expect(screen.queryByText(/delete this incident/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^delete incident$/i })).not.toBeInTheDocument()
  })
})

describe('Incident deletion: confirmation step', () => {
  test('the dialog names the incident and states it cannot be undone', async () => {
    const dialog = await openDialog()

    expect(dialog.getByText(/fire · INC-0007/i)).toBeInTheDocument()
    expect(dialog.getByText(/alpha high/i)).toBeInTheDocument()
    expect(dialog.getByText(/cannot be undone/i)).toBeInTheDocument()
  })

  test('the dialog warns that staff have already acknowledged the alert', async () => {
    const dialog = await openDialog()

    expect(dialog.getByText(/2 people have already acknowledged this alert/i)).toBeInTheDocument()
  })

  test('the dialog falls back to the notified count when nobody acknowledged', async () => {
    mockIncident = { ...RESOLVED_INCIDENT, acknowledgedBy: [] }
    const dialog = await openDialog()

    expect(dialog.getByText(/2 people were notified about this alert/i)).toBeInTheDocument()
  })

  test('deleting is blocked until a reason is chosen', async () => {
    const dialog = await openDialog()
    const confirm = dialog.getByRole('button', { name: /^delete incident$/i })

    expect(confirm).toBeDisabled()

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    expect(confirm).toBeEnabled()
  })

  test('the "other" reason requires a written detail', async () => {
    const dialog = await openDialog()
    const confirm = dialog.getByRole('button', { name: /^delete incident$/i })

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'other' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(dialog.getByLabelText(/detail/i), { target: { value: 'Raised against the wrong campus' } })
    expect(confirm).toBeEnabled()
  })

  test('cancelling closes the dialog without deleting', async () => {
    const dialog = await openDialog()
    fireEvent.click(dialog.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockRemove).not.toHaveBeenCalled()
  })
})

describe('Incident deletion: removal', () => {
  test('confirming sends the reason and returns to the incident list', async () => {
    const dialog = await openDialog()

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    fireEvent.change(dialog.getByLabelText(/detail/i), { target: { value: 'Logged twice' } })
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('1', {
      reasonCode: 'duplicate',
      reason: 'Logged twice',
    }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/incidents'))
  })

  test('a rejected delete surfaces the backend message and keeps the dialog open', async () => {
    mockRemove.mockRejectedValueOnce(new Error('Only test alerts and resolved incidents can be deleted.'))
    const dialog = await openDialog()

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    expect(await dialog.findByText(/only test alerts and resolved incidents can be deleted/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
