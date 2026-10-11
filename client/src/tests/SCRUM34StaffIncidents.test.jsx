// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Incidents from '../pages/Incidents'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'staff' }, userRole: 'Staff', authLoading: false, isCompanyAdmin: false, isSchoolAdmin: false }) }))
vi.mock('../context/SchoolsContext', () => ({ useSchools: () => ({ schools: [] }) }))
vi.mock('../api/client', () => ({
  getIncidents: vi.fn(async () => [
    { id: 'own', title: 'My alert', triggeredById: 'staff', status: 'in-progress', priority: 'high', location: 'Library', createdAt: '2020-01-01T01:00:00Z', updatedAt: '2020-01-01T02:00:00Z' },
    { id: 'assigned', title: 'Assigned alert', assignedUserIds: ['staff'], status: 'resolved', priority: 'low', location: 'Office' },
  ]),
  settingsAPI: { get: vi.fn(async () => ({ overdueThresholdMinutes: 15 })) },
  archiveAPI: { list: vi.fn() },
}))
afterEach(cleanup)
test('Staff has readable status and timeline, detail navigation and no admin controls', async () => {
  render(<MemoryRouter><Incidents /></MemoryRouter>)
  const link = await screen.findByRole('link', { name: 'My alert' })
  expect(link).toHaveAttribute('href', '/incidents/own')
  const card = within(link.closest('article'))
  expect(card.getByText('In Progress')).toBeInTheDocument()
  expect(card.getByText('Created')).toBeInTheDocument()
  expect(card.getByText('Updated')).toBeInTheDocument()
  expect(link.closest('article').querySelectorAll('time')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /export|delete/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /archived|review required/i })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /submit alert/i })).toBeInTheDocument()
})
test('Staff retains filters and handles missing dates', async () => {
  render(<MemoryRouter><Incidents /></MemoryRouter>)
  await screen.findByText('My alert')
  expect(screen.queryByText('Assigned alert')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'all' } })
  expect(screen.getByText('Assigned alert')).toBeInTheDocument()
  expect(screen.getByText('Time unavailable')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), { target: { value: 'high' } })
  expect(screen.queryByText('Assigned alert')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search incidents' }), { target: { value: 'Library' } })
  expect(screen.getByText('My alert')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Date range' }), { target: { value: 'today' } })
  expect(screen.getByText('No incidents found.')).toBeInTheDocument()
})
