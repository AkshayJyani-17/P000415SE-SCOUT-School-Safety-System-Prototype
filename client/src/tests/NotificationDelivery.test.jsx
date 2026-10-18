// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Notifications, { RECEIPT_POLL_INTERVAL_MS } from '../pages/Notifications'
import { notificationsAPI } from '../api/client'

// Covers delivery tracking on the Notifications page: confirmed delivery,
// failure reasons, retrying a failed channel, and refreshing while receipts
// are still expected.

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    userRole: 'School Admin',
    isCompanyAdmin: false,
    isSchoolAdmin: true,
    authLoading: false,
  }),
}))

vi.mock('../context/SchoolsContext', () => ({
  useSchools: () => ({ schools: [{ id: 'north', name: 'Northside Primary' }] }),
}))

vi.mock('../api/client', () => ({
  notificationsAPI: {
    list: vi.fn(),
    retry: vi.fn(),
  },
}))

const OLD = '2026-01-01T00:00:00.000Z'

function record(overrides) {
  return {
    id: 'n1',
    incidentTitle: 'Fire - Block B',
    type: 'fire',
    recipientName: 'Fire Warden',
    recipientEmail: 'warden@school.test',
    recipientPhone: '0412345678',
    email: 'sent',
    sms: 'sent',
    timestamp: OLD,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>
  )
}

function rowFor(name) {
  return screen.getByText(new RegExp(name)).closest('.px-4.py-4')
}

