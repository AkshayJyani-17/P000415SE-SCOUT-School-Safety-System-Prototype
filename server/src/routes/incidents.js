const express = require('express')
const admin = require('firebase-admin')
const { docToObject, formatTimestamp, getDb, snapshotToArray } = require('../db/firebase')
const { getSchoolName } = require('../services/schoolService')
const { invalidateAnalyticsCache } = require('../analyticsCache')
const {
  getCachedIncidentList,
  invalidateIncidentListCache,
  setCachedIncidentList,
} = require('../incidentListCache')

const { watchIncidents } = require('../incidentStream')
const { getEffectiveOverdueThresholdMinutes } = require('./settings')

const router = express.Router()

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'No token provided.' })
  }

  try {
    req.user = await admin.auth().verifyIdToken(token)
    next()
  } catch (err) {
    console.error('Firebase token verification failed:', err.code, err.message)
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }
}

async function getNextIncidentNumber() {
  const db = getDb()
  const counterRef = db.collection('counters').doc('incidents')

  const nextNumber = await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef)

    let next = 1

    if (counterDoc.exists) {
      next = (counterDoc.data().lastNumber || 0) + 1
    }

    transaction.set(counterRef, { lastNumber: next }, { merge: true })

    return next
  })

  return `INC${String(nextNumber).padStart(3, '0')}`
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

function canCreateIncident(role) {
  return ['companyadmin', 'schooladmin', 'staff'].includes(normaliseRole(role))
}

async function getUserProfile(decodedUser) {
  const db = getDb()
  const { uid, email, name } = decodedUser
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
    name: profile?.name || name || email || 'Unknown',
    role: profile?.role || null,
    schoolId: profile?.schoolId || null,
    // Live lookup first so a renamed school is reflected immediately; the
    // stored copy is the fallback for a schoolId that no longer resolves.
    schoolName: (await getSchoolName(profile?.schoolId)) || profile?.schoolName || null,
  }
}

async function getVisibleIncidents(profile) {
  const db = getDb()

  if (isCompanyAdmin(profile.role)) {
    const snapshot = await db.collection('incidents').get()
    return snapshotToArray(snapshot)
  }

  if (isSchoolAdmin(profile.role)) {
    if (!profile.schoolId) return []

    const snapshot = await db.collection('incidents')
      .where('schoolId', '==', profile.schoolId)
      .get()
    return snapshotToArray(snapshot)
  }

  const incidentMap = new Map()
  const addSnapshot = snapshot => {
    snapshotToArray(snapshot).forEach(incident => {
      incidentMap.set(incident.id, incident)
    })
  }

  const submittedSnapshot = await db.collection('incidents')
    .where('triggeredById', '==', profile.uid)
    .get()
  addSnapshot(submittedSnapshot)

  const assignedByIdSnapshot = await db.collection('incidents')
    .where('assignedUserIds', 'array-contains', profile.uid)
    .get()
  addSnapshot(assignedByIdSnapshot)

  if (profile.email) {
    const assignedByEmailSnapshot = await db.collection('incidents')
      .where('assignedUserEmails', 'array-contains', profile.email)
      .get()
    addSnapshot(assignedByEmailSnapshot)
  }

  return [...incidentMap.values()]
}

function canReadIncident(profile, incident) {
  if (isCompanyAdmin(profile.role)) return true
  if (isSchoolAdmin(profile.role)) {
    return Boolean(profile.schoolId && incident.schoolId === profile.schoolId)
  }

  const assignedUserIds = Array.isArray(incident.assignedUserIds) ? incident.assignedUserIds : []
  const assignedUserEmails = Array.isArray(incident.assignedUserEmails) ? incident.assignedUserEmails : []

  return incident.triggeredById === profile.uid ||
    assignedUserIds.includes(profile.uid) ||
    (profile.email && assignedUserEmails.includes(profile.email))
}

function canUpdateIncidentStatus(profile, incident) {
  return canReadIncident(profile, incident) && (isCompanyAdmin(profile.role) || isSchoolAdmin(profile.role))
}

// Deletion reasons are stored as a code so the audit trail stays analysable
// instead of becoming a free-text dump.
const DELETION_REASON_CODES = ['duplicate', 'test_or_drill', 'logged_in_error', 'wrong_school', 'other']

const MAX_DELETION_REASON_LENGTH = 500

