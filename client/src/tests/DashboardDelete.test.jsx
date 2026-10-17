// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard'

// The dashboard lists incidents in two places: unacknowledged alerts (where
// only a test drill is ever deletable) and today's recent incidents (where
// resolved records appear). Both carry the row delete icon.

const today = () => new Date().toISOString()

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
  createdAt: today(),
}

const ACKNOWLEDGED = {
  id: 'ack-1',
  incidentNumber: 'INC-0008',
  title: 'Medical response underway',
  type: 'medical',
  status: 'acknowledged',
  location: 'Library',
  priority: 'medium',
  triggeredByName: 'Sam Staff',
  timestamp: '2026-05-12 11:00',
  createdAt: today(),
}

const TEST_DRILL = {
  id: 'drill-1',
  incidentNumber: 'INC-0009',
  title: 'Lockdown drill',
  type: 'lockdown',
  status: 'triggered',
  isTest: true,
  location: 'Whole school',
  priority: 'low',
  triggeredByName: 'Riley Principal',
  timestamp: '2026-05-12 12:00',
  createdAt: today(),
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
  useAuth: () => ({ authLoading: false, ...mockAuth }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({ schools: [] }),
}))

vi.mock('../api/client', () => ({
  incidentAPI: {
    list: vi.fn(() => Promise.resolve(mockIncidents)),
    remove: (...args) => mockRemove(...args),
  },
  analyticsAPI: { summary: vi.fn(() => Promise.resolve({})) },
  settingsAPI: { get: vi.fn(() => Promise.resolve({ overdueThresholdMinutes: 15 })) },
  notificationsAPI: { list: vi.fn(() => Promise.resolve([])) },
  subscribeToIncidents: vi.fn(() => () => {}),
}))

const COMPANY_ADMIN = {
  currentUser: { uid: 'company-uid', email: 'admin@scout.edu' },
  userRole: 'Company Admin',
  isCompanyAdmin: true,
  isSchoolAdmin: false,
  isStaff: false,
  isAdmin: true,
}

const SCHOOL_ADMIN = {
  currentUser: { uid: 'school-admin-uid', email: 'principal@school.edu' },
  userRole: 'School Admin',
  isCompanyAdmin: false,
  isSchoolAdmin: true,
  isStaff: false,
  isAdmin: true,
}

const STAFF = {
  currentUser: { uid: 'staff-uid', email: 'staff@school.edu' },
  userRole: 'Staff',
  isCompanyAdmin: false,
  isSchoolAdmin: false,
  isStaff: true,
  isAdmin: false,
}

