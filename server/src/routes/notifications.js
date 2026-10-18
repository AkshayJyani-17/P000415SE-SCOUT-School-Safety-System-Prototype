
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const admin = require('firebase-admin')
const { getDb } = require('../db/firebase')
const { invalidateAnalyticsCache } = require('../analyticsCache')
const { invalidateIncidentListCache } = require('../incidentListCache')
const { getSchoolName } = require('../services/schoolService')
const { findSchoolRoutingRule } = require('../services/alertRouting')
const { parseEmailEvent } = require('../services/emailService')
const { parseSmsReceipt } = require('../services/smsService')
const {
  CHANNELS,
  isChannel,
  buildNotificationRecord,
  dispatchChannel,
  sendAdminSummary,
  claimForRetry,
  RetryRejectedError,
  applyDeliveryReceipt,
} = require('../services/notificationDelivery')

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided.' })
  }

  try {
    req.user = await admin.auth().verifyIdToken(token)
    next()
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token.' })
  }
}

function normaliseRole(role) {
  return String(role || '').toLowerCase().replace(/[-_\s]/g, '')
}

function isCompanyAdmin(role) {
  return normaliseRole(role) === 'companyadmin'
}

function isSchoolAdmin(role) {
  return normaliseRole(role) === 'schooladmin'
}

function canSendAlert(role) {
  return ['staff', 'schooladmin'].includes(normaliseRole(role))
}

async function getUserProfile(decodedUser) {
  const db = getDb()
  const { uid, email } = decodedUser
  let profile = null

  const userDoc = await db.collection('users').doc(uid).get()
  if (userDoc.exists) {
    profile = userDoc.data()
  } else if (email) {
    const byEmail = await db.collection('users').where('email', '==', email).limit(1).get()
    if (!byEmail.empty) {
      profile = byEmail.docs[0].data()
    }
  }

  return {
    uid,
    email: email || null,
    name: profile?.name || email || 'Unknown',
    role: profile?.role || null,
    schoolId: profile?.schoolId || null,
    // Live lookup first so a renamed school is reflected immediately; the
    // stored copy is the fallback for a schoolId that no longer resolves.
    schoolName: (await getSchoolName(profile?.schoolId)) || profile?.schoolName || null,
  }
}

async function requireAlertSender(req, res, next) {
  try {
    const profile = await getUserProfile(req.user)

    if (!profile.role || !canSendAlert(profile.role)) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to send alerts.',
      })
    }

    if (!profile.schoolId) {
      return res.status(403).json({
        success: false,
        error: 'Your account is not assigned to a school.',
      })
    }

    req.profile = profile
    next()
  } catch (error) {
    console.error('Failed to verify alert sender:', error)
    return res.status(500).json({ success: false, error: 'Failed to verify alert sender.' })
  }
}

async function requireNotificationViewer(req, res, next) {
  try {
    const profile = await getUserProfile(req.user)

    if (!isCompanyAdmin(profile.role) && !isSchoolAdmin(profile.role)) {
      return res.status(403).json({ error: 'You do not have permission to view notification delivery data.' })
    }

    if (isSchoolAdmin(profile.role) && !profile.schoolId) {
      return res.status(403).json({ error: 'Your account is not assigned to a school.' })
    }

    req.profile = profile
    next()
  } catch (error) {
    console.error('Failed to verify notification viewer:', error)
    return res.status(500).json({ error: 'Failed to verify notification viewer.' })
  }
}

// Providers call the webhooks with ?secret=<NOTIFICATION_WEBHOOK_SECRET>.
// Hashing both sides first gives equal-length buffers for the constant-time
// comparison regardless of what was supplied.
function hasValidWebhookSecret(req) {
  const expected = process.env.NOTIFICATION_WEBHOOK_SECRET
  const provided = req.query.secret
  if (!expected || typeof provided !== 'string') return false

  const digest = value => crypto.createHash('sha256').update(value).digest()
  return crypto.timingSafeEqual(digest(provided), digest(expected))
}

function requireWebhookSecret(req, res, next) {
  if (!process.env.NOTIFICATION_WEBHOOK_SECRET) {
    console.warn('[notifications] Delivery receipt received but NOTIFICATION_WEBHOOK_SECRET is not set')
    return res.status(503).json({ error: 'Delivery receipts are not configured.' })
  }

  if (!hasValidWebhookSecret(req)) {
    return res.status(401).json({ error: 'Invalid webhook secret.' })
  }

  next()
}

