// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import SubmitAlert from '../pages/SubmitAlert'

const mockNavigate = vi.fn()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'staff@school.edu' },
    userRole: 'Staff',
    isStaff: true,
    authLoading: false,
  }),
}))

vi.mock('../api/client', () => ({
  incidentAPI: {
    previewRecipients: vi.fn(() => Promise.resolve({ recipients: [{ name: 'Fire Warden', email: 'warden@school.edu' }] })),
    create: vi.fn(() =>
      Promise.resolve({
        id: '1',
        title: 'Fire near science block',
      })
    ),
  },
  setupAPI: {
    getAlertTypes: vi.fn(() =>
      Promise.resolve({
        alertTypes: [
          { label: 'Fire', emoji: '🔥' },
          { label: 'Medical', emoji: '🏥' },
        ],
      })
    ),
    getLocations: vi.fn(() =>
      Promise.resolve({
        locations: [
          { label: 'Block A' },
          { label: 'Science Block' },
        ],
      })
    ),
  },
}))

describe('Submit Alert Interaction Test', () => {
  test('does not submit a one-letter title', async () => {
    const { incidentAPI } = await import('../api/client')

    render(
      <MemoryRouter>
        <SubmitAlert />
      </MemoryRouter>
    )

    fireEvent.change(
      screen.getByPlaceholderText(/brief description of the incident/i),
      { target: { value: 's' } }
    )
    fireEvent.click(screen.getByRole('button', { name: /preview alert/i }))

    expect(await screen.findByText(/enter a meaningful title/i)).toBeInTheDocument()
    expect(incidentAPI.create).not.toHaveBeenCalled()
  })

  test('does not submit a number-only title', async () => {
    const { incidentAPI } = await import('../api/client')

    render(
      <MemoryRouter>
        <SubmitAlert />
      </MemoryRouter>
    )

    fireEvent.change(
      screen.getByPlaceholderText(/brief description of the incident/i),
      { target: { value: '33245576432' } }
    )
    fireEvent.click(screen.getByRole('button', { name: /preview alert/i }))

    expect(await screen.findByText(/enter a meaningful title/i)).toBeInTheDocument()
    expect(incidentAPI.create).not.toHaveBeenCalled()
  })

  test('previews details and recipients before submitting, and can return to edit', async () => {
    const { incidentAPI } = await import('../api/client')

    render(
      <MemoryRouter>
        <SubmitAlert />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /fire/i }))
    fireEvent.click(screen.getByRole('button', { name: /high/i }))

    fireEvent.change(
      screen.getByPlaceholderText(/brief description of the incident/i),
      {
        target: { value: 'Fire near science block' },
      }
    )

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'Block A' },
    })

    fireEvent.change(
      screen.getByPlaceholderText(/any additional details/i),
      {
        target: { value: 'Smoke reported near the classroom area.' },
      }
    )

    fireEvent.click(
      screen.getByRole('button', { name: /preview alert/i })
    )

    expect(await screen.findByRole('heading', { name: /review alert/i })).toBeInTheDocument()
    expect(screen.getByText('warden@school.edu')).toBeInTheDocument()
    expect(screen.getByText(/smoke reported near the classroom area/i)).toBeInTheDocument()
    expect(incidentAPI.create).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /edit alert/i }))
    expect(screen.getByDisplayValue('Fire near science block')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /preview alert/i }))
    await screen.findByRole('heading', { name: /review alert/i })
    fireEvent.click(screen.getByRole('button', { name: /confirm and submit alert/i }))
    await waitFor(() => {
      expect(incidentAPI.create).toHaveBeenCalled()
    })
  })

  test('renders Submit Alert form successfully', async () => {
    render(
      <MemoryRouter>
        <SubmitAlert />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/alert type/i)).toBeInTheDocument()
    })
  })
})
