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
    fireEvent.click(screen.getByRole('button', { name: /submit alert/i }))

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
    fireEvent.click(screen.getByRole('button', { name: /submit alert/i }))

    expect(await screen.findByText(/enter a meaningful title/i)).toBeInTheDocument()
    expect(incidentAPI.create).not.toHaveBeenCalled()
  })

  test('fills form, submits alert, and calls API', async () => {
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
      screen.getByRole('button', { name: /submit alert/i })
    )

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
