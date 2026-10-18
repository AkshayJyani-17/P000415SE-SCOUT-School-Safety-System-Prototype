// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Notifications from '../pages/Notifications'
import { notificationsAPI } from '../api/client'

const role = vi.hoisted(() => ({ isCompanyAdmin: true, isSchoolAdmin: false }))

afterEach(() => {
  cleanup()
  role.isCompanyAdmin = true
  role.isSchoolAdmin = false
  vi.clearAllMocks()
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'admin@school.edu' },
    userRole: 'Company Admin',
    ...role,
    isStaff: false,
    isAdmin: true,
    authLoading: false,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({ schools: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ] }),
}))

vi.mock('../api/client', () => ({
  notificationsAPI: {
    list: vi.fn(() =>
      Promise.resolve([
        {
          id: '1',
          incidentId: 'INC001',
          incidentTitle: 'Fire Alert',
          recipientName: 'John Staff',
          recipientEmail: 'john@school.edu',
          recipientPhone: '0400000000',
          sms: 'sent',
          email: 'sent',
          type: 'fire',
          timestamp: '2026-05-12 10:00',
        },
        {
          id: '2',
          incidentId: 'INC002',
          incidentTitle: 'Medical Emergency',
          recipientName: 'Sarah Admin',
          recipientEmail: 'sarah@school.edu',
          recipientPhone: '',
          sms: 'skipped',
          email: 'sent',
          type: 'medical',
          timestamp: '2026-05-12 11:00',
        },
      ])
    ),
  },
}))

describe('Notifications Page', () => {
  test('renders notification data from API', async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/fire alert/i)).toBeInTheDocument()
      expect(screen.getByText(/john staff/i)).toBeInTheDocument()
    })
  })

  test('renders multiple notification records', async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/fire alert/i)).toBeInTheDocument()
      expect(screen.getByText(/medical emergency/i)).toBeInTheDocument()
      expect(screen.getByText(/sarah admin/i)).toBeInTheDocument()
    })
  })

  test('renders notification status badges', async () => {
  render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>
  )

  await waitFor(() => {
    expect(screen.getByText(/fire alert/i)).toBeInTheDocument()
  })

  expect(screen.getAllByText(/SMS sent/i).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Email sent/i).length).toBeGreaterThan(0)
  expect(screen.getByText(/SMS skipped/i)).toBeInTheDocument()
})

  test('renders email and sms statuses', async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getAllByText(/SMS sent/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Email sent/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/SMS skipped/i)).toBeInTheDocument()
    })
  })
})

