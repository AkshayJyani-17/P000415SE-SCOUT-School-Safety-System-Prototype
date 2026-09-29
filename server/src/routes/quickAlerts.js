// quickAlerts.js - Personal quick alert shortcuts owned by a staff member.
//
// A quick alert is a saved shortcut, not a new alert type. It points at an
// alert type the Company Admin already configured and stores the staff
// member's own label plus preset priority, location and notes. Notification
// routing therefore keeps working unchanged: triggering a shortcut sends the
// referenced alert type, which the School Admin's routing rules already map to
// recipients.

const express = require('express')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { getDb } = require('../db/firebase')

const router = express.Router()

const PREFERENCES_COLLECTION = 'userPreferences'
const MAX_QUICK_ALERTS = 5

const PRIORITIES = ['critical', 'high', 'medium', 'low']
const DEFAULT_PRIORITY_BY_CATEGORY = { emergency: 'critical', general: 'medium' }

const LABEL_MIN_LENGTH = 2
const LABEL_MAX_LENGTH = 40
const DESCRIPTION_MAX_LENGTH = 280

// ── Validation (pure) ─────────────────────────────────────────────────────────

function normaliseRole(role) {
  return String(role || '').toLowerCase().replace(/[-_\s]/g, '')
}

function isStaff(role) {
  return normaliseRole(role) === 'staff'
}

function normaliseText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function validateLabel(raw) {
  const label = normaliseText(raw)

  if (!label) return { valid: false, error: 'A name is required.' }
  if (/[\x00-\x1f\x7f]/.test(label)) {
    return { valid: false, error: 'Name contains invalid characters.' }
  }
  if (label.length < LABEL_MIN_LENGTH) {
    return { valid: false, error: `Name must be at least ${LABEL_MIN_LENGTH} characters.` }
  }
  if (label.length > LABEL_MAX_LENGTH) {
    return { valid: false, error: `Name must be ${LABEL_MAX_LENGTH} characters or fewer.` }
  }

  return { valid: true, label }
}

function validateDescription(raw) {
  if (raw === undefined || raw === null || raw === '') return { valid: true, description: null }

  const description = normaliseText(raw)
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return { valid: false, error: `Notes must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.` }
  }

  return { valid: true, description: description || null }
}

function validatePriority(raw, category) {
  if (raw === undefined || raw === null || raw === '') {
    return { valid: true, priority: DEFAULT_PRIORITY_BY_CATEGORY[category] || 'medium' }
  }

  const priority = String(raw).toLowerCase().trim()
  if (!PRIORITIES.includes(priority)) {
    return { valid: false, error: `Priority must be one of: ${PRIORITIES.join(', ')}.` }
  }

  return { valid: true, priority }
}

function labelsMatch(left, right) {
  return normaliseText(left).toLowerCase() === normaliseText(right).toLowerCase()
}

// ── Middleware ────────────────────────────────────────────────────────────────

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) return res.status(401).json({ error: 'No token provided.' })

  try {
    req.user = await admin.auth().verifyIdToken(token)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }
}

async function getUserProfile(decodedUser) {
  const db = getDb()
  const { uid, email } = decodedUser

  const userDoc = await db.collection('users').doc(uid).get()
  if (userDoc.exists) return { uid, ...userDoc.data() }

  if (email) {
    const byEmail = await db.collection('users').where('email', '==', email).limit(1).get()
    if (!byEmail.empty) return { uid, ...byEmail.docs[0].data() }
  }

  return { uid, email, role: null }
}

// Quick alerts are a personal staff convenience. Admins configure alert types
// and routing instead, so they have no use for them and are refused here.
async function requireStaff(req, res, next) {
  try {
    const profile = await getUserProfile(req.user)

    if (!isStaff(profile.role)) {
      return res.status(403).json({ error: 'Quick alerts are available to staff accounts only.' })
    }

    req.profile = profile
    next()
  } catch (err) {
    next(err)
  }
}

// ── Data access ───────────────────────────────────────────────────────────────

function preferencesRef(uid) {
  return getDb().collection(PREFERENCES_COLLECTION).doc(uid)
}

async function readQuickAlerts(uid) {
  const doc = await preferencesRef(uid).get()
  const stored = doc.exists ? doc.data()?.quickAlerts : null
  return Array.isArray(stored) ? stored : []
}

async function loadAlertTypesById() {
  const snapshot = await getDb().collection('alertTypes').get()
  const byId = new Map()
  for (const doc of snapshot.docs) {
    byId.set(doc.id, { id: doc.id, ...doc.data() })
  }
  return byId
}

async function loadLocationLabels() {
  const snapshot = await getDb().collection('locations').get()
  return snapshot.docs.map(doc => normaliseText(doc.data()?.label)).filter(Boolean)
}

// Joins each stored shortcut with its alert type. The type is resolved live so
// a Company Admin renaming it flows through, and a shortcut whose type was
// deleted is returned flagged as unavailable rather than silently dropped —
// the owner needs to see it to fix or remove it.
function resolveQuickAlerts(quickAlerts, alertTypesById) {
  return quickAlerts.map(quickAlert => {
    const alertType = alertTypesById.get(quickAlert.alertTypeId) || null
    const available = Boolean(alertType) && alertType.active !== false

    return {
      ...quickAlert,
      alertType: alertType
        ? {
            id: alertType.id,
            label: alertType.label,
            value: alertType.value,
            emoji: alertType.emoji || '',
            category: alertType.category,
          }
        : null,
      available,
      unavailableReason: available
        ? null
        : 'The alert type this shortcut uses is no longer available. Edit or remove it.',
    }
  })
}