beforeEach(() => {
  notificationsAPI.list.mockReset()
  notificationsAPI.retry.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Notification delivery tracking', () => {
  test('shows confirmed delivery with the time it was confirmed', async () => {
    notificationsAPI.list.mockResolvedValue([
      record({ email: 'delivered', emailDeliveredAt: '2026-01-01T00:01:00.000Z', sms: 'skipped' }),
    ])

    renderPage()

    expect(await screen.findByText(/Email delivered/i)).toBeInTheDocument()
    expect(screen.getByText(/^Delivered \d/)).toBeInTheDocument()
    expect(screen.getByText('Delivery Confirmed').previousSibling).toHaveTextContent('1')
  })

  test('counts delivered messages as sent in the summary', async () => {
    notificationsAPI.list.mockResolvedValue([
      record({ id: 'n1', email: 'delivered', sms: 'skipped' }),
      record({ id: 'n2', recipientName: 'Office', email: 'sent', sms: 'skipped' }),
      record({ id: 'n3', recipientName: 'Nobody', email: 'failed', sms: 'failed' }),
    ])

    renderPage()
    await screen.findByText(/Email delivered/i)

    expect(screen.getByText('Total Sent').previousSibling).toHaveTextContent('2')
    expect(screen.getByText('SMS Failed').previousSibling).toHaveTextContent('1')
    expect(screen.getByText('Email Failed').previousSibling).toHaveTextContent('1')
  })

  test('shows the recipient phone number alongside the email', async () => {
    notificationsAPI.list.mockResolvedValue([record()])

    renderPage()

    expect(await screen.findByText(/0412345678/)).toBeInTheDocument()
    expect(screen.getByText(/warden@school\.test/)).toBeInTheDocument()
  })

  test('shows why a notification failed', async () => {
    notificationsAPI.list.mockResolvedValue([
      record({ sms: 'failed', smsError: 'SMS provider rejected the message: insufficient credit' }),
    ])

    renderPage()

    expect(await screen.findByText('SMS provider rejected the message: insufficient credit')).toBeInTheDocument()
    expect(screen.getByText(/failed to deliver/i)).toBeInTheDocument()
  })

  test('offers Retry only on failed channels', async () => {
    notificationsAPI.list.mockResolvedValue([
      record({ sms: 'failed', email: 'delivered' }),
    ])

    renderPage()

    expect(await screen.findByRole('button', { name: 'Retry SMS' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry Email' })).not.toBeInTheDocument()
  })

  test('retrying a channel updates the record in place', async () => {
    notificationsAPI.list.mockResolvedValue([
      record({ sms: 'failed', smsError: 'SMS provider rejected the message: insufficient credit' }),
    ])
    notificationsAPI.retry.mockResolvedValue(record({ sms: 'sent', smsError: null, smsAttempts: 2 }))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry SMS' }))

    expect(notificationsAPI.retry).toHaveBeenCalledWith('n1', 'sms')
    await waitFor(() => expect(within(rowFor('Fire Warden')).getByText(/SMS sent/i)).toBeInTheDocument())
    expect(screen.queryByText(/insufficient credit/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry SMS' })).not.toBeInTheDocument()
  })

  test('a retry that fails again shows the new reason', async () => {
    notificationsAPI.list.mockResolvedValue([record({ email: 'failed', emailError: 'old reason' })])
    notificationsAPI.retry.mockResolvedValue(record({ email: 'failed', emailError: 'Email provider rejected the message: sender is not valid' }))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Email' }))

    expect(await screen.findByText('Email provider rejected the message: sender is not valid')).toBeInTheDocument()
    expect(screen.queryByText('old reason')).not.toBeInTheDocument()
  })

  test('a rejected retry request is reported on the row', async () => {
    notificationsAPI.list.mockResolvedValue([record({ sms: 'failed' })])
    notificationsAPI.retry.mockRejectedValue(new Error('Only a failed SMS can be retried.'))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry SMS' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only a failed SMS can be retried.')
  })

  test('Retry buttons are disabled while a retry is in progress', async () => {
    notificationsAPI.list.mockResolvedValue([
      record({ id: 'n1', sms: 'failed' }),
      record({ id: 'n2', recipientName: 'Office', email: 'failed', sms: 'skipped' }),
    ])
    let finishRetry
    notificationsAPI.retry.mockReturnValue(new Promise(resolve => { finishRetry = resolve }))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry SMS' }))

    expect(await screen.findByRole('button', { name: 'Retry SMS' })).toHaveTextContent('Retrying...')
    expect(screen.getByRole('button', { name: 'Retry SMS' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retry Email' })).toBeDisabled()

    await act(async () => finishRetry(record({ id: 'n1', sms: 'sent' })))
    expect(screen.getByRole('button', { name: 'Retry Email' })).toBeEnabled()
  })

  test('the delivered filter shows only confirmed deliveries', async () => {
    notificationsAPI.list.mockResolvedValue([
      record({ id: 'n1', recipientName: 'Delivered Person', email: 'delivered', sms: 'skipped' }),
      record({ id: 'n2', recipientName: 'Waiting Person', email: 'sent', sms: 'skipped' }),
    ])

    renderPage()
    await screen.findByText(/Delivered Person/)

    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'delivered' } })

    expect(screen.getByText(/Delivered Person/)).toBeInTheDocument()
    expect(screen.queryByText(/Waiting Person/)).not.toBeInTheDocument()
  })

  test('refreshes on its own while recent messages are awaiting a receipt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    notificationsAPI.list
      .mockResolvedValueOnce([record({ email: 'sent', sms: 'skipped', timestamp: new Date().toISOString() })])
      .mockResolvedValueOnce([record({ email: 'delivered', sms: 'skipped', timestamp: new Date().toISOString() })])

    renderPage()
    expect(await screen.findByText(/Email sent/i)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECEIPT_POLL_INTERVAL_MS)
    })

    expect(await screen.findByText(/Email delivered/i)).toBeInTheDocument()
    expect(notificationsAPI.list).toHaveBeenCalledTimes(2)
  })

  test('does not keep polling for old messages that never got a receipt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    notificationsAPI.list.mockResolvedValue([record({ email: 'sent', sms: 'sent', timestamp: OLD })])

    renderPage()
    await screen.findByText(/Email sent/i)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECEIPT_POLL_INTERVAL_MS * 3)
    })

    expect(notificationsAPI.list).toHaveBeenCalledTimes(1)
  })
})
