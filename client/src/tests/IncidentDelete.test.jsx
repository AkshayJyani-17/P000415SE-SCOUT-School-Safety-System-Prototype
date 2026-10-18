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
  useAuth: () => ({ authLoading: false, ...mockAuth }),
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

const COMPANY_ADMIN = {
  currentUser: { uid: 'company-uid', email: 'admin@scout.edu' },
  userRole: 'Company Admin',
  isCompanyAdmin: true,
  isSchoolAdmin: false,
  isAdmin: true,
}

const SCHOOL_ADMIN = {
  currentUser: { uid: 'school-admin-uid', email: 'principal@school.edu' },
  userRole: 'School Admin',
  isCompanyAdmin: false,
  isSchoolAdmin: true,
  isAdmin: true,
}

const STAFF = {
  currentUser: { uid: 'staff-uid', email: 'staff@school.edu' },
  userRole: 'Staff',
  isCompanyAdmin: false,
  isSchoolAdmin: false,
  isAdmin: false,
}

// SCRUM-43. The server sends responseWindow with every incident, worked out
// from the incident's own school. This page never calculates it, so the
// fixtures carry it the way the real payload does.
const RESPONSE_UNDERWAY = {
  windowMinutes: 60,
  ageMinutes: 30,
  responseMayBeUnderway: true,
}