beforeEach(() => {
  mockAuth = COMPANY_ADMIN
  mockIncidents = [RESOLVED, ACKNOWLEDGED, TEST_DRILL]
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderDashboard() {
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
  await screen.findByText(/duplicate fire report/i)
}

const deleteButton = label => screen.getByRole('button', { name: new RegExp(`delete ${label}`, 'i') })

describe('Deleting from the dashboard', () => {
  test('a resolved incident in the recent list offers the delete icon', async () => {
    await renderDashboard()
    expect(deleteButton('INC-0007')).toBeInTheDocument()
  })

  test('an incident still being responded to also offers the delete icon', async () => {
    // SCRUM-43. The icon used to be hidden here, using whichever threshold the
    // dashboard had loaded, while the server used the incident's own school.
    // The two could disagree about the same row. The dialog warns about a live
    // response instead of the icon quietly disappearing.
    await renderDashboard()
    expect(deleteButton('INC-0008')).toBeInTheDocument()
  })

  test('an unacknowledged test drill can be cleared from the dashboard', async () => {
    await renderDashboard()
    expect(deleteButton('INC-0009')).toBeInTheDocument()
  })

  test('a test drill is badged TEST on the dashboard alongside its delete icon', async () => {
    await renderDashboard()

    // Without the badge a drill is indistinguishable from a real alert here,
    // which makes the delete icon look like it appears at random.
    expect(screen.getByText('TEST')).toBeInTheDocument()
    expect(deleteButton('INC-0009')).toBeInTheDocument()
  })

  test('an overdue alert nobody acknowledged is deletable from the dashboard', async () => {
    // Matches the real dashboard: stale triggered records nobody ever answered.
    mockIncidents = [{
      ...ACKNOWLEDGED,
      status: 'triggered',
      acknowledgedBy: [],
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    }]
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    await screen.findByText(/medical response underway/i)

    expect(deleteButton('INC-0008')).toBeInTheDocument()
  })

  test('a School Admin only gets the icon on drills they raised', async () => {
    mockAuth = SCHOOL_ADMIN
    mockIncidents = [
      { ...TEST_DRILL, triggeredById: 'school-admin-uid' },
      { ...TEST_DRILL, id: 'other-drill', incidentNumber: 'INC-0010', title: 'Someone elses drill', triggeredById: 'another-uid' },
      RESOLVED,
    ]
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    await screen.findByText(/lockdown drill/i)

    expect(deleteButton('INC-0009')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete inc-0010/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete inc-0007/i })).not.toBeInTheDocument()
  })

  test('a resolved test alert is deletable from the recent list', async () => {
    mockIncidents = [{ ...RESOLVED, isTest: true }]
    await renderDashboard()

    expect(screen.getByText('TEST')).toBeInTheDocument()
    expect(deleteButton('INC-0007')).toBeInTheDocument()
  })

  test('staff see no delete icons on the dashboard', async () => {
    mockAuth = STAFF
    mockIncidents = [RESOLVED]
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.queryByRole('button', { name: /delete inc-0007/i })).not.toBeInTheDocument())
  })

  test('the icon opens the confirmation dialog without opening the incident', async () => {
    await renderDashboard()
    fireEvent.click(deleteButton('INC-0007'))

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/fire · INC-0007/i)).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('confirming removes the incident from the dashboard', async () => {
    await renderDashboard()
    fireEvent.click(deleteButton('INC-0007'))

    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('res-1', {
      reasonCode: 'duplicate',
      reason: '',
    }))

    expect(await screen.findByText(/incident deleted/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => expect(screen.queryByText(/duplicate fire report/i)).not.toBeInTheDocument())
    // Untouched incidents stay on the dashboard.
    expect(screen.getByText(/medical response underway/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('a failed delete shows no success message and keeps the incident', async () => {
    mockRemove.mockRejectedValueOnce(new Error('Incident not found.'))
    await renderDashboard()
    fireEvent.click(deleteButton('INC-0007'))

    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    expect(await dialog.findByText(/incident not found/i)).toBeInTheDocument()
    expect(screen.queryByText(/incident deleted/i)).not.toBeInTheDocument()
    expect(screen.getByText(/duplicate fire report/i)).toBeInTheDocument()
  })
})

// SCRUM-43. The warning has to work from the dashboard too, not only from the
// Incidents page, because both open the same dialog.
describe('Deleting from the dashboard while staff may be responding', () => {
  test('the dialog warns and holds the delete back until the box is ticked', async () => {
    mockIncidents = [{
      ...ACKNOWLEDGED,
      schoolName: 'Alpha High',
      responseWindow: { windowMinutes: 60, ageMinutes: 5, responseMayBeUnderway: true },
    }]

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    await screen.findByText(/medical response underway/i)

    fireEvent.click(deleteButton('INC-0008'))
    const dialog = within(await screen.findByRole('dialog'))

    expect(dialog.getByText(/Alpha High allows 60 minutes to respond/i)).toBeInTheDocument()

    const confirm = dialog.getByRole('button', { name: /^delete incident$/i })
    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'logged_in_error' } })
    expect(confirm).toBeDisabled()

    fireEvent.click(dialog.getByLabelText(/i understand staff may still be responding/i))
    expect(confirm).toBeEnabled()
  })

  test('a resolved incident gets no warning on the dashboard', async () => {
    // The server never reports a response underway for a resolved incident,
    // so this is the shape the dashboard actually receives for one.
    mockIncidents = [{
      ...RESOLVED,
      responseWindow: { windowMinutes: 60, ageMinutes: 5, responseMayBeUnderway: false },
    }]
    await renderDashboard()

    fireEvent.click(deleteButton('INC-0007'))
    const dialog = within(await screen.findByRole('dialog'))

    expect(dialog.queryByText(/may still be working on it/i)).not.toBeInTheDocument()

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    expect(dialog.getByRole('button', { name: /^delete incident$/i })).toBeEnabled()
  })
})
