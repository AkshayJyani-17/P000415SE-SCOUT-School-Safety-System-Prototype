// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QuickActions from '../components/QuickActions'

const mocks = vi.hoisted(() => ({
  auth: {},
  listQuickAlerts: vi.fn(),
  getAlertTypes: vi.fn(),
  createIncident: vi.fn(),
  apiCall: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('../api/client', () => ({
  incidentAPI: { create: (...args) => mocks.createIncident(...args) },
  apiCall: (...args) => mocks.apiCall(...args),
  quickAlertsAPI: { list: (...args) => mocks.listQuickAlerts(...args) },
  setupAPI: { getAlertTypes: (...args) => mocks.getAlertTypes(...args) },
}))

function quickAlert(overrides = {}) {
  return {
    id: 'q1',
    label: 'Oval asthma',
    alertTypeId: 'at_medical',
    priority: 'critical',
    location: 'Oval',
    description: 'Reliever inhaler in first-aid room',
    available: true,
    alertType: { id: 'at_medical', label: 'Medical Response', value: 'medical_response', emoji: '🏥', category: 'emergency' },
    ...overrides,
  }
}

function renderQuickActions() {
  return render(
    <MemoryRouter>
      <QuickActions />
    </MemoryRouter>
  )
}

beforeEach(() => {
  mocks.auth = {
    currentUser: { uid: 'staffUid', displayName: 'Sam Staff' },
    userRole: 'Staff',
    isStaff: true,
  }
  mocks.listQuickAlerts.mockReset().mockResolvedValue({ quickAlerts: [], limit: 5, remaining: 5 })
  mocks.getAlertTypes.mockReset().mockResolvedValue({ alertTypes: [] })
  mocks.createIncident.mockReset().mockResolvedValue({ id: 'incident-1' })
  mocks.apiCall.mockReset().mockResolvedValue({ success: true })
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Custom quick alerts on the dashboard', () => {
  test('no section is shown when the staff member has none saved', async () => {
    renderQuickActions()

    await waitFor(() => expect(mocks.listQuickAlerts).toHaveBeenCalled())
    expect(screen.queryByText('My quick alerts')).not.toBeInTheDocument()
  })

  test('saved quick alerts appear as their own buttons', async () => {
    mocks.listQuickAlerts.mockResolvedValue({
      quickAlerts: [quickAlert(), quickAlert({ id: 'q2', label: 'Library fight', location: null })],
      limit: 5,
      remaining: 3,
    })

    renderQuickActions()

    expect(await screen.findByText('My quick alerts')).toBeInTheDocument()
    expect(screen.getByText('Oval asthma')).toBeInTheDocument()
    expect(screen.getByText('Library fight')).toBeInTheDocument()
    expect(screen.getByText(/Medical Response · Oval/)).toBeInTheDocument()
  })

  test('a shortcut whose alert type is unavailable is not offered', async () => {
    mocks.listQuickAlerts.mockResolvedValue({
      quickAlerts: [quickAlert({ available: false, alertType: null })],
      limit: 5,
      remaining: 4,
    })

    renderQuickActions()

    await waitFor(() => expect(mocks.listQuickAlerts).toHaveBeenCalled())
    expect(screen.queryByText('Oval asthma')).not.toBeInTheDocument()
  })

  test('tapping a shortcut asks for confirmation before anything is sent', async () => {
    mocks.listQuickAlerts.mockResolvedValue({ quickAlerts: [quickAlert()], limit: 5, remaining: 4 })

    renderQuickActions()
    fireEvent.click(await screen.findByText('Oval asthma'))

    expect(await screen.findByText(/Send "Oval asthma"\?/)).toBeInTheDocument()
    expect(screen.getByText(/alerts the staff configured to receive Medical Response/i)).toBeInTheDocument()
    expect(mocks.createIncident).not.toHaveBeenCalled()
    expect(mocks.apiCall).not.toHaveBeenCalled()
  })

  test('cancelling sends nothing', async () => {
    mocks.listQuickAlerts.mockResolvedValue({ quickAlerts: [quickAlert()], limit: 5, remaining: 4 })

    renderQuickActions()
    fireEvent.click(await screen.findByText('Oval asthma'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mocks.createIncident).not.toHaveBeenCalled()
    expect(mocks.apiCall).not.toHaveBeenCalled()
  })

  test('confirming creates the incident from the saved presets', async () => {
    mocks.listQuickAlerts.mockResolvedValue({ quickAlerts: [quickAlert()], limit: 5, remaining: 4 })

    renderQuickActions()
    fireEvent.click(await screen.findByText('Oval asthma'))
    fireEvent.click(await screen.findByRole('button', { name: 'Send alert' }))

    await waitFor(() => expect(mocks.createIncident).toHaveBeenCalledTimes(1))
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'medical_response',
        priority: 'critical',
        title: 'Oval asthma',
        location: 'Oval',
        description: 'Reliever inhaler in first-aid room',
        triggeredById: 'staffUid',
      })
    )
  })

  test('the notification is sent under the alert type label so routing resolves', async () => {
    mocks.listQuickAlerts.mockResolvedValue({ quickAlerts: [quickAlert()], limit: 5, remaining: 4 })

    renderQuickActions()
    fireEvent.click(await screen.findByText('Oval asthma'))
    fireEvent.click(await screen.findByRole('button', { name: 'Send alert' }))

    await waitFor(() => expect(mocks.apiCall).toHaveBeenCalledTimes(1))

    const [path, options] = mocks.apiCall.mock.calls[0]
    const payload = JSON.parse(options.body)

    expect(path).toBe('/notifications/emergency')
    expect(payload.emergencyType).toBe('Medical Response')
    expect(payload.location).toBe('Oval')
    expect(payload.incidentId).toBe('incident-1')
    expect(payload.incidentTitle).toBe('Oval asthma')
  })

  test('a shortcut with no preset location still sends a location', async () => {
    mocks.listQuickAlerts.mockResolvedValue({
      quickAlerts: [quickAlert({ location: null, description: null })],
      limit: 5,
      remaining: 4,
    })

    renderQuickActions()
    fireEvent.click(await screen.findByText('Oval asthma'))
    fireEvent.click(await screen.findByRole('button', { name: 'Send alert' }))

    await waitFor(() => expect(mocks.createIncident).toHaveBeenCalled())
    expect(mocks.createIncident.mock.calls[0][0].location).toBe('Dashboard quick action')
  })

  test('a send failure is surfaced and does not crash the dashboard', async () => {
    mocks.listQuickAlerts.mockResolvedValue({ quickAlerts: [quickAlert()], limit: 5, remaining: 4 })
    mocks.createIncident.mockRejectedValue(new Error('Backend unreachable'))

    renderQuickActions()
    fireEvent.click(await screen.findByText('Oval asthma'))
    fireEvent.click(await screen.findByRole('button', { name: 'Send alert' }))

    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument()
    expect(screen.getByText('Oval asthma')).toBeInTheDocument()
  })

  test('a failure to load shortcuts leaves the standard buttons working', async () => {
    mocks.listQuickAlerts.mockRejectedValue(new Error('offline'))

    renderQuickActions()

    expect(await screen.findByText('Emergency alert')).toBeInTheDocument()
    expect(screen.getByText('General alert')).toBeInTheDocument()
    expect(screen.queryByText('My quick alerts')).not.toBeInTheDocument()
  })

  test('quick alerts are not fetched for a non-staff user', async () => {
    mocks.auth = { ...mocks.auth, isStaff: false }

    const { container } = renderQuickActions()

    expect(container).toBeEmptyDOMElement()
  })
})