const DELETE_INELIGIBLE_MESSAGE =
  'Only test alerts, resolved incidents, and overdue incidents that nobody has acknowledged can be deleted.'

function incidentAgeMinutes(incident) {
  const raw = incident.createdAt
  if (!raw) return 0

  const created = raw.toDate ? raw.toDate() : new Date(raw)
  if (Number.isNaN(created.getTime())) return 0

  return Math.floor((Date.now() - created.getTime()) / 60000)
}

// What may be removed, and why:
//   - a drill, which carries no genuine record value;
//   - a resolved incident, whose response has finished;
//   - an abandoned one: still triggered, nobody acknowledged it, and already
//     past the overdue threshold the dashboard flags it with. Nothing is
//     responding to it, so no response record is destroyed.
//
// Everything else is a live response. Deleting one of those would pull the
// record out from under the people working it, and the email acknowledgement
// link writes back into the incident document (see routes/notifications.js).
function canDeleteIncident(incident, overdueThresholdMinutes) {
  if (incident.isTest === true) return true
  if (incident.status === 'resolved') return true

  if (incident.status !== 'triggered') return false

  const acknowledged = Array.isArray(incident.acknowledgedBy) && incident.acknowledgedBy.length > 0
  if (acknowledged) return false

  return incidentAgeMinutes(incident) > overdueThresholdMinutes
}

function appendUniqueActor(list, profile, timestamp, timeField) {
  const existing = Array.isArray(list) ? list : []
  const alreadyRecorded = existing.some(actor =>
    (profile.uid && actor.uid === profile.uid) ||
    (profile.email && actor.email === profile.email)
  )

  if (alreadyRecorded) return existing

  return [
    ...existing,
    {
      uid: profile.uid,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      [timeField]: timestamp,
    },
  ]
}

function getSortValue(incident) {
  //tries to get a timestamp for sorting based on createdAt, updatedAt, or timestamp fields
  const value = incident.createdAt || incident.updatedAt || incident.timestamp

  if (!value) return 0
  //if it is a Firestore Timestamp, use toMillis() to convert it into a number
  if (typeof value.toMillis === 'function') return value.toMillis()
  //otherwise, try to parse it as a date string and return the timestamp
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function toIsoTimestamp(value) {
  if (!value) return null
  const date = value.toDate ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

//converts a raw Firestore incident into the response shape used by the frontend
function toIncidentResponse(incident) {
  return {
    id: String(incident.id),
    incidentNumber: incident.incidentNumber || null,
    type: incident.type || 'general',
    priority: incident.priority || 'low',
    status: incident.status || 'triggered',
    title: incident.title || 'Untitled incident',
    location: incident.location || 'Unknown location',
    createdAt: toIsoTimestamp(incident.createdAt),
    updatedAt: toIsoTimestamp(incident.updatedAt),
    timestamp: incident.createdAt ? formatTimestamp(incident.createdAt) : '',
    triggeredByName: incident.triggeredByName || 'Unknown reporter',
    triggeredById: incident.triggeredById || null,
    triggeredByEmail: incident.triggeredByEmail || null,
    triggeredByRole: incident.triggeredByRole || null,
    schoolId: incident.schoolId || null,
    schoolName: incident.schoolName || null,
    assignedUserIds: Array.isArray(incident.assignedUserIds) ? incident.assignedUserIds : [],
    assignedUserEmails: Array.isArray(incident.assignedUserEmails) ? incident.assignedUserEmails : [],
    description: incident.description || '',
    isTest: incident.isTest === true,
    acknowledgedBy: incident.acknowledgedBy || [],  // ← added
    inProgressBy: incident.inProgressBy || [],
    notifications: [],
    reviewRequired: incident.reviewRequired || false,
    reviewComments: Array.isArray(incident.reviewComments) ? incident.reviewComments : [],
  }
}

router.get('/', verifyToken, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user)
    const cachedIncidents = getCachedIncidentList(profile)
    const visibleIncidents = cachedIncidents || await getVisibleIncidents(profile)

    if (!cachedIncidents) {
      setCachedIncidentList(profile, visibleIncidents)
    }

    //sorts incidents from newest to oldest based on createdAt, updatedAt, or timestamp and converts to response format
    const incidents = visibleIncidents
      .sort((left, right) => getSortValue(right) - getSortValue(left))
      .map(toIncidentResponse)
    //sends the result back as JSON
    res.json({ incidents })
  } catch (error) {
    next(error)
  }
})
// GET /api/incidents/archived — company admin only; reads from archivedIncidents collection
// Must be registered before /:id to prevent Express treating 'archived' as an ID
// Authenticated, role-scoped live status stream. Renew periodically to recheck access.
router.get('/stream', verifyToken, async (req, res, next) => {
  let unsubscribe = () => {}
  let heartbeat
  let renewal
  let closed = false
  const close = () => {
    closed = true
    clearInterval(heartbeat)
    clearTimeout(renewal)
    unsubscribe()
    if (!res.writableEnded) res.end()
  }
  res.on('close', close)
  try {
    const profile = await getUserProfile(req.user)
    if (closed) return
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' })
    res.flushHeaders()
    heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000)
    renewal = setTimeout(close, 60000)
    unsubscribe = watchIncidents(getDb(), profile, records => {
      if (closed) return
      const incidents = records.sort((a, b) => getSortValue(b) - getSortValue(a)).map(toIncidentResponse)
      res.write(`data: ${JSON.stringify({ incidents })}\n\n`)
    }, close)
    if (closed) unsubscribe()
  } catch (error) {
    if (res.headersSent) close()
    else next(error)
  }
})
router.get('/archived', verifyToken, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user)

    if (!isCompanyAdmin(profile.role)) {
      return res.status(403).json({ error: 'Only Company Admins can view archived incidents.' })
    }

    const snapshot = await getDb().collection('archivedIncidents').get()
    const incidents = snapshotToArray(snapshot)
      .sort((left, right) => getSortValue(right) - getSortValue(left))
      .map(incident => ({
        ...toIncidentResponse(incident),
        archivedAt: incident.archivedAt || null,
      }))

    res.json({ incidents })
  } catch (error) {
    next(error)
  }
})

