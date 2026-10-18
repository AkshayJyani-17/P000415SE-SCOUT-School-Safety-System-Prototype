// Lifecycle of a notification record: created per recipient before anything is
// sent, updated as each channel is accepted or rejected by its provider, and
// updated again when the provider reports final delivery through a webhook.
//
// Each channel moves through these statuses:
//   pending   -> sent       the provider accepted the message
//   sent      -> delivered  the provider confirmed it reached the recipient
//   pending/sent -> failed  rejected on send, or reported undeliverable later
//   skipped                 the recipient is not set up for this channel
//
// The channel status lives in the `email` and `sms` fields so existing readers
// (analytics, incident detail) keep working; the details sit alongside them as
// `emailError`, `smsMessageId`, `smsDeliveredAt` and so on.

const { getDb } = require('../db/firebase')
const { sendEmail } = require('./emailService')
const { sendSms } = require('./smsService')

const CHANNELS = ['email', 'sms']
const DEFAULT_ALERT_MESSAGE = 'An emergency has been declared at the school. Please respond immediately.'

function getBackendUrl() {
  return process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`
}

function isChannel(channel) {
  return CHANNELS.includes(channel)
}

function field(channel, name) {
  return `${channel}${name}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function acknowledgeLinkFor(token) {
  return `${getBackendUrl()}/api/notifications/acknowledge/${token}`
}

// ── Message content ───────────────────────────────────────────────────────────

function buildAlertEmail({ emergencyType, location, message, token }) {
  const acknowledgeLink = acknowledgeLinkFor(token)
  const subject = `EMERGENCY ALERT: ${emergencyType}${location ? ` - ${location}` : ''}`
  const body = message || DEFAULT_ALERT_MESSAGE

  const text = [
    `EMERGENCY ALERT: ${emergencyType}`,
    location ? `Location: ${location}` : null,
    '',
    body,
    '',
    `Acknowledge this alert: ${acknowledgeLink}`,
  ].filter(line => line !== null).join('\n')

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #dc2626; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">EMERGENCY ALERT</h1>
        <p style="color: #fecaca; margin: 4px 0 0;">SCOUT School Safety Management System</p>
      </div>
      <div style="background: #fff; border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 8px 8px;">
        <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px;">Emergency Type</p>
        <p style="font-size: 18px; font-weight: bold; color: #dc2626; margin: 0 0 16px;">${escapeHtml(emergencyType)}</p>
        ${location ? `<p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px;">Location</p><p style="font-size: 15px; color: #111827; margin: 0 0 16px;">${escapeHtml(location)}</p>` : ''}
        <p style="color: #374151; font-size: 15px;">${escapeHtml(body)}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <div style="text-align: center; margin: 24px 0;">
          <a
            href="${escapeHtml(acknowledgeLink)}"
            style="background: #16a34a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block;"
          >
            I am responding - Acknowledge Alert
          </a>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 12px;">
            Click the button above to confirm you have received this alert and are responding.
          </p>
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 12px;">
          This is an automated emergency alert from the SCOUT School Safety System.
          Please do not reply to this email.
        </p>
      </div>
    </div>
  `

  return { subject, html, text }
}

// The acknowledge link is included so SMS-only recipients can respond too.
function buildAlertSms({ emergencyType, location, token }) {
  return `SCOUT EMERGENCY: ${emergencyType}${location ? ` at ${location}` : ''}. ` +
    `Please respond immediately. Acknowledge: ${acknowledgeLinkFor(token)}`
}

function buildAdminSummaryEmail({ emergencyType, location, message, timestamp, incidentId, schoolName, results }) {
  const formattedTime = new Date(timestamp).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'full',
    timeStyle: 'short',
  })

  const cell = 'padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;'
  const label = 'padding: 8px 12px; background: #f8fafc; font-weight: bold; font-size: 14px; border-bottom: 1px solid #e5e7eb;'
  const statusColour = status => (status === 'sent' || status === 'delivered' ? '#16a34a' : status === 'failed' ? '#dc2626' : '#6b7280')

  const detailRow = (name, value, style = '') => `
    <tr>
      <td style="${label} width: 40%;">${name}</td>
      <td style="${cell} ${style}">${value}</td>
    </tr>`

  const staffRows = results.map(result => `
    <tr>
      <td style="${cell}">${escapeHtml(result.name)}</td>
      <td style="${cell}">${escapeHtml(result.role)}</td>
      <td style="${cell} color: ${statusColour(result.emailStatus)};">${escapeHtml(result.emailStatus)}</td>
      <td style="${cell} color: ${statusColour(result.smsStatus)};">${escapeHtml(result.smsStatus)}</td>
    </tr>
  `).join('')

  const subject = `SCOUT Admin Summary: ${emergencyType} Emergency Alert`
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1e293b; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px;">Emergency Alert Summary</h1>
        <p style="color: #94a3b8; margin: 4px 0 0; font-size: 14px;">SCOUT School Safety Management System - Admin Record</p>
      </div>
      <div style="background: #fff; border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 8px 8px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          ${detailRow('Emergency Type', escapeHtml(emergencyType), 'color: #dc2626; font-weight: bold;')}
          ${location ? detailRow('Location', escapeHtml(location)) : ''}
          ${schoolName ? detailRow('School', escapeHtml(schoolName)) : ''}
          ${detailRow('Date &amp; Time', escapeHtml(formattedTime))}
          ${detailRow('Incident ID', escapeHtml(incidentId || 'N/A'), 'font-family: monospace;')}
          ${detailRow('Message', escapeHtml(message || DEFAULT_ALERT_MESSAGE))}
        </table>

        <h3 style="font-size: 15px; color: #1e293b; margin: 0 0 8px;">Staff Notified</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr style="background: #f8fafc;">
            <th style="${cell} text-align: left; font-size: 13px;">Name</th>
            <th style="${cell} text-align: left; font-size: 13px;">Role</th>
            <th style="${cell} text-align: left; font-size: 13px;">Email</th>
            <th style="${cell} text-align: left; font-size: 13px;">SMS</th>
          </tr>
          ${staffRows}
        </table>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 12px;">
          This is an automated summary for administrative records. No action is required from you.
          Final delivery status for each recipient is shown on the Notifications page.
        </p>
      </div>
    </div>
  `

  const text = `Emergency Alert Summary - ${emergencyType} at ${location || 'Unknown location'} on ${formattedTime}. ` +
    `Incident ID: ${incidentId || 'N/A'}. Staff notified: ${results.map(result => result.name).join(', ')}`

  return { subject, html, text }
}

// ── Records ───────────────────────────────────────────────────────────────────

function wantsChannel(notify, channel) {
  if (channel === 'email') return !notify || notify === 'email' || notify === 'both'
  return notify === 'sms' || notify === 'both'
}

// A recipient asked to receive a channel they have no contact details for is a
// routing mistake, so it is recorded as a failure the admin can see and fix.
function initialChannelState(recipient, channel) {
  if (!wantsChannel(recipient.notify, channel)) {
    return { status: 'skipped', error: null }
  }

  const contact = channel === 'email' ? recipient.email : recipient.phone
  if (!contact) {
    const missing = channel === 'email' ? 'email address' : 'phone number'
    return { status: 'failed', error: `No ${missing} is configured for this recipient.` }
  }

  return { status: 'pending', error: null }
}

// Attached to each outgoing message and echoed back in its receipts. The
// attempt number keeps a late receipt for an earlier attempt from being
// applied to a retry.
function channelReference(notificationId, attempt) {
  return `${notificationId}#${attempt}`
}

function buildNotificationRecord({ id, recipient, alert, schoolId, schoolName, incidentId, token, timestamp }) {
  const record = {
    incidentId: incidentId || null,
    schoolId: schoolId || null,
    schoolName: schoolName || null,
    incidentTitle: `${alert.emergencyType}${alert.location ? ` - ${alert.location}` : ''}`,
    type: alert.emergencyType.toLowerCase(),
    emergencyType: alert.emergencyType,
    location: alert.location || null,
    message: alert.message || null,
    recipientName: recipient.name,
    recipientEmail: recipient.email || null,
    recipientPhone: recipient.phone || null,
    recipientRole: recipient.role,
    token,
    acknowledged: false,
    acknowledgedAt: null,
    timestamp,
  }

  for (const channel of CHANNELS) {
    const { status, error } = initialChannelState(recipient, channel)
    Object.assign(record, {
      [channel]: status,
      [field(channel, 'Error')]: error,
      [field(channel, 'MessageId')]: null,
      [field(channel, 'Reference')]: status === 'pending' ? channelReference(id, 1) : null,
      [field(channel, 'Attempts')]: 0,
      [field(channel, 'SentAt')]: null,
      [field(channel, 'DeliveredAt')]: null,
      [field(channel, 'FailedAt')]: status === 'failed' ? timestamp : null,
    })
  }

  return record
}

// ── Sending ───────────────────────────────────────────────────────────────────

async function recordSendResult(ref, channel, { messageId = null, error = null }) {
  const now = new Date().toISOString()

  await getDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return
    const current = snapshot.data()

    const update = {
      [field(channel, 'Attempts')]: (current[field(channel, 'Attempts')] || 0) + 1,
    }

    if (error) {
      Object.assign(update, {
        [channel]: 'failed',
        [field(channel, 'Error')]: error,
        [field(channel, 'FailedAt')]: now,
      })
    } else {
      Object.assign(update, {
        [field(channel, 'MessageId')]: messageId,
        [field(channel, 'SentAt')]: now,
      })
      // A delivery receipt can beat this write; never step back from it.
      if (current[channel] === 'pending') update[channel] = 'sent'
    }

    transaction.update(ref, update)
  })
}

