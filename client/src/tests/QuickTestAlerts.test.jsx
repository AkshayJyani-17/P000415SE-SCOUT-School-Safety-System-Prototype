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
    previewRecipients: vi.fn(() => Promise.resolve({ recipients: [] })),
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
    expect(dialog).toHaveTextContent('For testing purposes only. Do not use during a real emergency.')
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

  test('is hidden from staff, who use the normal submit form', async () => {
    auth.isSchoolAdmin = false
    auth.isStaff = true
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Submit Alert' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Quick test alerts' })).not.toBeInTheDocument()
  })
})