const filterRecords = [
  { id: 'a', incidentTitle: 'Alpha fire', schoolId: 'a', schoolName: 'Alpha', type: 'fire', sms: 'failed', email: 'sent', timestamp: '2026-05-11T14:00:00Z' },
  { id: 'b', incidentTitle: 'Beta fire', schoolId: 'b', schoolName: 'Beta', type: 'fire', sms: 'sent', email: 'failed', timestamp: '2026-05-12T13:59:59Z' },
  { id: 'c', incidentTitle: 'Alpha medical', schoolId: 'a', schoolName: 'Alpha', type: 'medical', sms: 'sent', timestamp: '2026-05-12T14:00:00Z' },
  { id: 'd', incidentTitle: 'Missing fields' },
  { id: 'e', incidentTitle: 'Invalid timestamp', timestamp: 'invalid' },
]
async function renderFilters() {
  notificationsAPI.list.mockResolvedValueOnce(filterRecords)
  render(<MemoryRouter><Notifications /></MemoryRouter>)
  await screen.findByText('Alpha fire')
}
const changeFilter = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('Notification filtering', () => {
  test('combines every filter automatically, displays active values, and clears all', async () => {
    await renderFilters()
    changeFilter('School', 'id:a')
    changeFilter('Notification type', 'fire')
    changeFilter('Channel', 'sms')
    changeFilter('Status', 'failed')
    changeFilter('From date (Sydney)', '2026-05-12')
    changeFilter('To date (Sydney)', '2026-05-12')
    expect(screen.getByText('Alpha fire')).toBeInTheDocument()
    for (const title of ['Beta fire', 'Alpha medical', 'Missing fields']) expect(screen.queryByText(title)).not.toBeInTheDocument()
    for (const text of ['School: Alpha', 'Type: fire', 'Channel: SMS', 'Status: failed', 'From: 2026-05-12', 'To: 2026-05-12']) expect(screen.getByText(text)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear All Filters' }))
    for (const record of filterRecords) expect(screen.getByText(record.incidentTitle)).toBeInTheDocument()
    for (const label of ['School', 'Notification type', 'Channel', 'Status']) expect(screen.getByLabelText(label)).toHaveValue('all')
    for (const label of ['From date (Sydney)', 'To date (Sydney)']) expect(screen.getByLabelText(label)).toHaveValue('')
    expect(screen.getByText('No active filters')).toBeInTheDocument()
  })
  test('includes both Sydney day boundaries and excludes missing or invalid timestamps', async () => {
    await renderFilters()
    changeFilter('From date (Sydney)', '2026-05-12')
    changeFilter('To date (Sydney)', '2026-05-12')
    expect(screen.getByText('Alpha fire')).toBeInTheDocument()
    expect(screen.getByText('Beta fire')).toBeInTheDocument()
    for (const title of ['Alpha medical', 'Missing fields', 'Invalid timestamp']) expect(screen.queryByText(title)).not.toBeInTheDocument()
  })
  test('handles open-ended dates and invalid ranges', async () => {
    await renderFilters()
    changeFilter('From date (Sydney)', '2026-05-13')
    expect(screen.getByText('Alpha medical')).toBeInTheDocument()
    expect(screen.queryByText('Alpha fire')).not.toBeInTheDocument()
    changeFilter('To date (Sydney)', '2026-05-12')
    expect(screen.getByRole('alert')).toHaveTextContent('From date must be on or before To date.')
    expect(screen.getByText('No notifications match your filters.')).toBeInTheDocument()
    changeFilter('From date (Sydney)', '')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Beta fire')).toBeInTheDocument()
    expect(screen.queryByText('Alpha medical')).not.toBeInTheDocument()
  })
  test('handles unknown fields and matches status within the selected channel', async () => {
    await renderFilters()
    changeFilter('Notification type', 'unknown')
    expect(screen.getByText('Missing fields')).toBeInTheDocument()
    changeFilter('Status', 'sent')
    expect(screen.getByText('No notifications match your filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear All Filters' }))
    changeFilter('Status', 'failed')
    expect(screen.getByText('Beta fire')).toBeInTheDocument()
    changeFilter('Channel', 'sms')
    expect(screen.queryByText('Beta fire')).not.toBeInTheDocument()
    changeFilter('Channel', 'email')
    expect(screen.getByText('Beta fire')).toBeInTheDocument()
    expect(screen.queryByText('Alpha fire')).not.toBeInTheDocument()
  })
  test('preserves selected filters on refresh', async () => {
    await renderFilters()
    changeFilter('Notification type', 'medical')
    notificationsAPI.list.mockResolvedValueOnce(filterRecords)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Alpha medical')
    expect(screen.queryByText('Alpha fire')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Notification type')).toHaveValue('medical')
  })
  test('handles no notifications', async () => {
    notificationsAPI.list.mockResolvedValueOnce([])
    render(<MemoryRouter><Notifications /></MemoryRouter>)
    expect(await screen.findByText('No notifications match your filters.')).toBeInTheDocument()
  })
})

describe('Notification role access', () => {
  test('school admins have no school selector and retain their school view', async () => {
    role.isCompanyAdmin = false
    role.isSchoolAdmin = true
    await renderFilters()
    expect(screen.queryByLabelText('School')).not.toBeInTheDocument()
    expect(screen.getByText('School view only')).toBeInTheDocument()
  })
  test('unauthorized roles cannot fetch notifications', () => {
    role.isCompanyAdmin = false
    render(<MemoryRouter><Notifications /></MemoryRouter>)
    expect(notificationsAPI.list).not.toHaveBeenCalled()
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument()
  })
})
