// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyQuickAlerts from '../pages/MyQuickAlerts'

const mocks = vi.hoisted(() => ({
  auth: {},
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  getAlertTypes: vi.fn(),
  getLocations: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('../api/client', () => ({
  quickAlertsAPI: {
    list: (...args) => mocks.list(...args),
    create: (...args) => mocks.create(...args),
    update: (...args) => mocks.update(...args),
    remove: (...args) => mocks.remove(...args),
  },
  setupAPI: {
    getAlertTypes: (...args) => mocks.getAlertTypes(...args),
    getLocations: (...args) => mocks.getLocations(...args),
  },
}))

const ALERT_TYPES = [
  { id: 'at_medical', label: 'Medical', value: 'medical', emoji: '🏥', category: 'emergency', active: true },
  { id: 'at_behaviour', label: 'Behaviour', value: 'behaviour', emoji: '⚠️', category: 'general', active: true },
]

const LOCATIONS = [{ id: 'l1', label: 'Oval' }, { id: 'l2', label: 'Library' }]

function quickAlert(overrides = {}) {
  return {
    id: 'q1',
    label: 'Oval asthma',
    alertTypeId: 'at_medical',
    priority: 'critical',
    location: 'Oval',
    description: null,
    available: true,
    unavailableReason: null,
    alertType: { id: 'at_medical', label: 'Medical', value: 'medical', emoji: '🏥', category: 'emergency' },
    ...overrides,
  }
}

function listPayload(quickAlerts = [], limit = 5) {
  return { quickAlerts, limit, remaining: Math.max(0, limit - quickAlerts.length) }
}

function asStaff() {
  mocks.auth = {
    currentUser: { email: 'staff@school.edu', uid: 'staffUid' },
    userRole: 'Staff',
    isStaff: true,
    isCompanyAdmin: false,
    isSchoolAdmin: false,
    authLoading: false,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MyQuickAlerts />
    </MemoryRouter>
  )
}

beforeEach(() => {
  asStaff()
  mocks.list.mockReset().mockResolvedValue(listPayload())
  mocks.create.mockReset()
  mocks.update.mockReset()
  mocks.remove.mockReset()
  mocks.getAlertTypes.mockReset().mockResolvedValue({ alertTypes: ALERT_TYPES })
  mocks.getLocations.mockReset().mockResolvedValue({ locations: LOCATIONS })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Access', () => {
  test('a non-staff user is redirected away', async () => {
    mocks.auth = { ...mocks.auth, isStaff: false, userRole: 'School Admin' }
    renderPage()

    expect(screen.queryByRole('heading', { name: 'My Quick Alerts' })).not.toBeInTheDocument()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  test('a staff member sees the page', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'My Quick Alerts' })).toBeInTheDocument()
  })
})

describe('Listing', () => {
  test('shows an empty state and the remaining allowance', async () => {
    renderPage()

    expect(await screen.findByText(/You have no quick alerts yet/i)).toBeInTheDocument()
    expect(screen.getByText('0 of 5 saved')).toBeInTheDocument()
  })

  test('renders a saved quick alert with its type and location', async () => {
    mocks.list.mockResolvedValue(listPayload([quickAlert()]))
    renderPage()

    expect(await screen.findByText('Oval asthma')).toBeInTheDocument()
    expect(screen.getByText(/Sends Medical · Oval/)).toBeInTheDocument()
    expect(screen.getByText('1 of 5 saved')).toBeInTheDocument()
  })

  test('flags a quick alert whose alert type has gone', async () => {
    mocks.list.mockResolvedValue(listPayload([
      quickAlert({ available: false, alertType: null, unavailableReason: 'The alert type this shortcut uses is no longer available. Edit or remove it.' }),
    ]))
    renderPage()

    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  })

  test('surfaces a load failure', async () => {
    mocks.list.mockRejectedValue(new Error('offline'))
    renderPage()

    expect(await screen.findByText('offline')).toBeInTheDocument()
  })
})

describe('Creating', () => {
  test('saves a new quick alert and refreshes the list', async () => {
    const created = quickAlert({ id: 'q2', label: 'Library fight' })
    mocks.create.mockResolvedValue(listPayload([created]))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /add quick alert/i }))

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Library fight' } })
    fireEvent.change(screen.getByLabelText(/^Alert type/), { target: { value: 'at_behaviour' } })
    fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: 'Library' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save quick alert' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Library fight', alertTypeId: 'at_behaviour', location: 'Library' })
    )
    expect(await screen.findByText('Library fight')).toBeInTheDocument()
  })

  test('requires a name', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /add quick alert/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save quick alert' }))

    expect(await screen.findByText(/Give your quick alert a name/i)).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  test('requires an alert type', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /add quick alert/i }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'No type' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save quick alert' }))

    expect(await screen.findByText(/Choose the alert type/i)).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  test('shows the server error when saving fails', async () => {
    mocks.create.mockRejectedValue(new Error('You already have a quick alert with that name.'))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /add quick alert/i }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Oval asthma' } })
    fireEvent.change(screen.getByLabelText(/^Alert type/), { target: { value: 'at_medical' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save quick alert' }))

    expect(await screen.findByText(/already have a quick alert/i)).toBeInTheDocument()
  })
})

describe('Limit', () => {
  test('blocks adding once the limit is reached', async () => {
    const full = Array.from({ length: 5 }, (_, index) =>
      quickAlert({ id: `q${index}`, label: `Alert ${index}` })
    )
    mocks.list.mockResolvedValue(listPayload(full))

    renderPage()

    expect(await screen.findByText('5 of 5 saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add quick alert/i })).toBeDisabled()
    expect(screen.getByText(/reached the limit of 5/i)).toBeInTheDocument()
  })

  test('blocks adding when no alert types are configured', async () => {
    mocks.getAlertTypes.mockResolvedValue({ alertTypes: [] })
    renderPage()

    expect(await screen.findByText(/No alert types have been configured/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add quick alert/i })).toBeDisabled()
  })
})

describe('Editing and removing', () => {
  test('pre-fills the form and saves an edit', async () => {
    mocks.list.mockResolvedValue(listPayload([quickAlert()]))
    mocks.update.mockResolvedValue(listPayload([quickAlert({ label: 'Renamed' })]))

    renderPage()
    fireEvent.click(await screen.findByLabelText('Edit Oval asthma'))

    expect(screen.getByLabelText(/^Name/)).toHaveValue('Oval asthma')
    expect(screen.getByLabelText(/^Alert type/)).toHaveValue('at_medical')

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    expect(mocks.update).toHaveBeenCalledWith('q1', expect.objectContaining({ label: 'Renamed' }))
    expect(await screen.findByText('Renamed')).toBeInTheDocument()
  })

  test('removes a quick alert after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.list.mockResolvedValue(listPayload([quickAlert()]))
    mocks.remove.mockResolvedValue(listPayload([]))

    renderPage()
    fireEvent.click(await screen.findByLabelText('Remove Oval asthma'))

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('q1'))
    expect(await screen.findByText(/You have no quick alerts yet/i)).toBeInTheDocument()
  })

  test('keeps the quick alert when the confirmation is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mocks.list.mockResolvedValue(listPayload([quickAlert()]))

    renderPage()
    fireEvent.click(await screen.findByLabelText('Remove Oval asthma'))

    expect(mocks.remove).not.toHaveBeenCalled()
    expect(screen.getByText('Oval asthma')).toBeInTheDocument()
  })
})
