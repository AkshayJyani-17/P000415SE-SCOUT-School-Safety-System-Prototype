// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard'
const stream = vi.hoisted(() => ({ data: null, state: null, stop: vi.fn() }))
vi.mock('../api/client', () => ({ incidentAPI: {}, settingsAPI: {}, subscribeToIncidents: (data, state) => { stream.data = data; stream.state = state; return stream.stop } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'staff' }, userRole: 'Staff', isStaff: true }) }))
vi.mock('../context/SchoolsContext', () => ({ useSchools: () => ({ schools: [] }) }))
vi.mock('../components/QuickActions', () => ({ default: () => null }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const incident = { id: 'old', title: 'Older active incident', status: 'acknowledged', location: 'Library', priority: 'high', createdAt: '2026-01-01T10:00:00Z', acknowledgedBy: [{ name: 'Alex' }] }
test('retains older active records, live transitions, and last known status on disconnect', () => {
  const { unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>)
  const completed = Array.from({ length: 12 }, (_, i) => ({ ...incident, id: `${i}`, title: `Completed ${i}`, status: 'resolved', createdAt: '2026-09-01T10:00:00Z' }))
  act(() => { stream.data([...completed, incident]); stream.state('live') })
  expect(screen.getByText('Older active incident')).toBeInTheDocument()
  expect(screen.getByText('Responders: Alex')).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(11)
  act(() => stream.data([{ ...incident, status: 'in-progress' }]))
  expect(screen.getByText('In progress')).toBeInTheDocument()
  act(() => stream.state('error'))
  expect(screen.getByText(/may be out of date/)).toBeInTheDocument()
  expect(screen.getByText('In progress')).toBeInTheDocument()
  act(() => { stream.data([{ ...incident, status: 'resolved' }]); stream.state('live') })
  expect(screen.getByText('Resolved')).toBeInTheDocument()
  unmount()
  expect(stream.stop).toHaveBeenCalledOnce()
})
test('initial connection failure is not an empty success', () => {
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
  act(() => stream.state('error'))
  expect(screen.getByText(/Unable to load incident status/)).toBeInTheDocument()
})
