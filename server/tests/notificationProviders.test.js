const test = require('node:test')
const assert = require('node:assert/strict')

const { sendEmail, parseEmailEvent, normaliseMessageId } = require('../src/services/emailService')
const { sendSms, parseSmsReceipt } = require('../src/services/smsService')

const realFetch = global.fetch
const ENV_KEYS = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'CLICKSEND_USERNAME', 'CLICKSEND_API_KEY', 'SMS_DEFAULT_COUNTRY']
const savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))

let requests = []

function stubFetch(handler) {
  requests = []
  global.fetch = async (url, options) => {
    const request = { url, options, body: JSON.parse(options.body) }
    requests.push(request)
    return handler(request)
  }
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test.beforeEach(() => {
  process.env.BREVO_API_KEY = 'brevo-key'
  process.env.BREVO_SENDER_EMAIL = 'alerts@scout.test'
  delete process.env.BREVO_SENDER_NAME
  process.env.CLICKSEND_USERNAME = 'scout-user'
  process.env.CLICKSEND_API_KEY = 'clicksend-key'
  delete process.env.SMS_DEFAULT_COUNTRY
})

test.afterEach(() => {
  global.fetch = realFetch
})

test.after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

// ── Email ─────────────────────────────────────────────────────────────────────

test('sendEmail posts to Brevo over HTTPS and returns the normalised message id', async () => {
  stubFetch(() => jsonResponse(201, { messageId: '<202610130001.abc@smtp-relay.mailin.fr>' }))

  const result = await sendEmail({
    to: 'warden@school.test',
    toName: 'Fire Warden',
    subject: 'EMERGENCY ALERT: Fire',
    html: '<p>Fire</p>',
    text: 'Fire',
    reference: 'notif-1#1',
  })

  assert.equal(result.messageId, '202610130001.abc@smtp-relay.mailin.fr')
  assert.equal(requests.length, 1)

  const [{ url, options, body }] = requests
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers['api-key'], 'brevo-key')
  assert.deepEqual(body.sender, { name: 'SCOUT Safety System', email: 'alerts@scout.test' })
  assert.deepEqual(body.to, [{ email: 'warden@school.test', name: 'Fire Warden' }])
  assert.equal(body.subject, 'EMERGENCY ALERT: Fire')
  assert.equal(body.htmlContent, '<p>Fire</p>')
  assert.equal(body.textContent, 'Fire')
  assert.deepEqual(body.headers, { 'X-Mailin-custom': 'notif-1#1' })
})

test('sendEmail uses the configured sender name', async () => {
  process.env.BREVO_SENDER_NAME = 'Northside Safety'
  stubFetch(() => jsonResponse(201, { messageId: '<id@relay>' }))

  await sendEmail({ to: 'a@school.test', subject: 's', html: 'h', text: 't' })

  assert.equal(requests[0].body.sender.name, 'Northside Safety')
  assert.equal(requests[0].body.headers, undefined)
})

test('sendEmail explains which settings are missing instead of calling Brevo', async () => {
  delete process.env.BREVO_API_KEY
  stubFetch(() => assert.fail('fetch should not be called'))

  await assert.rejects(
    sendEmail({ to: 'a@school.test', subject: 's', html: 'h', text: 't' }),
    /Set BREVO_API_KEY and BREVO_SENDER_EMAIL/
  )
})

test('sendEmail surfaces the reason Brevo gives for a rejection', async () => {
  stubFetch(() => jsonResponse(400, { code: 'invalid_parameter', message: 'sender is not valid' }))

  await assert.rejects(
    sendEmail({ to: 'a@school.test', subject: 's', html: 'h', text: 't' }),
    { message: 'Email provider rejected the message: sender is not valid' }
  )
})

test('sendEmail reports a network failure as unreachable', async () => {
  stubFetch(() => { throw new TypeError('fetch failed') })

  await assert.rejects(
    sendEmail({ to: 'a@school.test', subject: 's', html: 'h', text: 't' }),
    { message: 'Could not reach the email provider: fetch failed' }
  )
})

test('normaliseMessageId strips the angle brackets Brevo adds on send', () => {
  assert.equal(normaliseMessageId('<abc@relay>'), 'abc@relay')
  assert.equal(normaliseMessageId('abc@relay'), 'abc@relay')
  assert.equal(normaliseMessageId(''), null)
  assert.equal(normaliseMessageId(undefined), null)
})

test('parseEmailEvent maps a delivered event to delivered', () => {
  const update = parseEmailEvent({
    event: 'delivered',
    'message-id': 'abc@relay',
    'X-Mailin-custom': 'notif-1#1',
    ts_event: 1791849600,
  })

  assert.deepEqual(update, {
    messageId: 'abc@relay',
    reference: 'notif-1#1',
    occurredAt: new Date(1791849600 * 1000).toISOString(),
    status: 'delivered',
    error: null,
  })
})