// A drill raised by the School Admin, the only thing that role may delete.
const OWN_DRILL = {
  ...RESOLVED_INCIDENT,
  status: 'triggered',
  isTest: true,
  acknowledgedBy: [],
  triggeredById: 'school-admin-uid',
  triggeredByEmail: 'principal@school.edu',
}

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

  test('a freshly triggered incident still offers the delete action', async () => {
    // SCRUM-43. This used to be hidden, using a threshold this page loaded for
    // itself while the server used the incident's own school. The two could
    // disagree, so the action was sometimes hidden when the delete would have
    // worked and sometimes offered when it would not. How recent the alert is
    // now only produces a warning inside the dialog.
    mockIncident = {
      ...RESOLVED_INCIDENT,
      status: 'triggered',
      acknowledgedBy: [],
      responseWindow: RESPONSE_UNDERWAY,
    }
    await renderPage()

    expect(screen.getByRole('button', { name: /^delete incident$/i })).toBeInTheDocument()
  })

  test('an overdue incident nobody acknowledged can be deleted', async () => {
    // The threshold is 15 minutes, so an hour-old unanswered alert is abandoned.
    mockIncident = {
      ...RESOLVED_INCIDENT,
      status: 'triggered',
      acknowledgedBy: [],
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }
    await renderPage()

    expect(screen.getByRole('button', { name: /^delete incident$/i })).toBeInTheDocument()
  })

  test('an overdue incident someone acknowledged still offers the delete action', async () => {
    mockIncident = {
      ...RESOLVED_INCIDENT,
      status: 'triggered',
      acknowledgedBy: [{ name: 'Riley Principal' }],
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }
    await renderPage()

    // The dialog still says somebody acknowledged it, which is the warning
    // that matters here. Hiding the action instead left an admin with no way
    // to clear a record logged by mistake.
    expect(screen.getByRole('button', { name: /^delete incident$/i })).toBeInTheDocument()
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

  test('a School Admin can delete a test alert they raised', async () => {
    mockAuth = SCHOOL_ADMIN
    mockIncident = OWN_DRILL
    await renderPage()

    expect(screen.getByRole('button', { name: /^delete incident$/i })).toBeInTheDocument()
  })

  test('a School Admin sees no delete section on a real incident', async () => {
    mockAuth = SCHOOL_ADMIN
    await renderPage()

    // Resolved and at their school, but not a drill they raised, so there is
    // no path to deleting it and the section is hidden rather than refusing.
    expect(screen.queryByText(/delete this incident/i)).not.toBeInTheDocument()
  })

  test('a School Admin sees no delete section on a drill someone else raised', async () => {
    mockAuth = SCHOOL_ADMIN
    mockIncident = { ...OWN_DRILL, triggeredById: 'another-admin-uid', triggeredByEmail: 'other@school.edu' }
    await renderPage()

    expect(screen.queryByText(/delete this incident/i)).not.toBeInTheDocument()
  })

  test('a Company Admin can delete a drill raised by a School Admin', async () => {
    mockIncident = OWN_DRILL
    await renderPage()

    expect(screen.getByRole('button', { name: /^delete incident$/i })).toBeInTheDocument()
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
  test('confirming sends the reason and reports success before leaving', async () => {
    const dialog = await openDialog()

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    fireEvent.change(dialog.getByLabelText(/detail/i), { target: { value: 'Logged twice' } })
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('1', {
      reasonCode: 'duplicate',
      reason: 'Logged twice',
    }))

    // The outcome is confirmed before the page navigates away.
    expect(await screen.findByText(/incident deleted/i)).toBeInTheDocument()
    expect(screen.getByText(/fire · INC-0007/i)).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/incidents'))
  })

  test('a rejected delete surfaces the backend message and keeps the dialog open', async () => {
    // A role refusal, which is the only thing the server refuses a delete for
    // now that the time check has gone.
    mockRemove.mockRejectedValueOnce(new Error('School Admins can only delete test alerts they raised themselves.'))
    const dialog = await openDialog()

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    expect(await dialog.findByText(/only delete test alerts they raised themselves/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

// SCRUM-43. The warning replaces the old block. Nothing here can refuse the
// delete, so the screen and the server have nothing left to disagree about.
describe('Incident deletion: staff may still be responding', () => {
  async function openDialogFor(responseWindow) {
    mockIncident = { ...RESOLVED_INCIDENT, status: 'triggered', acknowledgedBy: [], responseWindow }
    return openDialog()
  }

  test('the dialog names the school and the response time', async () => {
    const dialog = await openDialogFor(RESPONSE_UNDERWAY)

    expect(
      dialog.getByText(/Alpha High allows 60 minutes to respond and this alert is 30 minutes old/i)
    ).toBeInTheDocument()
    expect(dialog.getByText(/staff there may still be working on it/i)).toBeInTheDocument()
  })

  test('deleting is held back until the box is ticked', async () => {
    const dialog = await openDialogFor(RESPONSE_UNDERWAY)
    const confirm = dialog.getByRole('button', { name: /^delete incident$/i })

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'logged_in_error' } })

    // A reason alone is no longer enough while a response may be underway.
    expect(confirm).toBeDisabled()

    fireEvent.click(dialog.getByLabelText(/i understand staff may still be responding/i))
    expect(confirm).toBeEnabled()
  })

  test('cancel stays usable the whole time', async () => {
    const dialog = await openDialogFor(RESPONSE_UNDERWAY)

    expect(dialog.getByRole('button', { name: /cancel/i })).toBeEnabled()
  })

  test('unticking the box holds the delete back again', async () => {
    const dialog = await openDialogFor(RESPONSE_UNDERWAY)
    const confirm = dialog.getByRole('button', { name: /^delete incident$/i })
    const box = dialog.getByLabelText(/i understand staff may still be responding/i)

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'logged_in_error' } })
    fireEvent.click(box)
    expect(confirm).toBeEnabled()

    fireEvent.click(box)
    expect(confirm).toBeDisabled()
  })

  test('the delete goes through once the box is ticked', async () => {
    const dialog = await openDialogFor(RESPONSE_UNDERWAY)

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'logged_in_error' } })
    fireEvent.click(dialog.getByLabelText(/i understand staff may still be responding/i))
    fireEvent.click(dialog.getByRole('button', { name: /^delete incident$/i }))

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('1', {
      reasonCode: 'logged_in_error',
      reason: '',
    }))
  })

  test('no warning and no box when the response time has passed', async () => {
    const dialog = await openDialogFor({
      windowMinutes: 15,
      ageMinutes: 60,
      responseMayBeUnderway: false,
    })

    expect(dialog.queryByText(/may still be working on it/i)).not.toBeInTheDocument()
    expect(dialog.queryByLabelText(/i understand staff may still be responding/i)).not.toBeInTheDocument()

    // A reason on its own is enough again.
    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    expect(dialog.getByRole('button', { name: /^delete incident$/i })).toBeEnabled()
  })

  test('no warning when the server sent no response window at all', async () => {
    const dialog = await openDialogFor(undefined)

    expect(dialog.queryByText(/may still be working on it/i)).not.toBeInTheDocument()

    fireEvent.change(dialog.getByLabelText(/reason for deleting/i), { target: { value: 'duplicate' } })
    expect(dialog.getByRole('button', { name: /^delete incident$/i })).toBeEnabled()
  })

  test('the warning uses the singular for a one minute window', async () => {
    const dialog = await openDialogFor({
      windowMinutes: 1,
      ageMinutes: 1,
      responseMayBeUnderway: true,
    })

    expect(
      dialog.getByText(/allows 1 minute to respond and this alert is 1 minute old/i)
    ).toBeInTheDocument()
  })

  test('the warning copes with an alert raised seconds ago', async () => {
    const dialog = await openDialogFor({
      windowMinutes: 15,
      ageMinutes: 0,
      responseMayBeUnderway: true,
    })

    expect(dialog.getByText(/this alert is less than a minute old/i)).toBeInTheDocument()
  })
})