async function respondWithList(res, uid, status = 200) {
  const [quickAlerts, alertTypesById] = await Promise.all([
    readQuickAlerts(uid),
    loadAlertTypesById(),
  ])

  const resolved = resolveQuickAlerts(quickAlerts, alertTypesById)

  res.status(status).json({
    quickAlerts: resolved,
    limit: MAX_QUICK_ALERTS,
    remaining: Math.max(0, MAX_QUICK_ALERTS - resolved.length),
  })
}

// Validates the request body against the configured alert types and locations.
async function buildPayload(body, { alertTypesById, locationLabels }) {
  const labelCheck = validateLabel(body?.label)
  if (!labelCheck.valid) return { error: labelCheck.error, status: 400 }

  const alertTypeId = String(body?.alertTypeId || '').trim()
  if (!alertTypeId) return { error: 'An alert type is required.', status: 400 }

  const alertType = alertTypesById.get(alertTypeId)
  if (!alertType || alertType.active === false) {
    return { error: 'That alert type is not available.', status: 400 }
  }

  const priorityCheck = validatePriority(body?.priority, alertType.category)
  if (!priorityCheck.valid) return { error: priorityCheck.error, status: 400 }

  const descriptionCheck = validateDescription(body?.description)
  if (!descriptionCheck.valid) return { error: descriptionCheck.error, status: 400 }

  let location = null
  if (body?.location !== undefined && body?.location !== null && body?.location !== '') {
    const requested = normaliseText(body.location)
    const match = locationLabels.find(label => labelsMatch(label, requested))
    if (!match) return { error: 'That location is not configured.', status: 400 }
    location = match
  }

  return {
    payload: {
      label: labelCheck.label,
      alertTypeId,
      priority: priorityCheck.priority,
      location,
      description: descriptionCheck.description,
    },
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.use(verifyToken, requireStaff)

router.get('/', async (req, res, next) => {
  try {
    await respondWithList(res, req.profile.uid)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const { uid } = req.profile
    const [alertTypesById, locationLabels] = await Promise.all([
      loadAlertTypesById(),
      loadLocationLabels(),
    ])

    const built = await buildPayload(req.body, { alertTypesById, locationLabels })
    if (built.error) return res.status(built.status).json({ error: built.error })

    const now = new Date().toISOString()
    const ref = preferencesRef(uid)

    // The limit and the duplicate-name check both read the current list, so the
    // whole read-modify-write runs in a transaction: two tabs saving at once
    // must not be able to push the owner past the limit.
    const result = await getDb().runTransaction(async transaction => {
      const doc = await transaction.get(ref)
      const existing = Array.isArray(doc.data()?.quickAlerts) ? doc.data().quickAlerts : []

      if (existing.length >= MAX_QUICK_ALERTS) {
        return { error: `You can save up to ${MAX_QUICK_ALERTS} quick alerts.`, status: 409 }
      }

      if (existing.some(entry => labelsMatch(entry.label, built.payload.label))) {
        return { error: 'You already have a quick alert with that name.', status: 409 }
      }

      const quickAlert = {
        id: crypto.randomUUID(),
        ...built.payload,
        createdAt: now,
        updatedAt: now,
      }

      transaction.set(ref, { quickAlerts: [...existing, quickAlert] }, { merge: true })
      return { quickAlert }
    })

    if (result.error) return res.status(result.status).json({ error: result.error })

    await respondWithList(res, uid, 201)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const { uid } = req.profile
    const [alertTypesById, locationLabels] = await Promise.all([
      loadAlertTypesById(),
      loadLocationLabels(),
    ])

    const built = await buildPayload(req.body, { alertTypesById, locationLabels })
    if (built.error) return res.status(built.status).json({ error: built.error })

    const ref = preferencesRef(uid)
    const now = new Date().toISOString()

    const result = await getDb().runTransaction(async transaction => {
      const doc = await transaction.get(ref)
      const existing = Array.isArray(doc.data()?.quickAlerts) ? doc.data().quickAlerts : []
      const index = existing.findIndex(entry => entry.id === req.params.id)

      if (index === -1) return { error: 'Quick alert not found.', status: 404 }

      const clashes = existing.some(
        (entry, entryIndex) => entryIndex !== index && labelsMatch(entry.label, built.payload.label)
      )
      if (clashes) return { error: 'You already have a quick alert with that name.', status: 409 }

      const updated = [...existing]
      updated[index] = { ...existing[index], ...built.payload, updatedAt: now }

      transaction.set(ref, { quickAlerts: updated }, { merge: true })
      return { quickAlert: updated[index] }
    })

    if (result.error) return res.status(result.status).json({ error: result.error })

    await respondWithList(res, uid)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const { uid } = req.profile
    const ref = preferencesRef(uid)

    const result = await getDb().runTransaction(async transaction => {
      const doc = await transaction.get(ref)
      const existing = Array.isArray(doc.data()?.quickAlerts) ? doc.data().quickAlerts : []
      const remaining = existing.filter(entry => entry.id !== req.params.id)

      if (remaining.length === existing.length) return { error: 'Quick alert not found.', status: 404 }

      transaction.set(ref, { quickAlerts: remaining }, { merge: true })
      return { removed: true }
    })

    if (result.error) return res.status(result.status).json({ error: result.error })

    await respondWithList(res, uid)
  } catch (err) {
    next(err)
  }
})

module.exports = router
module.exports.validateLabel = validateLabel
module.exports.validatePriority = validatePriority
module.exports.validateDescription = validateDescription
module.exports.resolveQuickAlerts = resolveQuickAlerts
module.exports.labelsMatch = labelsMatch
module.exports.MAX_QUICK_ALERTS = MAX_QUICK_ALERTS
module.exports.PRIORITIES = PRIORITIES