/**
 * Sends one channel of a notification and records the outcome. Never throws:
 * a failure is logged, written to the record with its reason, and returned.
 *
 * `ref` may be null when the record could not be created. The alert is still
 * sent in that case, because reaching staff matters more than the audit trail.
 */
async function dispatchChannel(ref, notification, channel) {
  const reference = notification[field(channel, 'Reference')] || null
  // Records from before delivery tracking only kept the combined title.
  const alert = {
    emergencyType: notification.emergencyType || notification.incidentTitle || 'Emergency',
    location: notification.location,
    message: notification.message,
    token: notification.token,
  }

  let outcome
  try {
    const { messageId } = channel === 'email'
      ? await sendEmail({ to: notification.recipientEmail, toName: notification.recipientName, reference, ...buildAlertEmail(alert) })
      : await sendSms({ to: notification.recipientPhone, body: buildAlertSms(alert), reference })

    outcome = { status: 'sent', error: null, messageId }
    console.log(`[notifications] ${channel} accepted for ${notification.recipientName}`)
  } catch (err) {
    outcome = { status: 'failed', error: err.message, messageId: null }
    console.error(
      `[notifications] ${channel} failed for ${notification.recipientName}` +
      ` (incident ${notification.incidentId || 'none'}): ${err.message}`
    )
  }

  if (ref) {
    try {
      await recordSendResult(ref, channel, outcome)
    } catch (err) {
      console.error(`[notifications] Could not record ${channel} result for ${ref.id}:`, err.message)
    }
  }

  return outcome
}