function normaliseRecipient(recipient) {
  return {
    name: recipient.name || recipient.email || recipient.phone || 'Recipient',
    email: recipient.email || null,
    phone: recipient.phone || null,
    role: recipient.role || 'recipient',
    notify: recipient.notify || 'email',
  }
}

async function getRecipientsForEmergency(emergencyType, schoolId) {
  const db = getDb()

  if (schoolId) {
    // Shared with the preview, so the two cannot disagree about which saved
    // list applies. See services/alertRouting.js.
    const rule = await findSchoolRoutingRule(db, schoolId, emergencyType)

    if (rule && Array.isArray(rule.recipients)) {
      const recipients = rule.recipients
        .filter(recipient => recipient.email || recipient.phone)
        .map(normaliseRecipient)

      console.log(`School routing found for "${emergencyType}" at ${schoolId}: ${recipients.length} recipient(s)`)
      return recipients
    }
  }

  const routingSnapshot = await db.collection('notificationRouting')
    .where('alertScope', '==', 'emergency')
    .where('alertType', '==', emergencyType)
    .where('active', '==', true)
    .get()

  const legacyRule = routingSnapshot.docs
    .map(doc => doc.data())
    .find(rule => Array.isArray(rule.roles) && (!rule.schoolId || !schoolId || rule.schoolId === schoolId))

  if (!legacyRule) {
    console.warn(`No routing rule found for emergency type: ${emergencyType}`)
    return []
  }

  const roles = legacyRule.roles || []
  let recipientsQuery = db.collection('notificationRecipients').where('active', '==', true)

  if (schoolId) {
    recipientsQuery = recipientsQuery.where('schoolId', '==', schoolId)
  }

  const recipientsSnapshot = await recipientsQuery.get()
  const recipients = recipientsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(recipient => roles.includes(recipient.role))
    .map(normaliseRecipient)

  console.log(`Legacy routing found for "${emergencyType}": ${recipients.length} recipient(s)`)
  return recipients
}

async function getAdminUsers(schoolId) {
  const db = getDb()
  const usersSnapshot = await db.collection('users').get()

  const admins = usersSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(user => {
      if (!user.email || !user.role) return false
      if (isCompanyAdmin(user.role)) return true
      return isSchoolAdmin(user.role) && schoolId && user.schoolId === schoolId
    })

  console.log(`Found ${admins.length} admin(s): ${admins.map(adminUser => adminUser.name).join(', ')}`)
  return admins
}

async function sendAdminSummaryEmail(summary) {
  const admins = await getAdminUsers(summary.schoolId)

  if (admins.length === 0) {
    console.warn('No admin users found in users collection - skipping admin summary email')
    return
  }

  await sendAdminSummary(admins, summary)
}

async function getNotificationSchoolContext(incidentId, senderProfile) {
  const db = getDb()
  let schoolId = senderProfile.schoolId || null
  let schoolName = senderProfile.schoolName || null

  if (incidentId) {
    const incidentDoc = await db.collection('incidents').doc(incidentId).get()
    if (incidentDoc.exists) {
      const incident = incidentDoc.data()
      schoolId = incident.schoolId || schoolId
      schoolName = incident.schoolName || schoolName
    }
  }

  if (!schoolName && schoolId) {
    schoolName = await getSchoolName(schoolId)
  }

  return { schoolId, schoolName }
}

