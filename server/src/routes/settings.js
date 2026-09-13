const express = require('express')
const admin = require('firebase-admin')
const { getDb } = require('../db/firebase')
const { runArchiveJob } = require('../archiver')

const router = express.Router()

const SETTINGS_DOC = 'settings/global'
const SCHOOL_SETTINGS_COLLECTION = 'schoolSettings'
const DEFAULT_OVERDUE_THRESHOLD_MINUTES = 15
const DEFAULT_ARCHIVE_RETENTION_DAYS = 30

// Shared validation for the alert-timeout (overdue) duration, in minutes.
function isValidThresholdMinutes(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440
}

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

function normaliseRole(role) {
  return String(role || '').toLowerCase().replace(/[-_\s]/g, '')
}

function isCompanyAdmin(role) {
  return normaliseRole(role) === 'companyadmin'
}

function isSchoolAdmin(role) {
  return normaliseRole(role) === 'schooladmin'
}

// Returns the caller's role and schoolId (needed to resolve per-school overrides).
async function getUserContext(uid, email) {
  const db = getDb()
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
    role: profile?.role || null,
    schoolId: profile?.schoolId || null,
  }
}

// Reads a school's overdue-threshold override, or null when the school uses the company default.
async function getSchoolThreshold(schoolId) {
  if (!schoolId) return null
  const doc = await getDb().collection(SCHOOL_SETTINGS_COLLECTION).doc(schoolId).get()
  const value = doc.exists ? doc.data()?.overdueThresholdMinutes : null
  return isValidThresholdMinutes(value) ? value : null
}

// GET /api/settings: any authenticated user may read (needed for overdue computation).
// The overdue threshold is resolved per-school: a school override wins over the
// company-wide default, and both are returned so the UI can show the default as a reference.
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const db = getDb()
    const doc = await db.doc(SETTINGS_DOC).get()
    const data = doc.exists ? doc.data() : {}

    const companyOverdueThresholdMinutes =
      data.overdueThresholdMinutes ?? DEFAULT_OVERDUE_THRESHOLD_MINUTES

    const { schoolId } = await getUserContext(req.user.uid, req.user.email)
    const schoolOverdueThresholdMinutes = await getSchoolThreshold(schoolId)

    res.json({
      // Effective value applied to this user's alerts (school override wins where set).
      overdueThresholdMinutes: schoolOverdueThresholdMinutes ?? companyOverdueThresholdMinutes,
      companyOverdueThresholdMinutes,
      schoolOverdueThresholdMinutes,
      archiveRetentionDays: data.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS,
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/settings — company admin only
router.patch('/', verifyToken, async (req, res, next) => {
  try {
    const { role } = await getUserContext(req.user.uid, req.user.email)

    if (!isCompanyAdmin(role)) {
      return res.status(403).json({ error: 'Only Company Admins can update system settings.' })
    }

    const { overdueThresholdMinutes, archiveRetentionDays } = req.body
    const updates = {}

    if (overdueThresholdMinutes !== undefined) {
      if (!isValidThresholdMinutes(overdueThresholdMinutes)) {
        return res.status(400).json({
          error: 'overdueThresholdMinutes must be a whole number between 1 and 1440.',
        })
      }
      updates.overdueThresholdMinutes = overdueThresholdMinutes
    }

    if (archiveRetentionDays !== undefined) {
      if (
        typeof archiveRetentionDays !== 'number' ||
        !Number.isInteger(archiveRetentionDays) ||
        archiveRetentionDays < 1 ||
        archiveRetentionDays > 365
      ) {
        return res.status(400).json({
          error: 'archiveRetentionDays must be a whole number between 1 and 365.',
        })
      }
      updates.archiveRetentionDays = archiveRetentionDays
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid settings fields provided.' })
    }

    const db = getDb()
    await db.doc(SETTINGS_DOC).set(updates, { merge: true })

    res.json({ success: true, ...updates })
  } catch (error) {
    next(error)
  }
})

// POST /api/settings/archive — company admin manually triggers the archive job
router.post('/archive', verifyToken, async (req, res, next) => {
  try {
    const { role } = await getUserContext(req.user.uid, req.user.email)

    if (!isCompanyAdmin(role)) {
      return res.status(403).json({ error: 'Only Company Admins can trigger archiving.' })
    }

    const result = await runArchiveJob()
    res.json({ success: true, archived: result.archived })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/settings/school-threshold: School Admin sets (or clears) their own school's
// overdue alert-timeout override. Send a number to override, or null to fall back to the
// company-wide default.
router.patch('/school-threshold', verifyToken, async (req, res, next) => {
  try {
    const { role, schoolId } = await getUserContext(req.user.uid, req.user.email)

    if (!isSchoolAdmin(role)) {
      return res.status(403).json({ error: 'Only School Admins can update school alert settings.' })
    }

    if (!schoolId) {
      return res.status(403).json({ error: 'Your account is not assigned to a school.' })
    }

    const { overdueThresholdMinutes } = req.body
    const ref = getDb().collection(SCHOOL_SETTINGS_COLLECTION).doc(schoolId)

    // null / empty clears the override so the school reverts to the company default.
    if (overdueThresholdMinutes === null || overdueThresholdMinutes === undefined) {
      await ref.set({ overdueThresholdMinutes: null }, { merge: true })
      return res.json({ success: true, overdueThresholdMinutes: null })
    }

    if (!isValidThresholdMinutes(overdueThresholdMinutes)) {
      return res.status(400).json({
        error: 'overdueThresholdMinutes must be a whole number between 1 and 1440.',
      })
    }

    await ref.set({ overdueThresholdMinutes }, { merge: true })
    res.json({ success: true, overdueThresholdMinutes })
  } catch (error) {
    next(error)
  }
})

module.exports = router
// Exposed for unit testing (Express router is a function; attaching a property is safe).
module.exports.isValidThresholdMinutes = isValidThresholdMinutes