async function sendAdminSummary(admins, summary) {
  const content = buildAdminSummaryEmail(summary)

  await Promise.all(admins.map(async adminUser => {
    try {
      await sendEmail({ to: adminUser.email, toName: adminUser.name, ...content })
    } catch (err) {
      console.error(`[notifications] Admin summary email failed for ${adminUser.name}:`, err.message)
    }
  }))
}

// ── Retry ─────────────────────────────────────────────────────────────────────

class RetryRejectedError extends Error {}

/**
 * Moves a failed channel back to pending so it can be resent. Done in a
 * transaction so two admins pressing Retry together send it only once.
 * Resolves with the record as it was claimed.
 */
async function claimForRetry(ref, channel) {
  return getDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new RetryRejectedError('Notification not found.')

    const notification = snapshot.data()
    if (notification[channel] !== 'failed') {
      throw new RetryRejectedError(`Only a failed ${channel === 'sms' ? 'SMS' : 'email'} can be retried.`)
    }

    const contact = channel === 'email' ? notification.recipientEmail : notification.recipientPhone
    if (!contact) {
      throw new RetryRejectedError(
        `This recipient has no ${channel === 'email' ? 'email address' : 'phone number'} on record. Update the routing in Setup and send a new alert.`
      )
    }

    const update = {
      [channel]: 'pending',
      [field(channel, 'Error')]: null,
      [field(channel, 'MessageId')]: null,
      [field(channel, 'Reference')]: channelReference(ref.id, (notification[field(channel, 'Attempts')] || 0) + 1),
      [field(channel, 'FailedAt')]: null,
    }
    transaction.update(ref, update)
    return { ...notification, ...update }
  })
}

