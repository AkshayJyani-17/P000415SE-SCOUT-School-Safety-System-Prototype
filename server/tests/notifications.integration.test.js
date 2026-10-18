const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

// ── In-memory Firestore double ────────────────────────────────────────────────

let stores = {}
let nextId = 1
let failBatchCommit = false

function getStore(name) {
  if (!stores[name]) stores[name] = new Map()
  return stores[name]
}

function makeSnapshot(collectionName, id) {
  const data = getStore(collectionName).get(id)
  return {
    id,
    exists: Boolean(data),
    ref: makeDocRef(collectionName, id),
    data: () => (data ? { ...data } : undefined),
  }
}

function writeDoc(collectionName, id, data) {
  getStore(collectionName).set(id, { ...data })
}

function updateDoc(collectionName, id, data) {
  const existing = getStore(collectionName).get(id)
  if (!existing) throw new Error(`No document to update: ${collectionName}/${id}`)
  getStore(collectionName).set(id, { ...existing, ...data })
}

function makeDocRef(collectionName, id) {
  return {
    id,
    _collection: collectionName,
    async get() {
      return makeSnapshot(collectionName, id)
    },
    async set(data) {
      writeDoc(collectionName, id, data)
    },
    async update(data) {
      updateDoc(collectionName, id, data)
    },
  }
}

function makeQuery(collectionName, filters = [], limit = null, order = null) {
  return {
    where(field, _op, value) {
      return makeQuery(collectionName, [...filters, { field, value }], limit, order)
    },
    limit(count) {
      return makeQuery(collectionName, filters, count, order)
    },
    orderBy(field, direction = 'asc') {
      return makeQuery(collectionName, filters, limit, { field, direction })
    },
    async get() {
      let rows = [...getStore(collectionName).entries()].filter(([, data]) =>
        filters.every(filter => data[filter.field] === filter.value)
      )
      if (order) {
        rows.sort(([, a], [, b]) => String(a[order.field]).localeCompare(String(b[order.field])))
        if (order.direction === 'desc') rows.reverse()
      }
      if (limit !== null) rows = rows.slice(0, limit)

      return {
        empty: rows.length === 0,
        docs: rows.map(([id]) => makeSnapshot(collectionName, id)),
      }
    },
  }
}

const fakeDb = {
  collection(name) {
    return {
      ...makeQuery(name),
      doc(id) {
        return makeDocRef(name, id || `auto${nextId++}`)
      },
    }
  },
  batch() {
    const writes = []
    return {
      set(ref, data) {
        writes.push([ref, data])
      },
      async commit() {
        if (failBatchCommit) throw new Error('Firestore unavailable')
        for (const [ref, data] of writes) writeDoc(ref._collection, ref.id, data)
      },
    }
  },
  async runTransaction(handler) {
    return handler({
      async get(ref) {
        return makeSnapshot(ref._collection, ref.id)
      },
      update(ref, data) {
        updateDoc(ref._collection, ref.id, data)
      },
    })
  },
}

// ── Stub firebase-admin: the bearer token is the caller's uid ─────────────────

const adminPath = require.resolve('firebase-admin')

require.cache[adminPath] = {
  id: adminPath,
  filename: adminPath,
  loaded: true,
  exports: {
    auth: () => ({
      async verifyIdToken(token) {
        if (!getStore('users').has(token)) throw new Error('bad token')
        return { uid: token, email: getStore('users').get(token).email }
      },
    }),
  },
}

const firebasePath = require.resolve('../src/db/firebase')

require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: {
    getDb: () => fakeDb,
    docToObject: doc => (doc && doc.exists ? { id: doc.id, ...doc.data() } : null),
    snapshotToArray: snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    formatTimestamp: () => '',
  },
}

delete require.cache[require.resolve('../src/routes/notifications')]
const notificationRoutes = require('../src/routes/notifications')

// ── Server under test ─────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
app.use('/api/notifications', notificationRoutes)
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }))

const realFetch = global.fetch
const WEBHOOK_SECRET = 'receipt-secret'
let baseUrl

test.before(async () => {
  await new Promise(resolve => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
    server.unref()
  })
})