router.post('/emergency', verifyToken, requireAlertSender, async (req, res) => {
  const { code, emergencyType, location, message, incidentId } = req.body

  if (code !== '000') {
    return res.status(401).json({
      success: false,
      error: 'Invalid emergency code. Please enter 000 to confirm.',
    })
  }

  if (!emergencyType) {
    return res.status(400).json({
      success: false,
      error: 'Emergency type is required.',
    })
  }

  const { schoolId, schoolName } = await getNotificationSchoolContext(incidentId, req.profile)

  let recipients = []
  try {
    recipients = await getRecipientsForEmergency(emergencyType, schoolId)
  } catch (err) {
    console.error('Failed to fetch recipients from Firestore:', err.message)
    return res.status(500).json({ success: false, error: 'Failed to load recipients. Please try again.' })
  }

  if (recipients.length === 0) {
    return res.status(404).json({
      success: false,
      error: `No active recipients found for emergency type: ${emergencyType}`,
    })
  }

  const timestamp = new Date().toISOString()
  const alert = { emergencyType, location: location || null, message: message || null }
  const db = getDb()

  const entries = recipients.map(recipient => {
    const ref = db.collection('notifications').doc()
    const record = buildNotificationRecord({
      id: ref.id,
      recipient,
      alert,
      schoolId,
      schoolName,
      incidentId,
      token: crypto.randomUUID(),
      timestamp,
    })
    return { ref, record, recipient }
  })

  // Records are written before anything is sent so every delivery receipt has
  // something to land on. If the write fails the alert still goes out.
  let tracked = true
  try {
    const batch = db.batch()
    for (const { ref, record } of entries) batch.set(ref, record)
    await batch.commit()
  } catch (err) {
    tracked = false
    console.error('[notifications] Failed to save notification records, sending without tracking:', err.message)
  }

  const results = await Promise.all(entries.map(async ({ ref, record, recipient }) => {
    const outcomes = {}

    await Promise.all(CHANNELS.map(async channel => {
      outcomes[channel] = record[channel] === 'pending'
        ? await dispatchChannel(tracked ? ref : null, record, channel)
        : { status: record[channel], error: record[`${channel}Error`] }
    }))

    return {
      id: tracked ? ref.id : null,
      name: recipient.name,
      role: recipient.role,
      email: recipient.email,
      phone: recipient.phone,
      emailStatus: outcomes.email.status,
      emailError: outcomes.email.error,
      smsStatus: outcomes.sms.status,
      smsError: outcomes.sms.error,
    }
  }))

  if (tracked) invalidateAnalyticsCache()

  const deliveriesSent = results.filter(result => result.emailStatus === 'sent' || result.smsStatus === 'sent').length

  try {
    await sendAdminSummaryEmail({
      ...alert,
      timestamp,
      incidentId,
      schoolId,
      schoolName,
      results,
    })
  } catch (err) {
    console.error('Failed to send admin summary email:', err.message)
  }

  res.json({
    success: deliveriesSent > 0,
    message: `Emergency alert sent to ${deliveriesSent} of ${results.length} recipients.`,
    emergencyType,
    location: location || null,
    timestamp,
    results,
  })
})

router.get('/acknowledge/:token', async (req, res) => {
  const { token } = req.params
  const db = getDb()

  try {
    const snapshot = await db.collection('notifications')
      .where('token', '==', token)
      .get()

    if (snapshot.empty) {
      return res.status(404).send(`
        <!DOCTYPE html><html>
        <head><title>SCOUT - Invalid Link</title></head>
        <body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;">
          <div style="text-align:center;max-width:400px;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color:#111827;margin-bottom:8px;">Invalid Link</h1>
            <p style="color:#6b7280;">This acknowledgement link is invalid or has expired.</p>
            <p style="color:#9ca3af;font-size:12px;margin-top:16px;">SCOUT School Safety System</p>
          </div>
        </body></html>
      `)
    }

    const doc = snapshot.docs[0]
    const notification = doc.data()

    if (notification.acknowledged) {
      return res.send(`
        <!DOCTYPE html><html>
        <head><title>SCOUT - Already Acknowledged</title></head>
        <body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;">
          <div style="text-align:center;max-width:400px;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color:#111827;margin-bottom:8px;">Already Acknowledged</h1>
            <p style="color:#6b7280;">You have already confirmed your response to this alert.</p>
            <p style="color:#9ca3af;font-size:12px;margin-top:16px;">SCOUT School Safety System</p>
          </div>
        </body></html>
      `)
    }

    const acknowledgedAt = new Date().toISOString()

    await db.collection('notifications').doc(doc.id).update({
      acknowledged: true,
      acknowledgedAt,
    })

    if (notification.incidentId) {
      try {
        const incidentRef = db.collection('incidents').doc(notification.incidentId)
        await incidentRef.update({
          acknowledgedBy: admin.firestore.FieldValue.arrayUnion({
            name: notification.recipientName,
            email: notification.recipientEmail,
            role: notification.recipientRole,
            acknowledgedAt,
          }),
          status: 'acknowledged',
          updatedAt: new Date().toISOString(),
        })
        invalidateAnalyticsCache()
        invalidateIncidentListCache()
        console.log(`Incident ${notification.incidentId} acknowledged by ${notification.recipientName}`)
      } catch (err) {
        console.error('Failed to update incident acknowledgedBy:', err.message)
      }
    }

    return res.send(`
      <!DOCTYPE html><html>
      <head><title>SCOUT - Response Confirmed</title></head>
      <body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;">
        <div style="text-align:center;max-width:400px;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          <h1 style="color:#16a34a;margin-bottom:8px;">Response Confirmed</h1>
          <p style="color:#374151;margin-bottom:8px;">
            Thank you, <strong>${notification.recipientName}</strong>.
          </p>
          <p style="color:#6b7280;margin-bottom:16px;">
            You have acknowledged the <strong>${notification.incidentTitle}</strong> emergency alert.
            Your response has been recorded in the SCOUT system.
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px;">
            <p style="color:#15803d;font-size:14px;margin:0;">Please proceed to respond to the emergency immediately.</p>
          </div>
          <p style="color:#9ca3af;font-size:12px;">You can close this page.</p>
          <p style="color:#9ca3af;font-size:12px;margin-top:8px;">SCOUT School Safety System</p>
        </div>
      </body></html>
    `)
  } catch (err) {
    console.error('Acknowledge error:', err)
    return res.status(500).send(`
      <!DOCTYPE html><html>
      <head><title>SCOUT - Error</title></head>
      <body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;">
        <div style="text-align:center;max-width:400px;padding:40px;background:white;border-radius:12px;">
          <h1 style="color:#111827;">Something went wrong</h1>
          <p style="color:#6b7280;">Please try again or contact your safety manager.</p>
        </div>
      </body></html>
    `)
  }
})