// ── Delivery receipts ─────────────────────────────────────────────────────────

async function findReceiptTarget(channel, { messageId, reference }) {
  const db = getDb()

  if (messageId) {
    const snapshot = await db.collection('notifications')
      .where(field(channel, 'MessageId'), '==', messageId)
      .limit(1)
      .get()
    if (!snapshot.empty) return snapshot.docs[0].ref || db.collection('notifications').doc(snapshot.docs[0].id)
  }

  // The receipt can arrive before the send result is saved, so fall back to
  // the reference that was attached to the message when it was sent.
  const notificationId = String(reference || '').split('#')[0]
  if (notificationId) {
    const ref = db.collection('notifications').doc(notificationId)
    const snapshot = await ref.get()
    if (snapshot.exists && snapshot.data()[field(channel, 'Reference')] === reference) return ref
  }

  return null
}

/**
 * Applies a parsed provider receipt to its notification. Resolves true when a
 * record was updated and false when the receipt was stale or unmatched.
 */
async function applyDeliveryReceipt(channel, receipt) {
  const ref = await findReceiptTarget(channel, receipt)
  if (!ref) return false

  return getDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return false
    const current = snapshot.data()

    const storedMessageId = current[field(channel, 'MessageId')]
    const storedReference = current[field(channel, 'Reference')]
    const isStale = (receipt.messageId && storedMessageId && receipt.messageId !== storedMessageId) ||
      (!storedMessageId && receipt.reference !== storedReference)

    // Delivery is the strongest evidence there is, so a later failure report
    // for the same message does not overturn it.
    if (isStale || current[channel] === 'skipped' || current[channel] === 'delivered') return false

    const update = {
      [channel]: receipt.status,
      [field(channel, 'Error')]: receipt.error,
    }
    if (receipt.messageId && !storedMessageId) update[field(channel, 'MessageId')] = receipt.messageId
    if (receipt.status === 'delivered') update[field(channel, 'DeliveredAt')] = receipt.occurredAt
    if (receipt.status === 'failed') update[field(channel, 'FailedAt')] = receipt.occurredAt

    transaction.update(ref, update)
    return true
  })
}

module.exports = {
  CHANNELS,
  isChannel,
  escapeHtml,
  buildAlertEmail,
  buildAlertSms,
  buildAdminSummaryEmail,
  buildNotificationRecord,
  dispatchChannel,
  sendAdminSummary,
  claimForRetry,
  RetryRejectedError,
  applyDeliveryReceipt,
}
