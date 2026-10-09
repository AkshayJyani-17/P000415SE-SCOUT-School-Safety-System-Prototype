// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SubmitAlert from '../pages/SubmitAlert'
import QuickActions from '../components/QuickActions'

// Covers the confirmation shown after an alert is submitted, on the two paths
// that differ: the Submit Alert form, which records an alert without notifying
// anyone, and the dashboard quick alerts, which report a delivery result.
// Quick test alerts are covered in QuickTestAlerts.test.jsx.

const CREATED = {
  id: 'inc-1',
  incidentNumber: 'INC-0042',
  type: 'fire',
  title: 'Smoke in B block',
  createdAt: '2026-10-10T02:32:00.000Z',
}

// Two of three reached, so this is a partial delivery.
const PARTIAL_DELIVERY = {
  success: true,
  message: 'Emergency alert sent to 2 of 3 recipients.',
  timestamp: '2026-10-10T02:32:00.000Z',
  results: [
    { recipientName: 'A', emailStatus: 'sent', smsStatus: 'skipped' },
    { recipientName: 'B', emailStatus: 'sent', smsStatus: 'skipped' },
    { recipientName: 'C', emailStatus: 'failed', smsStatus: 'failed' },
  ],
}

const FULL_DELIVERY = {
  ...PARTIAL_DELIVERY,
  message: 'Emergency alert sent to 2 of 2 recipients.',
  results: PARTIAL_DELIVERY.results.slice(0, 2),
}

const NO_DELIVERY = {
  success: false,
  message: 'Emergency alert sent to 0 of 2 recipients.',
  timestamp: '2026-10-10T02:32:00.000Z',
  results: [
    { recipientName: 'A', emailStatus: 'failed', smsStatus: 'skipped' },
    { recipientName: 'B', emailStatus: 'failed', smsStatus: 'skipped' },
  ],
}

let auth
let notifyResponse

const mockCreate = vi.fn(() => Promise.resolve(CREATED))
const mockApiCall = vi.fn(() => Promise.resolve(notifyResponse))
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

vi.mock('../api/client', () => ({
  apiCall: (...args) => mockApiCall(...args),
  incidentAPI: {
    create: (...args) => mockCreate(...args),
    previewRecipients: vi.fn(() => Promise.resolve({
      recipients: [
        { name: 'Fire Warden', email: 'warden@school.edu', role: 'staff' },
        { name: 'Office Manager', phone: '0400000000', role: 'schoolAdmin' },
      ],
    })),
  },
  schoolAPI: { list: vi.fn(() => Promise.resolve({ schools: [] })) },
  quickAlertsAPI: { list: vi.fn(() => Promise.resolve({ quickAlerts: [], limit: 5, remaining: 5 })) },
  setupAPI: {
    getAlertTypes: vi.fn(category => {
      if (category === 'general') {
        return Promise.resolve({
          alertTypes: [
            { label: 'Behaviour', value: 'behaviour', emoji: '⚠️', category: 'general' },
            { label: 'Medical', value: 'medical', emoji: '🏥', category: 'general' },
            { label: 'Maintenance', value: 'maintenance', emoji: '🔧', category: 'general' },
            // Fourth, so it is absent from the three label preview on the button.
            { label: 'Property', value: 'property', emoji: '🏚️', category: 'general' },
          ],
        })
      }

      if (category === 'emergency') {
        // Only the quick test alerts ask for these.
        return Promise.resolve({
          alertTypes: [{ label: 'Lockdown', value: 'lockdown', emoji: '🔒', category: 'emergency' }],
        })
      }

      // The Submit Alert form asks for every type.
      return Promise.resolve({
        alertTypes: [{ label: 'Fire', value: 'fire', emoji: '🔥', category: 'emergency' }],
      })
    }),
    getLocations: vi.fn(() => Promise.resolve({ locations: [{ label: 'Main Building' }] })),
  },
}))

const SCHOOL_ADMIN = {
  currentUser: { uid: 'school-admin-uid', email: 'principal@school.edu', displayName: 'Rinad' },
  userRole: 'School Admin',
  isSchoolAdmin: true,
  isCompanyAdmin: false,
  isStaff: false,
  authLoading: false,
}

const STAFF = {
  currentUser: { uid: 'staff-uid', email: 'staff@school.edu', displayName: 'Sam Staff' },
  userRole: 'Staff',
  isSchoolAdmin: false,
  isCompanyAdmin: false,
  isStaff: true,
  authLoading: false,
}

