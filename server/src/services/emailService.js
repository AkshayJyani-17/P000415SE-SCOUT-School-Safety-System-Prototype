// Email delivery through the Brevo transactional API.
//
// Render's free tier blocks outbound SMTP (ports 25, 465 and 587), so email
// goes out over HTTPS instead. Brevo also reports what happened to each
// message afterwards through a webhook, which is how delivery is confirmed.

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'
const REQUEST_TIMEOUT_MS = 10000
const DEFAULT_SENDER_NAME = 'SCOUT Safety System'

// Brevo events that mean the message will never arrive. Soft bounces and
// deferrals are left alone because Brevo keeps retrying those.
const FAILURE_EVENTS = new Set(['hard_bounce', 'blocked', 'invalid_email', 'error'])

function getEmailConfig() {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL

  if (!apiKey || !senderEmail) {
    throw new Error('Email is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL on the server.')
  }

  return {
    apiKey,
    senderEmail,
    senderName: process.env.BREVO_SENDER_NAME || DEFAULT_SENDER_NAME,
  }
}

// Brevo returns the id wrapped in angle brackets when sending but without them
// in webhook events, so both sides are stored and compared in this form.
function normaliseMessageId(messageId) {
  return String(messageId || '').trim().replace(/^<|>$/g, '') || null
}

async function readProviderError(response) {
  try {
    const payload = await response.json()
    return payload.message || payload.code || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

/**
 * Sends one email and resolves with Brevo's message id once Brevo has accepted
 * it. Throws with a readable reason when it is rejected, so the caller can
 * record that reason against the notification.
 *
 * `reference` is echoed back by every webhook event for this message, which
 * lets a receipt be matched even if it arrives before the send result is saved.
 */
async function sendEmail({ to, toName, subject, html, text, reference }) {
  const { apiKey, senderEmail, senderName } = getEmailConfig()

  const body = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to, ...(toName ? { name: toName } : {}) }],
    subject,
    htmlContent: html,
    textContent: text,
    ...(reference ? { headers: { 'X-Mailin-custom': reference } } : {}),
  }

  let response
  try {
    response = await fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'the request timed out' : err.message
    throw new Error(`Could not reach the email provider: ${reason}`)
  }

  if (!response.ok) {
    throw new Error(`Email provider rejected the message: ${await readProviderError(response)}`)
  }

  const payload = await response.json().catch(() => ({}))
  return { messageId: normaliseMessageId(payload.messageId) }
}

/**
 * Turns one Brevo webhook event into a delivery update, or null for events
 * that do not change delivery status (opens, clicks, deferrals and so on).
 */
function parseEmailEvent(event = {}) {
  const name = String(event.event || '').toLowerCase()
  const base = {
    messageId: normaliseMessageId(event['message-id']),
    reference: event['X-Mailin-custom'] || null,
    occurredAt: event.ts_event ? new Date(event.ts_event * 1000).toISOString() : new Date().toISOString(),
  }

  if (name === 'delivered') {
    return { ...base, status: 'delivered', error: null }
  }

  if (FAILURE_EVENTS.has(name)) {
    const reason = event.reason ? `: ${event.reason}` : ''
    return { ...base, status: 'failed', error: `Email ${name.replace(/_/g, ' ')}${reason}` }
  }

  return null
}

module.exports = {
  sendEmail,
  parseEmailEvent,
  normaliseMessageId,
}
