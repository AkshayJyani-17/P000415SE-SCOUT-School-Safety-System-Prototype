// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import SubmitAlert from '../pages/SubmitAlert'
import { incidentAPI, setupAPI } from '../api/client'

// One School Admin session drives every test; the role flags are swapped per test.
const auth = {
  currentUser: { email: 'admin@school.edu', displayName: 'Rinad' },
  userRole: 'School Admin',
  isSchoolAdmin: true,
  isCompanyAdmin: false,
  isStaff: false,
  authLoading: false,
}

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

vi.mock('../api/client', () => ({
  incidentAPI: {
    create: vi.fn(() => Promise.resolve({ id: 'inc-1', incidentNumber: 'INC-0007' })),
    previewRecipients: vi.fn(() => Promise.resolve({
      recipients: [
        { name: 'Fire Warden', email: 'warden@school.edu', role: 'staff' },
        { name: 'Office Manager', phone: '0400000000', role: 'schoolAdmin' },
      ],
    })),
  },
  schoolAPI: { list: vi.fn(() => Promise.resolve({ schools: [] })) },
  setupAPI: {
    // The page asks for every type; quick test alerts ask for the emergency ones only.
    getAlertTypes: vi.fn(category =>
      Promise.resolve({
        alertTypes: category === 'emergency'
          ? [
              { label: 'Fire', emoji: '🔥', category: 'emergency' },
              { label: 'Lockdown', emoji: '🔒', category: 'emergency' },
            ]
          : [
              { label: 'Fire', emoji: '🔥', category: 'emergency' },
              { label: 'Medical', emoji: '🏥', category: 'general' },
            ],
      })
    ),
    getLocations: vi.fn(() => Promise.resolve({ locations: [{ label: 'Main Building' }] })),
  },
}))

function renderPage() {
  return render(<MemoryRouter><SubmitAlert /></MemoryRouter>)
}

// Opens the confirmation dialog for one quick test button.
async function openConfirm(typeLabel = 'Fire') {
  renderPage()
  const button = await screen.findByRole('button', { name: `Test ${typeLabel}` })
  fireEvent.click(button)
  return screen.findByRole('dialog')
}

beforeEach(() => {
  auth.isSchoolAdmin = true
  auth.isCompanyAdmin = false
  auth.isStaff = false
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Quick test alerts on the Alert Testing page', () => {
  test('shows a quick action button for each pre-configured emergency type', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Quick test alerts' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Test Fire' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Lockdown' })).toBeInTheDocument()
    // Medical is a general type, so it is not a quick emergency button.
    expect(screen.queryByRole('button', { name: 'Test Medical' })).not.toBeInTheDocument()
    expect(setupAPI.getAlertTypes).toHaveBeenCalledWith('emergency')
  })

  test('is marked as for testing purposes only', async () => {
    const dialog = await openConfirm()

    expect(await screen.findByText('TESTING ONLY')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('For testing purposes only. Recipients are not notified, so no staff are alarmed.')
  })

  test('asks for confirmation before sending anything', async () => {
    const dialog = await openConfirm()

    expect(dialog).toHaveTextContent('Send Fire test alert?')
    expect(incidentAPI.create).not.toHaveBeenCalled()
  })

  test('cancelling the confirmation sends no alert', async () => {
    const dialog = await openConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(incidentAPI.create).not.toHaveBeenCalled()
  })

  test('confirming sends a test alert with pre-configured details', async () => {
    await openConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Send test alert' }))

    await waitFor(() => expect(incidentAPI.create).toHaveBeenCalledTimes(1))
    expect(incidentAPI.create).toHaveBeenCalledWith({
      isTest: true,
      type: 'fire',
      priority: 'critical',
      title: 'TEST: Fire alert',
      location: 'Main Building',
      description: expect.stringContaining('For testing and review purposes only'),
    })
    // Two clicks in total: the type button, then Send test alert.
    expect(await screen.findByText('Fire test alert sent')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View test incident INC-0007/ })).toHaveAttribute('href', '/incidents/inc-1')
  })

  test('shows an error and keeps the page usable when sending fails', async () => {
    incidentAPI.create.mockRejectedValueOnce(new Error('Network down'))
    await openConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Send test alert' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    expect(screen.getByRole('button', { name: 'Send test alert' })).toBeEnabled()
  })

  test('the confirmation shows who the alert type routes to', async () => {
    await openConfirm()

    expect(incidentAPI.previewRecipients).toHaveBeenCalledWith('fire')
    expect(await screen.findByText('Configured recipients (2)')).toBeInTheDocument()
    expect(screen.getByText(/Fire Warden/)).toBeInTheDocument()
    expect(screen.getByText(/Office Manager/)).toBeInTheDocument()
  })

  test('warns when an alert type has no recipients configured', async () => {
    incidentAPI.previewRecipients.mockResolvedValueOnce({ recipients: [] })
    await openConfirm()

    expect(await screen.findByText(/No recipients are configured for this alert type/)).toBeInTheDocument()
    // Sending is still allowed: the admin may be testing before setting recipients up.
    expect(screen.getByRole('button', { name: 'Send test alert' })).toBeEnabled()
  })

  test('points to Setup when no emergency types are configured', async () => {
    setupAPI.getAlertTypes.mockImplementation(category =>
      Promise.resolve({ alertTypes: category === 'emergency' ? [] : [{ label: 'Medical' }] })
    )
    renderPage()

    expect(await screen.findByText(/No emergency alert types are configured yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Test / })).not.toBeInTheDocument()
  })

  test('falls back to common types only when the request fails', async () => {
    setupAPI.getAlertTypes.mockImplementation(category =>
      category === 'emergency' ? Promise.reject(new Error('offline')) : Promise.resolve({ alertTypes: [] })
    )
    renderPage()

    expect(await screen.findByRole('button', { name: 'Test Fire' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test Lockdown' })).toBeInTheDocument()
  })

  test('is hidden from staff, who use the normal submit form', async () => {
    auth.isSchoolAdmin = false
    auth.isStaff = true
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Submit Alert' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Quick test alerts' })).not.toBeInTheDocument()
  })
})