//gets a specific incident by ID
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user)
    const doc = await getDb().collection('incidents').doc(req.params.id).get()
    const incident = docToObject(doc)

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    if (!canReadIncident(profile, incident)) {
      return res.status(403).json({ error: 'You do not have access to this incident.' })
    }

    const notificationsSnapshot = await getDb()
      .collection('notifications')
      .where('incidentId', '==', req.params.id)
      .get()
    //converts each notification into a smaller response object
    const notifications = snapshotToArray(notificationsSnapshot).map(notification => ({
      recipientName: notification.recipientName || 'Unknown recipient',
      sms: notification.sms || notification.smsStatus || 'pending',      // ← fixed
      email: notification.email || notification.emailStatus || 'pending', // ← fixed
    }))
    //returns the incident details
    res.json({
      incident: {
        ...toIncidentResponse(incident),
        notifications,
      },
    })
  } catch (error) {
    next(error)
  }
})

// Resolve the same school-scoped routing used to configure alert recipients.
router.get('/preview/recipients', verifyToken, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user)
    if (!canCreateIncident(profile.role)) return res.status(403).json({ error: 'You do not have permission to preview alerts.' })
    const schoolId = isCompanyAdmin(profile.role) ? req.query.schoolId : profile.schoolId
    const type = String(req.query.type || '').trim()
    if (!schoolId || !type) return res.status(400).json({ error: 'School and alert type are required.' })

    const db = getDb()
    const snapshot = await db.collection('notificationRouting').where('schoolId', '==', schoolId).get()
    const rule = snapshot.docs.map(doc => doc.data()).find(item =>
      item.active !== false && String(item.alertType || '').toLowerCase().replace(/\s+/g, '_') === type.toLowerCase()
    )
    let recipients = []
    if (rule && Array.isArray(rule.recipients)) {
      recipients = rule.recipients.filter(item => item.email || item.phone)
    } else if (rule && Array.isArray(rule.roles)) {
      const contacts = await db.collection('notificationRecipients').where('schoolId', '==', schoolId).get()
      recipients = contacts.docs.map(doc => doc.data()).filter(item => item.active !== false && rule.roles.includes(item.role) && (item.email || item.phone))
    }
    res.json({ recipients: recipients.map(({ name, email, phone, notify, role }) => ({ name, email, phone, notify, role })) })
  } catch (error) {
    next(error)
  }
})

