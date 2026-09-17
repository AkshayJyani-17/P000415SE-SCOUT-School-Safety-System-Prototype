// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import Setup from '../pages/Setup'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isCompanyAdmin: false, isSchoolAdmin: true }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({ allSchools: [], loading: false }),
}))

vi.mock('../api/client', () => ({
  settingsAPI: { get: vi.fn(() => Promise.resolve({})) },
  archiveAPI: { run: vi.fn() },
  setupAPI: {
    getRouting: vi.fn(() => Promise.resolve({ routing: [] })),
    getAlertTypes: vi.fn(() => Promise.resolve({
      alertTypes: [{ label: 'Fire', emoji: '🔥', category: 'emergency' }],
    })),
    getSchoolUsers: vi.fn(() => Promise.resolve({
      users: [{ id: '1', name: 'Teacher', email: 'teacher@school.edu', role: 'Staff' }],
    })),
    updateSchoolUser: vi.fn(() => Promise.resolve({ success: true })),
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function showTeacher() {
  render(<Setup />)
  fireEvent.click(await screen.findByRole('button', { name: /emergency type/i }))
  fireEvent.click(screen.getByRole('option', { name: /fire/i }))
  await screen.findByText('Teacher')
}

describe('Setup contact validation', () => {
  test('shows an error for an invalid phone', async () => {
    const { setupAPI } = await import('../api/client')
    await showTeacher()
    fireEvent.click(screen.getByRole('button', { name: /phone/i }))
    fireEvent.change(screen.getByPlaceholderText(/61 400 000 000/i), {
      target: { value: 'demo@demo' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1))

    expect(await screen.findByText(/enter a valid phone number/i)).toBeInTheDocument()
    expect(setupAPI.updateSchoolUser).not.toHaveBeenCalled()
  })

  test('shows an error for an invalid email', async () => {
    const { setupAPI } = await import('../api/client')
    await showTeacher()
    fireEvent.click(screen.getByRole('button', { name: /email/i }))
    fireEvent.change(screen.getByPlaceholderText(/teacher@school.edu/i), {
      target: { value: 'teacher@' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1))

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument()
    expect(setupAPI.updateSchoolUser).not.toHaveBeenCalled()
  })

  test('saves a valid email', async () => {
    const { setupAPI } = await import('../api/client')
    await showTeacher()
    fireEvent.click(screen.getByRole('button', { name: /email/i }))
    fireEvent.change(screen.getByPlaceholderText(/teacher@school.edu/i), {
      target: { value: 'newteacher@school.edu' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1))

    await waitFor(() => {
      expect(setupAPI.updateSchoolUser).toHaveBeenCalledWith('1', {
        email: 'newteacher@school.edu',
      })
    })
  })
})