test('parseEmailEvent maps permanent failures to failed with the reason', () => {
  const update = parseEmailEvent({ event: 'hard_bounce', 'message-id': 'abc@relay', reason: 'mailbox does not exist' })

  assert.equal(update.status, 'failed')
  assert.equal(update.error, 'Email hard bounce: mailbox does not exist')

  for (const event of ['blocked', 'invalid_email', 'error']) {
    assert.equal(parseEmailEvent({ event, 'message-id': 'x' }).status, 'failed', event)
  }
})

test('parseEmailEvent ignores events that do not change delivery status', () => {
  for (const event of ['request', 'opened', 'click', 'deferred', 'soft_bounce', 'unique_opened']) {
    assert.equal(parseEmailEvent({ event, 'message-id': 'x' }), null, event)
  }
})

// ── SMS ───────────────────────────────────────────────────────────────────────

function clickSendResponse(message) {
  return jsonResponse(200, {
    http_code: 200,
    response_code: 'SUCCESS',
    data: { messages: [message] },
  })
}

test('sendSms posts to ClickSend from the shared pool with the default country', async () => {
  stubFetch(() => clickSendResponse({ status: 'SUCCESS', message_id: 'CS-123' }))

  const result = await sendSms({ to: '0412345678', body: 'SCOUT EMERGENCY: Fire', reference: 'notif-1#1' })

  assert.equal(result.messageId, 'CS-123')

  const [{ url, options, body }] = requests
  assert.equal(url, 'https://rest.clicksend.com/v3/sms/send')
  assert.equal(options.headers.Authorization, `Basic ${Buffer.from('scout-user:clicksend-key').toString('base64')}`)
  assert.equal(body.messages.length, 1)

  const [message] = body.messages
  assert.equal(message.to, '0412345678')
  assert.equal(message.body, 'SCOUT EMERGENCY: Fire')
  assert.equal(message.country, 'AU')
  assert.equal(message.custom_string, 'notif-1#1')
  assert.equal('from' in message, false)
})

test('sendSms honours SMS_DEFAULT_COUNTRY', async () => {
  process.env.SMS_DEFAULT_COUNTRY = 'nz'
  stubFetch(() => clickSendResponse({ status: 'SUCCESS', message_id: 'CS-1' }))

  await sendSms({ to: '021000000', body: 'x' })

  assert.equal(requests[0].body.messages[0].country, 'NZ')
})

test('sendSms treats a refused message as a failure even though ClickSend answers 200', async () => {
  stubFetch(() => clickSendResponse({ status: 'INVALID_RECIPIENT', message_id: 'CS-2' }))

  await assert.rejects(
    sendSms({ to: '123', body: 'x' }),
    { message: 'SMS provider rejected the message: invalid recipient' }
  )
})

test('sendSms surfaces an account level rejection', async () => {
  stubFetch(() => jsonResponse(401, { http_code: 401, response_code: 'UNAUTHORIZED', response_msg: 'Invalid username or API key.' }))

  await assert.rejects(
    sendSms({ to: '0412345678', body: 'x' }),
    { message: 'SMS provider rejected the request: Invalid username or API key.' }
  )
})

test('sendSms explains which settings are missing instead of calling ClickSend', async () => {
  delete process.env.CLICKSEND_API_KEY
  stubFetch(() => assert.fail('fetch should not be called'))

  await assert.rejects(sendSms({ to: '0412345678', body: 'x' }), /Set CLICKSEND_USERNAME and CLICKSEND_API_KEY/)
})

test('parseSmsReceipt maps status code 201 to delivered', () => {
  const update = parseSmsReceipt({
    message_id: 'CS-123',
    status: 'Delivered',
    status_code: '201',
    status_text: 'Message delivered to the handset.',
    custom_string: 'notif-1#1',
    timestamp: '1791849600',
  })

  assert.deepEqual(update, {
    messageId: 'CS-123',
    reference: 'notif-1#1',
    occurredAt: new Date(1791849600 * 1000).toISOString(),
    status: 'delivered',
    error: null,
  })
})

test('parseSmsReceipt maps terminal failures to failed with the provider wording', () => {
  const update = parseSmsReceipt({
    message_id: 'CS-123',
    status: 'Undelivered',
    status_code: '301',
    status_text: 'Handset unreachable',
  })

  assert.equal(update.status, 'failed')
  assert.equal(update.error, 'SMS undelivered: Handset unreachable')
  assert.equal(parseSmsReceipt({ message_id: 'x', status: 'Expired' }).status, 'failed')
})

test('parseSmsReceipt ignores intermediate states', () => {
  assert.equal(parseSmsReceipt({ message_id: 'x', status: 'Sent', status_code: '200' }), null)
  assert.equal(parseSmsReceipt({}), null)
})
