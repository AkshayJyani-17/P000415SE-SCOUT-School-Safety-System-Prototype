// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QuickActions from '../components/QuickActions'

// SCRUM-40. The emergency button used to show nothing at all when the incident
// failed to save. The alert still went out to people, but the keypad closed and
// the operator saw no confirmation and no error, so they could not tell whether
// help had been called.

const CREATED = {
  id: 'inc-1',
  incidentNumber: 'INC-0042',
  type: 'fire',
  createdAt: '2026-10-17T02:00:00.000Z',
}

const DELIVERED = {
  success: true,
  message: 'Emergency alert sent to 2 of 2 recipients.',
  timestamp: '2026-10-17T02:00:00.000Z',
  results: [
    { recipientName: 'A', emailStatus: 'sent', smsStatus: 'skipped' },
    { recipientName: 'B', emailStatus: 'sent', smsStatus: 'skipped' },
  ],
}

const DELIVERED_TO_NOBODY = {
  success: false,
  message: 'Emergency alert sent to 0 of 2 recipients.',
  timestamp: '2026-10-17T02:00:00.000Z',
  results: [
    { recipientName: 'A', emailStatus: 'failed', smsStatus: 'skipped' },
    { recipientName: 'B', emailStatus: 'failed', smsStatus: 'skipped' },
  ],
}

const mockCreate = vi.fn()
const mockApiCall = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'staff-uid', email: 'staff@school.edu', displayName: 'Sam Staff' },
    userRole: 'Staff',
    isStaff: true,
    authLoading: false,
  }),
}))

vi.mock('../api/client', () => ({
  apiCall: (...args) => mockApiCall(...args),
  incidentAPI: { create: (...args) => mockCreate(...args) },
  quickAlertsAPI: { list: vi.fn(() => Promise.resolve({ quickAlerts: [] })) },
  setupAPI: {
    getAlertTypes: vi.fn(category =>
      Promise.resolve({
        alertTypes: category === 'emergency'
          ? [{ label: 'Fire', value: 'fire', emoji: '🔥', category: 'emergency' }]
          : [{ label: 'Maintenance', value: 'maintenance', emoji: '🔧', category: 'general' }],
      })
    ),
  },
}))

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue(CREATED)
  mockApiCall.mockReset().mockResolvedValue(DELIVERED)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Two clicks: the Emergency alert button, then the type.
async function raiseEmergencyAlert() {
  render(
    <MemoryRouter>
      <QuickActions />
    </MemoryRouter>
  )

  fireEvent.click(await screen.findByRole('button', { name: /emergency alert/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^🔥 Fire/i }))

  return within(await screen.findByRole('dialog'))
}

describe('SCRUM-40 emergency alert confirmation', () => {
  test('shows a confirmation when everything works', async () => {
    const dialog = await raiseEmergencyAlert()

    expect(dialog.getByText(/^alert sent$/i)).toBeInTheDocument()
    expect(dialog.getByText('INC-0042')).toBeInTheDocument()
    expect(dialog.getByText('2 of 2 notified')).toBeInTheDocument()
  })

  test('still shows a confirmation when the incident could not be saved', async () => {
    // This is the bug. The alert goes out but the record does not save.
    mockCreate.mockRejectedValueOnce(new Error('Firestore unavailable'))

    const dialog = await raiseEmergencyAlert()

    expect(dialog.getByText(/alert sent, but not saved/i)).toBeInTheDocument()
    expect(dialog.getByText(/2 of 2 recipients were notified/i)).toBeInTheDocument()
    expect(dialog.getByText(/could not be saved to the incident log/i)).toBeInTheDocument()
  })

  test('says the alert was not saved instead of showing an alert id', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Firestore unavailable'))

    const dialog = await raiseEmergencyAlert()

    expect(dialog.getByText('Not saved')).toBeInTheDocument()
    // There is no incident to open, so the link must not be offered.
    expect(dialog.queryByRole('link', { name: /view alert details/i })).not.toBeInTheDocument()
  })

  test('warns clearly when the alert was neither saved nor delivered', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Firestore unavailable'))
    mockApiCall.mockResolvedValueOnce(DELIVERED_TO_NOBODY)

    const dialog = await raiseEmergencyAlert()

    expect(dialog.getByText(/alert not sent/i)).toBeInTheDocument()
    expect(dialog.getByText(/raise the alarm another way/i)).toBeInTheDocument()
  })

  test('the confirmation can be dismissed', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Firestore unavailable'))

    const dialog = await raiseEmergencyAlert()
    fireEvent.click(dialog.getByRole('button', { name: /done/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
