// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SubmitAlert from '../pages/SubmitAlert'

// SCRUM-41. After submitting, the "Confirm and submit alert" button behind the
// confirmation stayed active and the submit handler did not check that the
// alert had already been sent, so the same alert could be saved twice.

const CREATED = {
  id: 'inc-1',
  incidentNumber: 'INC-0042',
  type: 'fire',
  createdAt: '2026-10-17T02:32:00.000Z',
}

const mockCreate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'staff-uid', email: 'staff@school.edu', displayName: 'Sam Staff' },
    userRole: 'Staff',
    isStaff: true,
    isSchoolAdmin: false,
    isCompanyAdmin: false,
    authLoading: false,
  }),
}))

vi.mock('../api/client', () => ({
  incidentAPI: {
    create: (...args) => mockCreate(...args),
    previewRecipients: vi.fn(() => Promise.resolve({
      recipients: [{ name: 'Fire Warden', email: 'warden@school.edu', role: 'staff' }],
    })),
  },
  schoolAPI: { list: vi.fn(() => Promise.resolve({ schools: [] })) },
  setupAPI: {
    getAlertTypes: vi.fn(() => Promise.resolve({
      alertTypes: [{ label: 'Fire', value: 'fire', emoji: '🔥' }],
    })),
    getLocations: vi.fn(() => Promise.resolve({ locations: [{ label: 'Main Building' }] })),
  },
}))

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue(CREATED)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Fills the form, previews, submits, and returns the confirmation dialog.
async function submitAnAlert() {
  render(
    <MemoryRouter>
      <SubmitAlert />
    </MemoryRouter>
  )

  await screen.findByRole('button', { name: /preview alert/i })

  fireEvent.click(screen.getByRole('button', { name: /fire/i }))
  fireEvent.click(screen.getByRole('button', { name: /high/i }))
  fireEvent.change(screen.getByPlaceholderText(/brief description of the incident/i), {
    target: { value: 'Smoke in B block' },
  })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Main Building' } })

  fireEvent.click(screen.getByRole('button', { name: /preview alert/i }))
  fireEvent.click(await screen.findByRole('button', { name: /confirm and submit alert/i }))

  await screen.findByRole('dialog')
}

describe('SCRUM-41 submitting the same alert twice', () => {
  test('saves the alert once on a normal submit', async () => {
    await submitAnAlert()

    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  test('pressing the submit button again does not save a second alert', async () => {
    await submitAnAlert()

    // This is the bug. The button sits behind the confirmation and used to
    // still work, so a second identical incident was created.
    fireEvent.click(screen.getByRole('button', { name: /confirm and submit alert/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
  })

  test('the submit button is disabled once the alert has been sent', async () => {
    await submitAnAlert()

    expect(screen.getByRole('button', { name: /confirm and submit alert/i })).toBeDisabled()
  })

  test('focus starts inside the confirmation, not on the page behind', async () => {
    await submitAnAlert()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(document.activeElement)
  })

  test('a new alert can still be submitted after choosing Submit another', async () => {
    await submitAnAlert()

    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: /submit another/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Back to an empty form, and the form is usable again.
    expect(await screen.findByRole('button', { name: /preview alert/i })).toBeEnabled()
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})