router.get('/', verifyToken, requireNotificationViewer, async (req, res, next) => {
  try {
    const db = getDb()
    const query = db.collection('notifications')

    if (isSchoolAdmin(req.profile.role)) {
      const snapshot = await query
        .where('schoolId', '==', req.profile.schoolId)
        .limit(100)
        .get()
      const notifications = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      return res.json({ notifications })
    }

    const snapshot = await query
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get()
    const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    res.json({ notifications })
  } catch (err) {
    next(err)
  }
})

// ── Delivery receipts ─────────────────────────────────────────────────────────
// Providers retry a webhook that does not answer 2xx, so unmatched or stale
// receipts are acknowledged and dropped, and only real errors return 500.

async function applyReceipts(channel, updates) {
  let applied = 0
  for (const update of updates) {
    if (update && await applyDeliveryReceipt(channel, update)) applied += 1
  }
  if (applied > 0) invalidateAnalyticsCache()
  return applied
}

router.post('/webhooks/brevo', requireWebhookSecret, async (req, res, next) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body]
    const applied = await applyReceipts('email', events.map(parseEmailEvent))
    res.json({ received: events.length, applied })
  } catch (err) {
    next(err)
  }
})

// ClickSend posts delivery reports as form fields by default, or JSON when
// the rule is set up that way, so both are accepted.
router.post('/webhooks/clicksend', express.urlencoded({ extended: false }), requireWebhookSecret, async (req, res, next) => {
  try {
    const receipts = Array.isArray(req.body) ? req.body : [req.body]
    const updates = receipts.map(receipt => {
      const update = parseSmsReceipt(receipt)
      if (!update) {
        console.log(`[notifications] Ignored SMS receipt for ${receipt.message_id || 'unknown message'} with status "${receipt.status || receipt.status_code || 'none'}"`)
      }
      return update
    })
    const applied = await applyReceipts('sms', updates)
    res.json({ received: receipts.length, applied })
  } catch (err) {
    next(err)
  }
})

// ── Retry ─────────────────────────────────────────────────────────────────────

router.post('/:id/retry', verifyToken, requireNotificationViewer, async (req, res, next) => {
  const { channel } = req.body || {}

  if (!isChannel(channel)) {
    return res.status(400).json({ error: 'Channel must be "email" or "sms".' })
  }

  try {
    const ref = getDb().collection('notifications').doc(req.params.id)
    const snapshot = await ref.get()

    if (!snapshot.exists) {
      return res.status(404).json({ error: 'Notification not found.' })
    }

    if (isSchoolAdmin(req.profile.role) && snapshot.data().schoolId !== req.profile.schoolId) {
      return res.status(403).json({ error: 'You can only retry notifications for your own school.' })
    }

    let claimed
    try {
      claimed = await claimForRetry(ref, channel)
    } catch (err) {
      if (err instanceof RetryRejectedError) return res.status(409).json({ error: err.message })
      throw err
    }

    console.log(`[notifications] ${req.profile.name} retried ${channel} for notification ${ref.id}`)
    await dispatchChannel(ref, claimed, channel)
    invalidateAnalyticsCache()

    const updated = await ref.get()
    res.json({ notification: { id: updated.id, ...updated.data() } })
  } catch (err) {
    next(err)
  }
})

module.exports = router
