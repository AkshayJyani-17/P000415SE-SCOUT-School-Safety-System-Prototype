
const express = require('express')
const router = express.Router()
const nodemailer = require('nodemailer')
const ClickSend = require('clicksend')
const crypto = require('crypto')
const admin = require('firebase-admin')
const { getDb } = require('../db/firebase')
const { invalidateAnalyticsCache } = require('../analyticsCache')
const { invalidateIncidentListCache } = require('../incidentListCache')
const { getSchoolName } = require('../services/schoolService')
const { findSchoolRoutingRule } = require('../services/alertRouting')

const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`

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

// ── Email via Gmail SMTP ───────────────────────────────────────────────────────
function getMailTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD is not set in .env')
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

// ── SMS via ClickSend ─────────────────────────────────────────────────────────
function getSmsClient() {
  if (!process.env.CLICKSEND_USERNAME || !process.env.CLICKSEND_API_KEY) {
    throw new Error('CLICKSEND_USERNAME or CLICKSEND_API_KEY is not set in .env')
  }
  return new ClickSend.SMSApi(process.env.CLICKSEND_USERNAME, process.env.CLICKSEND_API_KEY)
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

async function sendAdminSummaryEmail({ emergencyType, location, body, timestamp, incidentId, notifiedStaff, schoolId, schoolName }) {
  const admins = await getAdminUsers(schoolId)

  if (admins.length === 0) {
    console.warn('No admin users found in users collection - skipping admin summary email')
    return
  }

  const formattedTime = new Date(timestamp).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'full',
    timeStyle: 'short',
  })

  const staffListHtml = notifiedStaff.map(result => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${result.name}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${result.role}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: ${result.emailStatus === 'sent' ? '#16a34a' : '#dc2626'};">
        ${result.emailStatus}
      </td>
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
          <tr>
            <td style="padding: 8px 12px; background: #f8fafc; font-weight: bold; font-size: 14px; width: 40%; border-bottom: 1px solid #e5e7eb;">Emergency Type</td>
            <td style="padding: 8px 12px; font-size: 14px; color: #dc2626; font-weight: bold; border-bottom: 1px solid #e5e7eb;">${emergencyType}</td>
          </tr>
          ${location ? `
          <tr>
            <td style="padding: 8px 12px; background: #f8fafc; font-weight: bold; font-size: 14px; border-bottom: 1px solid #e5e7eb;">Location</td>
            <td style="padding: 8px 12px; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${location}</td>
          </tr>` : ''}
          ${schoolName ? `
          <tr>
            <td style="padding: 8px 12px; background: #f8fafc; font-weight: bold; font-size: 14px; border-bottom: 1px solid #e5e7eb;">School</td>
            <td style="padding: 8px 12px; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${schoolName}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 12px; background: #f8fafc; font-weight: bold; font-size: 14px; border-bottom: 1px solid #e5e7eb;">Date & Time</td>
            <td style="padding: 8px 12px; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${formattedTime}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f8fafc; font-weight: bold; font-size: 14px; border-bottom: 1px solid #e5e7eb;">Incident ID</td>
            <td style="padding: 8px 12px; font-size: 14px; font-family: monospace; border-bottom: 1px solid #e5e7eb;">${incidentId || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f8fafc; font-weight: bold; font-size: 14px;">Message</td>
            <td style="padding: 8px 12px; font-size: 14px;">${body}</td>
          </tr>
        </table>

        <h3 style="font-size: 15px; color: #1e293b; margin: 0 0 8px;">Staff Notified</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr style="background: #f8fafc;">
            <th style="padding: 8px 12px; text-align: left; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Name</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Role</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 13px; border-bottom: 1px solid #e5e7eb;">Email Status</th>
          </tr>
          ${staffListHtml}
        </table>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 12px;">
          This is an automated summary for administrative records. No action is required from you.
          This email was sent by the SCOUT School Safety System.
        </p>
      </div>
    </div>
  `

  // Send all admin emails in parallel
  await Promise.all(admins.map(async (adminUser) => {
    try {
      const transporter = getMailTransporter()
      await transporter.sendMail({
        from: `"SCOUT Safety System" <${process.env.GMAIL_USER}>`,
        to: adminUser.email,
        subject,
        text: `Emergency Alert Summary - ${emergencyType} at ${location || 'Unknown location'} on ${formattedTime}. Incident ID: ${incidentId || 'N/A'}. Staff notified: ${notifiedStaff.map(result => result.name).join(', ')}`,
        html,
      })
      console.log(`Admin summary email sent to ${adminUser.name} (${adminUser.email})`)
    } catch (err) {
      console.error(`Admin summary email failed for ${adminUser.name}:`, err.message)
    }
  }))
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

  const subject = `EMERGENCY ALERT: ${emergencyType}${location ? ' - ' + location : ''}`
  const body = message || 'An emergency has been declared at the school. Please respond immediately.'
  const timestamp = new Date().toISOString()

  // Send all emails and SMS in parallel
  const results = await Promise.all(recipients.map(async (recipient) => {
    const token = crypto.randomUUID()
    const acknowledgeLink = `${BACKEND_URL}/api/notifications/acknowledge/${token}`
    const result = {
      name: recipient.name,
      role: recipient.role,
      email: recipient.email,
      emailStatus: 'skipped',
      smsStatus: 'skipped',
      token,
    }

    // Send Email via Gmail SMTP
    if (recipient.email && (recipient.notify === 'email' || recipient.notify === 'both' || !recipient.notify)) {
      try {
        const transporter = getMailTransporter()
        await transporter.sendMail({
          from: `"SCOUT Safety System" <${process.env.GMAIL_USER}>`,
          to: recipient.email,
          subject,
          text: `${body}\n\nClick here to acknowledge this alert: ${acknowledgeLink}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #dc2626; padding: 20px; border-radius: 8px 8px 0 0;">
                <h1 style="color: white; margin: 0;">EMERGENCY ALERT</h1>
                <p style="color: #fecaca; margin: 4px 0 0;">SCOUT School Safety Management System</p>
              </div>
              <div style="background: #fff; border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 8px 8px;">
                <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px;">Emergency Type</p>
                <p style="font-size: 18px; font-weight: bold; color: #dc2626; margin: 0 0 16px;">${emergencyType}</p>
                ${location ? `<p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px;">Location</p><p style="font-size: 15px; color: #111827; margin: 0 0 16px;">${location}</p>` : ''}
                <p style="color: #374151; font-size: 15px;">${body}</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <div style="text-align: center; margin: 24px 0;">
                  <a
                    href="${acknowledgeLink}"
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
          `,
        })
        result.emailStatus = 'sent'
        console.log(`Email sent to ${recipient.name} (${recipient.email})`)
      } catch (err) {
        result.emailStatus = 'failed'
        console.error(`Email failed for ${recipient.name}:`, err.message)
      }
    }

    // Send SMS via ClickSend
    if (recipient.phone && (recipient.notify === 'sms' || recipient.notify === 'both')) {
      try {
        const smsClient = getSmsClient()
        const smsMessage = new ClickSend.SmsMessage()
        smsMessage.to = recipient.phone
        smsMessage.body = `SCOUT EMERGENCY: ${emergencyType}${location ? ' at ' + location : ''}. Please respond immediately. Check your email to acknowledge.`
        smsMessage.from = 'SCOUT'
        const smsCollection = new ClickSend.SmsMessageCollection()
        smsCollection.messages = [smsMessage]
        await smsClient.smsSendPost(smsCollection)
        result.smsStatus = 'sent'
        console.log(`SMS sent to ${recipient.name} (${recipient.phone})`)
      } catch (err) {
        result.smsStatus = 'failed'
        console.error(`SMS failed for ${recipient.name}:`, err.message)
      }
    }

    return result
  }))

  const deliveriesSent = results.filter(result => result.emailStatus === 'sent' || result.smsStatus === 'sent').length

  try {
    const db = getDb()
    const batch = db.batch()
    for (const result of results) {
      const ref = db.collection('notifications').doc()
      batch.set(ref, {
        incidentId: incidentId || null,
        schoolId,
        schoolName,
        incidentTitle: `${emergencyType}${location ? ' - ' + location : ''}`,
        type: emergencyType.toLowerCase(),
        recipientName: result.name,
        recipientEmail: result.email,
        recipientRole: result.role,
        sms: result.smsStatus,
        email: result.emailStatus,
        token: result.token,
        acknowledged: false,
        acknowledgedAt: null,
        timestamp,
      })
    }
    await batch.commit()
    invalidateAnalyticsCache()
    console.log(`Saved ${results.length} notification log(s) to Firestore`)
  } catch (err) {
    console.error('Failed to save notification logs:', err.message)
  }

  try {
    await sendAdminSummaryEmail({
      emergencyType,
      location,
      body,
      timestamp,
      incidentId,
      notifiedStaff: results,
      schoolId,
      schoolName,
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

module.exports = router