router.post('/', verifyToken, async (req, res, next) => {
  try {
    const { type, priority, status, title, location, description, isTest } = req.body
    const now = new Date().toISOString()
    const reporter = await getUserProfile(req.user)

    if (!canCreateIncident(reporter.role)) {
      return res.status(403).json({ error: 'You do not have permission to submit incidents.' })
    }

    const schoolId = isCompanyAdmin(reporter.role) ? req.body.schoolId : reporter.schoolId
    if (!schoolId) {
      return res.status(403).json({ error: 'Your account is not assigned to a school.' })
    }
    let schoolName = reporter.schoolName
    if (isCompanyAdmin(reporter.role)) {
      const school = await getDb().collection('schools').doc(schoolId).get()
      if (!school.exists || school.data().active === false) return res.status(400).json({ error: 'Select an active school.' })
      schoolName = school.data().name
    }
    const incidentNumber = await getNextIncidentNumber()

    const docRef = await getDb().collection('incidents').add({
      incidentNumber,
      type: type || 'general',
      priority: priority || 'low',
      status: status || 'triggered',
      title: title || 'Untitled incident',
      location: location || 'Unknown',
      description: description || '',
      // Alerts sent from the School Admin Alert Testing page are drills, not real incidents.
      isTest: isTest === true,
      triggeredByName: reporter.name,
      triggeredById: reporter.uid,
      triggeredByEmail: reporter.email,
      triggeredByRole: reporter.role,
      schoolId,
      schoolName,
      assignedUserIds: [],
      assignedUserEmails: [],
      createdAt: now,
      updatedAt: now,
    })

    const doc = await docRef.get()
    const incident = { id: doc.id, ...doc.data() }
    invalidateAnalyticsCache()
    invalidateIncidentListCache()
    res.status(201).json(toIncidentResponse(incident))
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/status', verifyToken, async (req, res, next) => {
  try {
    const { status, updatedByName, updatedByRole } = req.body
    const now = new Date().toISOString()
    const db = getDb()
    const profile = await getUserProfile(req.user)
    const docRef = db.collection('incidents').doc(req.params.id)
    const doc = await docRef.get()
    const incident = docToObject(doc)

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    if (!canUpdateIncidentStatus(profile, incident)) {
      return res.status(403).json({ error: 'You do not have permission to update this incident.' })
    }

    const updates = { status, updatedAt: now }

    if (status === 'acknowledged') {
      updates.acknowledgedBy = appendUniqueActor(incident.acknowledgedBy, profile, now, 'acknowledgedAt')
    }

    if (status === 'in-progress') {
      updates.inProgressBy = appendUniqueActor(incident.inProgressBy, profile, now, 'inProgressAt')
    }

    await docRef.update(updates)
    const updatedDoc = await docRef.get()
    const updatedIncident = docToObject(updatedDoc)
    invalidateAnalyticsCache()
    invalidateIncidentListCache()
    res.json({ success: true, incident: toIncidentResponse(updatedIncident) })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/incidents/:id/review-flag — School Admin only
// Sets reviewRequired to true (with a required comment) or false (to close the review)
router.patch('/:id/review-flag', verifyToken, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user)

    if (!isSchoolAdmin(profile.role)) {
      return res.status(403).json({ error: 'Only School Admins can manage the review flag.' })
    }

    const db = getDb()
    const docRef = db.collection('incidents').doc(req.params.id)
    const doc = await docRef.get()
    const incident = docToObject(doc)

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    if (!canReadIncident(profile, incident)) {
      return res.status(403).json({ error: 'You do not have access to this incident.' })
    }

    const { reviewRequired, comment } = req.body
    const now = new Date().toISOString()
    const updates = { reviewRequired: Boolean(reviewRequired), updatedAt: now }

    if (reviewRequired) {
      if (!comment || !String(comment).trim()) {
        return res.status(400).json({ error: 'A comment is required when flagging for review.' })
      }
      const existing = Array.isArray(incident.reviewComments) ? incident.reviewComments : []
      updates.reviewComments = [
        ...existing,
        {
          uid: profile.uid,
          name: profile.name,
          role: profile.role,
          comment: String(comment).trim(),
          createdAt: now,
        },
      ]
    }

    await docRef.update(updates)
    const updatedDoc = await docRef.get()
    const updatedIncident = docToObject(updatedDoc)
    invalidateIncidentListCache()
    res.json({ success: true, incident: toIncidentResponse(updatedIncident) })
  } catch (error) {
    next(error)
  }
})

// POST /api/incidents/:id/review-comment — School Admin or Company Admin
// Appends a comment to the review thread on an incident that already has reviewRequired: true
router.post('/:id/review-comment', verifyToken, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user)

    if (!isSchoolAdmin(profile.role) && !isCompanyAdmin(profile.role)) {
      return res.status(403).json({ error: 'Only admins can add review comments.' })
    }

    const db = getDb()
    const docRef = db.collection('incidents').doc(req.params.id)
    const doc = await docRef.get()
    const incident = docToObject(doc)

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    if (!canReadIncident(profile, incident)) {
      return res.status(403).json({ error: 'You do not have access to this incident.' })
    }

    const { comment } = req.body
    if (!comment || !String(comment).trim()) {
      return res.status(400).json({ error: 'Comment cannot be empty.' })
    }

    const now = new Date().toISOString()
    const existing = Array.isArray(incident.reviewComments) ? incident.reviewComments : []

    await docRef.update({
      reviewComments: [
        ...existing,
        {
          uid: profile.uid,
          name: profile.name,
          role: profile.role,
          comment: String(comment).trim(),
          createdAt: now,
        },
      ],
      updatedAt: now,
    })

    const updatedDoc = await docRef.get()
    const updatedIncident = docToObject(updatedDoc)
    invalidateIncidentListCache()
    res.json({ success: true, incident: toIncidentResponse(updatedIncident) })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/incidents/:id
// Company Admins may delete any incident, School Admins only their own
// school's. Staff are excluded on purpose: a reporter must not be able to
// erase their own report.
//
// This is a soft delete. The record is copied into deletedIncidents with who
// deleted it, when and why, then removed from incidents. This is the same
// move the archiver performs for aged out incidents. Deleted records are not
// readable
// through the app.
router.delete('/:id', verifyToken, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user)

    if (!isCompanyAdmin(profile.role) && !isSchoolAdmin(profile.role)) {
      return res.status(403).json({ error: 'Only admins can delete incidents.' })
    }

    const db = getDb()
    const docRef = db.collection('incidents').doc(req.params.id)
    const doc = await docRef.get()
    const incident = docToObject(doc)

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found.' })
    }

    // Reused so a School Admin is held to their own school here exactly as
    // they are everywhere else in this file.
    if (!canReadIncident(profile, incident)) {
      return res.status(403).json({ error: 'You do not have permission to delete this incident.' })
    }

    // Resolved per-school so the gate matches the "Overdue" badge the user sees.
    const overdueThresholdMinutes = await getEffectiveOverdueThresholdMinutes(incident.schoolId)

    if (!canDeleteIncident(incident, overdueThresholdMinutes)) {
      return res.status(409).json({ error: DELETE_INELIGIBLE_MESSAGE })
    }

    const { reasonCode, reason } = req.body || {}

    if (!DELETION_REASON_CODES.includes(reasonCode)) {
      return res.status(400).json({ error: 'A valid deletion reason is required.' })
    }

    const detail = typeof reason === 'string' ? reason.trim() : ''

    if (reasonCode === 'other' && !detail) {
      return res.status(400).json({ error: 'Please describe the reason for deleting this incident.' })
    }

    if (detail.length > MAX_DELETION_REASON_LENGTH) {
      return res.status(400).json({ error: `Reason must be ${MAX_DELETION_REASON_LENGTH} characters or fewer.` })
    }

    const now = new Date().toISOString()
    const batch = db.batch()

    batch.set(db.collection('deletedIncidents').doc(doc.id), {
      ...doc.data(),
      deletedAt: now,
      deletionReasonCode: reasonCode,
      deletionReason: detail,
      deletedBy: {
        uid: profile.uid || null,
        name: profile.name || null,
        email: profile.email || null,
        role: profile.role || null,
      },
    })
    batch.delete(docRef)

    await batch.commit()

    // Without these the incident keeps showing in the list and in dashboard
    // counts, which are both served from caches.
    invalidateIncidentListCache()
    invalidateAnalyticsCache()

    res.json({ success: true, id: doc.id })
  } catch (error) {
    next(error)
  }
})

module.exports = router
module.exports.getSortValue = getSortValue
module.exports.toIncidentResponse = toIncidentResponse
module.exports.toIsoTimestamp = toIsoTimestamp
