// SMS delivery through the ClickSend REST API.
//
// Messages go out from ClickSend's shared number pool (no `from`), which
// avoids the carrier filtering applied to unregistered alphanumeric sender IDs.

const CLICKSEND_SEND_URL = 'https://rest.clicksend.com/v3/sms/send'
const REQUEST_TIMEOUT_MS = 10000
const DEFAULT_COUNTRY = 'AU'

function getSmsConfig() {
  const username = process.env.CLICKSEND_USERNAME
  const apiKey = process.env.CLICKSEND_API_KEY

  if (!username || !apiKey) {
    throw new Error('SMS is not configured. Set CLICKSEND_USERNAME and CLICKSEND_API_KEY on the server.')
  }

  return {
    authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
    // Lets ClickSend convert local numbers such as 0412 345 678 to E.164.
    country: (process.env.SMS_DEFAULT_COUNTRY || DEFAULT_COUNTRY).toUpperCase(),
  }
}

function describeStatus(status) {
  return String(status || 'UNKNOWN').replace(/_/g, ' ').toLowerCase()
}

/**
 * Sends one SMS and resolves with ClickSend's message id once it has been
 * queued for the networks. Throws with a readable reason when it is rejected.
 *
 * ClickSend answers HTTP 200 even when the message itself was refused (an
 * invalid number, no credit, a country not enabled), so the per-message status
 * is what decides success, not the HTTP status.
 *
 * `reference` is passed back with every delivery report for this message.
 */
async function sendSms({ to, body, reference }) {
  const { authorization, country } = getSmsConfig()

  const message = {
    source: 'scout',
    to,
    body,
    country,
    ...(reference ? { custom_string: reference } : {}),
  }

  let response
  try {
    response = await fetch(CLICKSEND_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ messages: [message] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'the request timed out' : err.message
    throw new Error(`Could not reach the SMS provider: ${reason}`)
  }

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const reason = payload.response_msg || payload.response_code || `HTTP ${response.status}`
    throw new Error(`SMS provider rejected the request: ${reason}`)
  }

  const result = payload.data?.messages?.[0]
  if (!result) {
    throw new Error('SMS provider returned no result for the message.')
  }

  if (result.status !== 'SUCCESS') {
    throw new Error(`SMS provider rejected the message: ${describeStatus(result.status)}`)
  }

  return { messageId: result.message_id || null }
}

const FAILURE_PATTERN = /fail|undeliver|expire|reject|cancel|invalid/i

/**
 * Turns one ClickSend delivery report into a delivery update, or null when the
 * report is an intermediate state that should not change the recorded status.
 *
 * ClickSend reports a delivered message with status code 201. Anything that
 * reads as a terminal failure is recorded with the provider's own wording.
 */
function parseSmsReceipt(receipt = {}) {
  const status = String(receipt.status || '')
  const statusCode = String(receipt.status_code || '')
  const statusText = receipt.status_text || receipt.error_text || null
  const timestamp = Number(receipt.timestamp)

  const base = {
    messageId: receipt.message_id || null,
    reference: receipt.custom_string || null,
    occurredAt: Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp * 1000).toISOString()
      : new Date().toISOString(),
  }

  if (statusCode === '201' || /^delivered$/i.test(status)) {
    return { ...base, status: 'delivered', error: null }
  }

  if (FAILURE_PATTERN.test(status) || FAILURE_PATTERN.test(statusText || '')) {
    return { ...base, status: 'failed', error: `SMS ${status.toLowerCase() || 'failed'}${statusText ? `: ${statusText}` : ''}` }
  }

  return null
}

module.exports = {
  sendSms,
  parseSmsReceipt,
}