beforeEach(() => {
  auth = SCHOOL_ADMIN
  notifyResponse = FULL_DELIVERY
  mockCreate.mockClear().mockResolvedValue(CREATED)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Fills the form, previews, then submits.
async function submitTheForm() {
  render(
    <MemoryRouter>
      <SubmitAlert />
    </MemoryRouter>
  )

  await screen.findByRole('button', { name: /preview alert/i })
  fillTheForm()

  fireEvent.click(screen.getByRole('button', { name: /preview alert/i }))
  fireEvent.click(await screen.findByRole('button', { name: /confirm and submit alert/i }))

  return within(await screen.findByRole('dialog'))
}

function fillTheForm() {
  fireEvent.click(screen.getByRole('button', { name: /fire/i }))
  fireEvent.click(screen.getByRole('button', { name: /high/i }))
  fireEvent.change(screen.getByPlaceholderText(/brief description of the incident/i), {
    target: { value: 'Smoke in B block' },
  })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Main Building' } })
}

describe('Confirmation after submitting from the Submit Alert form', () => {
  test('shows the alert id, time and configured recipient count', async () => {
    const confirmation = await submitTheForm()

    expect(confirmation.getByText(/alert logged/i)).toBeInTheDocument()
    expect(confirmation.getByText('INC-0042')).toBeInTheDocument()
    expect(confirmation.getByText('2 configured')).toBeInTheDocument()
    expect(confirmation.getByText(/submitted/i)).toBeInTheDocument()
  })

  test('does not claim anyone was contacted, because this path notifies nobody', async () => {
    const confirmation = await submitTheForm()

    expect(confirmation.getByText(/nobody has been contacted automatically/i)).toBeInTheDocument()
    expect(confirmation.queryByText(/notified/i)).not.toBeInTheDocument()
  })

  test('stays on screen instead of navigating away', async () => {
    await submitTheForm()

    // The old behaviour jumped straight to the incident page.
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('offers a link to the alert and a way to submit another', async () => {
    const confirmation = await submitTheForm()

    expect(confirmation.getByRole('link', { name: /view alert details/i }))
      .toHaveAttribute('href', '/incidents/inc-1')

    fireEvent.click(confirmation.getByRole('button', { name: /submit another/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Back to an empty form rather than the review screen.
    expect(await screen.findByRole('button', { name: /preview alert/i })).toBeInTheDocument()
  })

  test('a failed submission shows an error and no confirmation', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network down'))

    render(
      <MemoryRouter>
        <SubmitAlert />
      </MemoryRouter>
    )
    await screen.findByRole('button', { name: /preview alert/i })
    fillTheForm()

    fireEvent.click(screen.getByRole('button', { name: /preview alert/i }))
    fireEvent.click(await screen.findByRole('button', { name: /confirm and submit alert/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to submit alert/i)
    expect(screen.queryByText(/alert logged/i)).not.toBeInTheDocument()
    // The entered details survive so nothing has to be retyped.
    expect(screen.getByRole('button', { name: /confirm and submit alert/i })).toBeInTheDocument()
  })
})

describe('Confirmation after a dashboard quick alert', () => {
  async function fireGeneralQuickAction() {
    auth = STAFF
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>
    )

    fireEvent.click(await screen.findByRole('button', { name: /general alert/i }))
    fireEvent.click(await screen.findByRole('button', { name: /property/i }))
  }

  test('reports the delivery result the backend returned', async () => {
    notifyResponse = FULL_DELIVERY
    await fireGeneralQuickAction()

    const confirmation = within(await screen.findByRole('dialog'))
    expect(confirmation.getByText(/^alert sent$/i)).toBeInTheDocument()
    expect(confirmation.getByText('2 of 2 notified')).toBeInTheDocument()
    expect(confirmation.getByText('INC-0042')).toBeInTheDocument()
  })

  test('warns when only some recipients were reached', async () => {
    notifyResponse = PARTIAL_DELIVERY
    await fireGeneralQuickAction()

    const confirmation = within(await screen.findByRole('dialog'))
    expect(confirmation.getByText(/alert sent to some recipients/i)).toBeInTheDocument()
    expect(confirmation.getByText('2 of 3 notified')).toBeInTheDocument()
    expect(confirmation.getByText(/some recipients could not be reached/i)).toBeInTheDocument()
  })

  test('warns when nobody could be reached, and says the alert is still recorded', async () => {
    notifyResponse = NO_DELIVERY
    await fireGeneralQuickAction()

    const confirmation = within(await screen.findByRole('dialog'))
    expect(confirmation.getByText(/not delivered/i)).toBeInTheDocument()
    expect(confirmation.getByText('0 of 2 notified')).toBeInTheDocument()
    expect(confirmation.getByText(/recorded in the incident log, but nobody could be reached/i)).toBeInTheDocument()
  })

  test('the confirmation stays until dismissed', async () => {
    // shouldAdvanceTime keeps the real async flow working while still allowing
    // the clock to be pushed forward.
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      notifyResponse = FULL_DELIVERY
      await fireGeneralQuickAction()
      const dialog = await screen.findByRole('dialog')

      // The banner this replaced cleared itself after 3 seconds.
      vi.advanceTimersByTime(30000)
      expect(dialog).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /done/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