// ── Provider doubles ──────────────────────────────────────────────────────────
// Calls to Brevo and ClickSend are answered here; everything else (the test's
// own requests to the server) goes through the real fetch.

let emailHandler
let smsHandler
let providerCalls

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function acceptEmail(messageId = '<email-1@relay>') {
  return () => jsonResponse(201, { messageId })
}

function acceptSms(messageId = 'CS-1') {
  return () => jsonResponse(200, { http_code: 200, response_code: 'SUCCESS', data: { messages: [{ status: 'SUCCESS', message_id: messageId }] } })
}

function installProviderDoubles() {
  providerCalls = { email: [], sms: [] }
  global.fetch = async (url, options = {}) => {
    if (url === 'https://api.brevo.com/v3/smtp/email') {
      const body = JSON.parse(options.body)
      providerCalls.email.push(body)
      return emailHandler(body)
    }
    if (url === 'https://rest.clicksend.com/v3/sms/send') {
      const body = JSON.parse(options.body)
      providerCalls.sms.push(body)
      return smsHandler(body)
    }
    return realFetch(url, options)
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECIPIENTS = [
  { name: 'Fire Warden', email: 'warden@school.test', phone: '0412345678', role: 'fire_warden', notify: 'both' },
  { name: 'Office Manager', email: 'office@school.test', phone: null, role: 'office', notify: 'email' },
]

function seed({ recipients = RECIPIENTS } = {}) {
  stores = {}
  nextId = 1
  failBatchCommit = false
  emailHandler = acceptEmail()
  smsHandler = acceptSms()

  getStore('users').set('staffUid', { email: 'staff@school.test', name: 'Sam Staff', role: 'staff', schoolId: 'school_north' })
  getStore('users').set('northAdmin', { email: 'north.admin@school.test', name: 'North Admin', role: 'School Admin', schoolId: 'school_north' })
  getStore('users').set('southAdmin', { email: 'south.admin@school.test', name: 'South Admin', role: 'School Admin', schoolId: 'school_south' })
  getStore('users').set('companyAdmin', { email: 'company@scout.test', name: 'Company Admin', role: 'Company Admin' })
  getStore('schools').set('school_north', { name: 'Northside Primary', active: true })
  getStore('notificationRouting').set('rule1', {
    schoolId: 'school_north',
    alertType: 'Fire',
    active: true,
    recipients,
  })
}

test.beforeEach(() => {
  process.env.BREVO_API_KEY = 'brevo-key'
  process.env.BREVO_SENDER_EMAIL = 'alerts@scout.test'
  process.env.CLICKSEND_USERNAME = 'scout-user'
  process.env.CLICKSEND_API_KEY = 'clicksend-key'
  process.env.NOTIFICATION_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.BACKEND_URL = 'https://scout-api.test'
  seed()
  installProviderDoubles()
})

test.afterEach(() => {
  global.fetch = realFetch
})

function call(path, { method = 'GET', token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded'

  return realFetch(`${baseUrl}/api/notifications${path}`, {
    method,
    headers,
    body: form ? new URLSearchParams(form).toString() : body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function sendAlert(overrides = {}) {
  return call('/emergency', {
    method: 'POST',
    token: 'staffUid',
    body: { code: '000', emergencyType: 'Fire', location: 'Block B', message: 'Smoke in the hall', incidentId: 'inc1', ...overrides },
  })
}

function storedNotifications() {
  return [...getStore('notifications').entries()].map(([id, data]) => ({ id, ...data }))
}

function storedFor(name) {
  return storedNotifications().find(notification => notification.recipientName === name)
}

// ── Sending ───────────────────────────────────────────────────────────────────

test('an alert sends email and SMS and records each as sent with its provider id', async () => {
  const response = await sendAlert()
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.success, true)
  assert.equal(body.message, 'Emergency alert sent to 2 of 2 recipients.')

  const warden = body.results.find(result => result.name === 'Fire Warden')
  assert.equal(warden.emailStatus, 'sent')
  assert.equal(warden.smsStatus, 'sent')
  assert.equal(warden.emailError, null)
  assert.equal('token' in warden, false, 'acknowledgement tokens must not be returned to the sender')

  const record = storedFor('Fire Warden')
  assert.equal(record.id, warden.id)
  assert.equal(record.email, 'sent')
  assert.equal(record.sms, 'sent')
  assert.equal(record.emailMessageId, 'email-1@relay')
  assert.equal(record.smsMessageId, 'CS-1')
  assert.equal(record.emailAttempts, 1)
  assert.equal(record.smsAttempts, 1)
  assert.ok(record.emailSentAt)
  assert.equal(record.recipientPhone, '0412345678')
  assert.equal(record.schoolId, 'school_north')
  assert.equal(record.emergencyType, 'Fire')
  assert.equal(record.message, 'Smoke in the hall')

  const office = storedFor('Office Manager')
  assert.equal(office.email, 'sent')
  assert.equal(office.sms, 'skipped')
  assert.equal(office.smsError, null)
})

test('outgoing messages carry the acknowledgement link and a per-record reference', async () => {
  await sendAlert()

  const record = storedFor('Fire Warden')
  const ackLink = `https://scout-api.test/api/notifications/acknowledge/${record.token}`

  const email = providerCalls.email.find(call => call.to[0].email === 'warden@school.test')
  assert.equal(email.subject, 'EMERGENCY ALERT: Fire - Block B')
  assert.ok(email.htmlContent.includes(ackLink))
  assert.ok(email.textContent.includes(ackLink))
  assert.equal(email.headers['X-Mailin-custom'], `${record.id}#1`)

  const [sms] = providerCalls.sms
  assert.equal(sms.messages[0].to, '0412345678')
  assert.ok(sms.messages[0].body.startsWith('SCOUT EMERGENCY: Fire at Block B.'))
  assert.ok(sms.messages[0].body.includes(ackLink))
  assert.equal(sms.messages[0].custom_string, `${record.id}#1`)
})

test('user supplied text is escaped in the alert email', async () => {
  await sendAlert({ message: '<script>alert(1)</script>' })

  const email = providerCalls.email.find(call => call.to[0].email === 'warden@school.test')
  assert.ok(!email.htmlContent.includes('<script>'))
  assert.ok(email.htmlContent.includes('&lt;script&gt;'))
})

test('a refused SMS is recorded as failed with the provider reason', async () => {
  smsHandler = () => jsonResponse(200, { http_code: 200, response_code: 'SUCCESS', data: { messages: [{ status: 'INSUFFICIENT_CREDIT' }] } })

  const body = await (await sendAlert()).json()
  const warden = body.results.find(result => result.name === 'Fire Warden')

  assert.equal(warden.smsStatus, 'failed')
  assert.equal(warden.smsError, 'SMS provider rejected the message: insufficient credit')
  assert.equal(warden.emailStatus, 'sent')

  const record = storedFor('Fire Warden')
  assert.equal(record.sms, 'failed')
  assert.equal(record.smsError, 'SMS provider rejected the message: insufficient credit')
  assert.ok(record.smsFailedAt)
  assert.equal(record.smsAttempts, 1)
})

test('when every email fails the response reports that nothing was delivered', async () => {
  seed({ recipients: [RECIPIENTS[1]] })
  emailHandler = () => { throw new TypeError('fetch failed') }

  const body = await (await sendAlert()).json()

  assert.equal(body.success, false)
  assert.equal(body.message, 'Emergency alert sent to 0 of 1 recipients.')
  assert.equal(storedFor('Office Manager').email, 'failed')
  assert.equal(storedFor('Office Manager').emailError, 'Could not reach the email provider: fetch failed')
})

test('missing provider settings are recorded as the failure reason', async () => {
  delete process.env.BREVO_API_KEY

  await sendAlert()

  assert.match(storedFor('Office Manager').emailError, /Email is not configured/)
})

test('a recipient set to receive SMS without a phone number is flagged, not silently skipped', async () => {
  seed({ recipients: [{ name: 'No Phone', email: 'nophone@school.test', role: 'staff', notify: 'both' }] })

  const body = await (await sendAlert()).json()

  assert.equal(body.results[0].smsStatus, 'failed')
  assert.equal(body.results[0].smsError, 'No phone number is configured for this recipient.')
  assert.equal(body.results[0].emailStatus, 'sent')
  assert.equal(providerCalls.sms.length, 0)
})

test('records are saved as pending before any provider is called', async () => {
  let seenAtSendTime = null
  emailHandler = body => {
    if (body.to[0].email === 'office@school.test') seenAtSendTime = storedFor('Office Manager')?.email
    return jsonResponse(201, { messageId: '<x@relay>' })
  }

  await sendAlert()

  assert.equal(seenAtSendTime, 'pending')
})

test('the alert still goes out when the notification records cannot be saved', async () => {
  failBatchCommit = true

  const body = await (await sendAlert()).json()

  assert.equal(body.success, true)
  const alerts = providerCalls.email.filter(call => call.subject.startsWith('EMERGENCY ALERT'))
  assert.equal(alerts.length, 2)
  assert.equal(providerCalls.sms.length, 1)
  assert.equal(body.results[0].id, null)
  assert.equal(storedNotifications().length, 0)
})

test('admins receive a summary email listing both channels', async () => {
  await sendAlert()

  const summaries = providerCalls.email.filter(call => call.subject.startsWith('SCOUT Admin Summary'))
  const recipients = summaries.map(call => call.to[0].email).sort()

  assert.deepEqual(recipients, ['company@scout.test', 'north.admin@school.test'])
  assert.match(summaries[0].htmlContent, />Email<\/th>/)
  assert.match(summaries[0].htmlContent, />SMS<\/th>/)
  assert.match(summaries[0].htmlContent, /Northside Primary/)
})

test('only staff and school admins with a school can send alerts', async () => {
  const response = await call('/emergency', {
    method: 'POST',
    token: 'companyAdmin',
    body: { code: '000', emergencyType: 'Fire' },
  })

  assert.equal(response.status, 403)
  assert.equal(providerCalls.email.length, 0)
})

// ── Delivery receipts ─────────────────────────────────────────────────────────

function brevoEvent(fields) {
  return call(`/webhooks/brevo?secret=${WEBHOOK_SECRET}`, { method: 'POST', body: fields })
}

test('a Brevo delivered event confirms delivery on the record', async () => {
  seed({ recipients: [RECIPIENTS[1]] })
  await sendAlert()

  const response = await brevoEvent({ event: 'delivered', 'message-id': 'email-1@relay', ts_event: 1791849600 })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { received: 1, applied: 1 })

  const record = storedFor('Office Manager')
  assert.equal(record.email, 'delivered')
  assert.equal(record.emailError, null)
  assert.equal(record.emailDeliveredAt, new Date(1791849600 * 1000).toISOString())
})

test('a Brevo bounce marks the email failed with the reason', async () => {
  seed({ recipients: [RECIPIENTS[1]] })
  emailHandler = acceptEmail('<bounce-1@relay>')
  await sendAlert()

  await brevoEvent({ event: 'hard_bounce', 'message-id': 'bounce-1@relay', reason: 'unknown user' })

  const record = storedFor('Office Manager')
  assert.equal(record.email, 'failed')
  assert.equal(record.emailError, 'Email hard bounce: unknown user')
  assert.ok(record.emailFailedAt)
})

test('a receipt that arrives before the send result is saved is not overwritten', async () => {
  seed({ recipients: [RECIPIENTS[1]] })
  emailHandler = async body => {
    await brevoEvent({ event: 'delivered', 'message-id': 'fast@relay', 'X-Mailin-custom': body.headers['X-Mailin-custom'] })
    return jsonResponse(201, { messageId: '<fast@relay>' })
  }

  await sendAlert()

  const record = storedFor('Office Manager')
  assert.equal(record.email, 'delivered')
  assert.equal(record.emailMessageId, 'fast@relay')
})

test('a late failure report does not overturn a confirmed delivery', async () => {
  seed({ recipients: [RECIPIENTS[1]] })
  await sendAlert()

  await brevoEvent({ event: 'delivered', 'message-id': 'email-1@relay' })
  await brevoEvent({ event: 'error', 'message-id': 'email-1@relay' })

  assert.equal(storedFor('Office Manager').email, 'delivered')
})

test('receipts are rejected without the shared secret', async () => {
  await sendAlert()

  const wrong = await call('/webhooks/brevo?secret=guess', { method: 'POST', body: { event: 'delivered', 'message-id': 'email-1@relay' } })
  const missing = await call('/webhooks/brevo', { method: 'POST', body: { event: 'delivered', 'message-id': 'email-1@relay' } })

  assert.equal(wrong.status, 401)
  assert.equal(missing.status, 401)
  assert.equal(storedNotifications().some(notification => notification.email === 'delivered'), false)
})

test('receipts are refused when no secret is configured on the server', async () => {
  delete process.env.NOTIFICATION_WEBHOOK_SECRET

  const response = await call('/webhooks/brevo?secret=anything', { method: 'POST', body: { event: 'delivered' } })

  assert.equal(response.status, 503)
})

test('unmatched receipts and non-delivery events are acknowledged without changes', async () => {
  await sendAlert()

  const unknown = await brevoEvent({ event: 'delivered', 'message-id': 'someone-else@relay' })
  const opened = await brevoEvent({ event: 'opened', 'message-id': 'email-1@relay' })

  assert.deepEqual(await unknown.json(), { received: 1, applied: 0 })
  assert.deepEqual(await opened.json(), { received: 1, applied: 0 })
  assert.equal(storedNotifications().some(notification => notification.email === 'delivered'), false)
})

test('a ClickSend form-encoded delivery report confirms SMS delivery', async () => {
  await sendAlert()
  const record = storedFor('Fire Warden')

  const response = await call(`/webhooks/clicksend?secret=${WEBHOOK_SECRET}`, {
    method: 'POST',
    form: {
      message_id: 'CS-1',
      status: 'Delivered',
      status_code: '201',
      status_text: 'Message delivered to the handset.',
      custom_string: `${record.id}#1`,
      timestamp: '1791849600',
    },
  })

  assert.deepEqual(await response.json(), { received: 1, applied: 1 })
  assert.equal(storedFor('Fire Warden').sms, 'delivered')
  assert.equal(storedFor('Fire Warden').smsDeliveredAt, new Date(1791849600 * 1000).toISOString())
})

test('a ClickSend failure report marks the SMS failed with the reason', async () => {
  await sendAlert()

  await call(`/webhooks/clicksend?secret=${WEBHOOK_SECRET}`, {
    method: 'POST',
    body: { message_id: 'CS-1', status: 'Undelivered', status_code: '301', status_text: 'Handset unreachable' },
  })

  assert.equal(storedFor('Fire Warden').sms, 'failed')
  assert.equal(storedFor('Fire Warden').smsError, 'SMS undelivered: Handset unreachable')
})

// ── Retry ─────────────────────────────────────────────────────────────────────

async function sendWithFailedSms() {
  smsHandler = () => jsonResponse(200, { http_code: 200, response_code: 'SUCCESS', data: { messages: [{ status: 'INSUFFICIENT_CREDIT' }] } })
  await sendAlert()
  smsHandler = acceptSms('CS-retry')
  return storedFor('Fire Warden')
}

function retry(id, channel, token = 'northAdmin') {
  return call(`/${id}/retry`, { method: 'POST', token, body: { channel } })
}

test('a school admin can retry a failed SMS and the record is updated', async () => {
  const record = await sendWithFailedSms()

  const response = await retry(record.id, 'sms')
  assert.equal(response.status, 200)
  const { notification } = await response.json()

  assert.equal(notification.id, record.id)
  assert.equal(notification.sms, 'sent')
  assert.equal(notification.smsError, null)
  assert.equal(notification.smsMessageId, 'CS-retry')
  assert.equal(notification.smsAttempts, 2)
  assert.equal(notification.smsReference, `${record.id}#2`)
  assert.equal(notification.email, 'sent', 'the other channel is untouched')
  assert.equal(providerCalls.sms.at(-1).messages[0].custom_string, `${record.id}#2`)
})

test('a retry that fails again keeps the new reason', async () => {
  const record = await sendWithFailedSms()
  smsHandler = () => jsonResponse(401, { response_code: 'UNAUTHORIZED', response_msg: 'Invalid username or API key.' })

  const { notification } = await (await retry(record.id, 'sms')).json()

  assert.equal(notification.sms, 'failed')
  assert.equal(notification.smsError, 'SMS provider rejected the request: Invalid username or API key.')
  assert.equal(notification.smsAttempts, 2)
})

test('a receipt for an earlier attempt is ignored after a retry', async () => {
  const record = await sendWithFailedSms()

  // Hold the retry's SMS in flight so the record stays pending while the old
  // attempt's receipt arrives.
  let releaseSms
  smsHandler = () => new Promise(resolve => {
    releaseSms = () => resolve(acceptSms('CS-retry')())
  })

  const retrying = retry(record.id, 'sms')
  while (!releaseSms) await new Promise(resolve => setTimeout(resolve, 5))

  const receipt = await call(`/webhooks/clicksend?secret=${WEBHOOK_SECRET}`, {
    method: 'POST',
    body: { message_id: 'CS-old', status: 'Delivered', status_code: '201', custom_string: `${record.id}#1` },
  })

  assert.deepEqual(await receipt.json(), { received: 1, applied: 0 })
  assert.equal(storedFor('Fire Warden').sms, 'pending')

  releaseSms()
  await (await retrying).json()
  assert.equal(storedFor('Fire Warden').sms, 'sent')
})

test('a record created before delivery tracking can still be retried', async () => {
  getStore('notifications').set('legacy1', {
    schoolId: 'school_north',
    incidentTitle: 'Fire - Library',
    recipientName: 'Old Recipient',
    recipientEmail: 'old@school.test',
    email: 'failed',
    sms: 'skipped',
    token: 'legacy-token',
  })

  const { notification } = await (await retry('legacy1', 'email')).json()

  assert.equal(notification.email, 'sent')
  assert.equal(notification.emailAttempts, 1)
  const [email] = providerCalls.email
  assert.equal(email.subject, 'EMERGENCY ALERT: Fire - Library')
  assert.ok(email.textContent.includes('/api/notifications/acknowledge/legacy-token'))
})

test('a legacy SMS without a stored phone number cannot be retried', async () => {
  getStore('notifications').set('legacy2', {
    schoolId: 'school_north',
    incidentTitle: 'Fire',
    recipientName: 'Old Recipient',
    email: 'skipped',
    sms: 'failed',
  })

  const response = await retry('legacy2', 'sms')

  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /no phone number on record/)
})

test('only failed channels can be retried', async () => {
  const record = await sendWithFailedSms()

  const response = await retry(record.id, 'email')

  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: 'Only a failed email can be retried.' })
})

test('retry rejects an unknown channel', async () => {
  const record = await sendWithFailedSms()

  const response = await retry(record.id, 'fax')

  assert.equal(response.status, 400)
})

test('school admins cannot retry another school\'s notifications', async () => {
  const record = await sendWithFailedSms()

  const response = await retry(record.id, 'sms', 'southAdmin')

  assert.equal(response.status, 403)
  assert.equal(storedFor('Fire Warden').sms, 'failed')
})

test('company admins can retry any school\'s notifications', async () => {
  const record = await sendWithFailedSms()

  const response = await retry(record.id, 'sms', 'companyAdmin')

  assert.equal(response.status, 200)
  assert.equal(storedFor('Fire Warden').sms, 'sent')
})

test('staff cannot retry notifications', async () => {
  const record = await sendWithFailedSms()

  const response = await retry(record.id, 'sms', 'staffUid')

  assert.equal(response.status, 403)
})

test('retrying a missing notification returns 404', async () => {
  const response = await retry('does-not-exist', 'sms')

  assert.equal(response.status, 404)
})

// ── Listing ───────────────────────────────────────────────────────────────────

test('the notification list returns delivery details for the admin\'s school', async () => {
  await sendWithFailedSms()

  const response = await call('/', { token: 'northAdmin' })
  const { notifications } = await response.json()

  const warden = notifications.find(notification => notification.recipientName === 'Fire Warden')
  assert.equal(warden.sms, 'failed')
  assert.equal(warden.smsError, 'SMS provider rejected the message: insufficient credit')
  assert.equal(warden.recipientPhone, '0412345678')

  const south = await (await call('/', { token: 'southAdmin' })).json()
  assert.equal(south.notifications.length, 0)
})
