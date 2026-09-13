// analytics.js - Role-protected analytics routes.

const express = require('express')
const admin = require('firebase-admin')
const { getDb } = require('../db/firebase')
const { getAnalytics, getTrends, VALID_RANGES } = require('../analyticsCache')
const { getSchoolById, normaliseRole } = require('../services/schoolService')

const router = express.Router()

// Sentinel used by the Company Admin school filter to ask for every school.
const ALL_SCHOOLS = 'all'

function isCompanyAdmin(role) {
  return normaliseRole(role) === 'companyadmin'
}

function isSchoolAdmin(role) {
  return normaliseRole(role) === 'schooladmin'
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
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }
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
    role: profile?.role || null,
    schoolId: profile?.schoolId || null,
  }
}

async function requireAnalyticsViewer(req, res, next) {
  try {
    const profile = await getUserProfile(req.user)

    if (!isCompanyAdmin(profile.role) && !isSchoolAdmin(profile.role)) {
      return res.status(403).json({ error: 'You do not have permission to view analytics.' })
    }

    if (isSchoolAdmin(profile.role) && !profile.schoolId) {
      return res.status(403).json({ error: 'Your account is not assigned to a school.' })
    }

    req.profile = profile
    next()
  } catch (error) {
    console.error('Failed to verify analytics viewer:', error)
    return res.status(500).json({ error: 'Failed to verify analytics viewer.' })
  }
}

// Decides which school the request is allowed to read.
//
// A School Admin is always pinned to their own school: the filter is theirs to
// see, not to change, so an explicit request for another school is rejected
// rather than silently downgraded. Only a Company Admin may widen the scope to
// every school or pick a different one.
class ScopeError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function resolveScope(profile, requestedSchoolId) {
  const requested = typeof requestedSchoolId === 'string' ? requestedSchoolId.trim() : ''

  if (isSchoolAdmin(profile.role)) {
    if (requested && requested !== ALL_SCHOOLS && requested !== profile.schoolId) {
      throw new ScopeError('You can only view analytics for your own school.', 403)
    }
    const school = await getSchoolById(profile.schoolId)
    return { schoolId: profile.schoolId, schoolName: school?.name || null, isSystemWide: false }
  }

  if (!requested || requested === ALL_SCHOOLS) {
    return { schoolId: null, schoolName: null, isSystemWide: true }
  }

  const school = await getSchoolById(requested)
  if (!school) {
    throw new ScopeError('School not found.', 404)
  }

  return { schoolId: school.id, schoolName: school.name || null, isSystemWide: false }
}

// Wraps a handler so scope resolution failures map to their HTTP status
// instead of falling through to the generic error handler.
function withScope(handler) {
  return async (req, res, next) => {
    try {
      const scope = await resolveScope(req.profile, req.query.schoolId)
      await handler(req, res, scope)
    } catch (error) {
      if (error instanceof ScopeError) {
        return res.status(error.status).json({ error: error.message })
      }
      next(error)
    }
  }
}

function analyticsOptions(scope) {
  return { schoolId: scope.schoolId, includeFailedAlerts: true }
}

router.use(verifyToken, requireAnalyticsViewer)

router.get('/all', withScope(async (req, res, scope) => {
  const data = await getAnalytics(analyticsOptions(scope))
  res.json({ ...data, scope })
}))

router.get('/summary', withScope(async (req, res, scope) => {
  const data = await getAnalytics(analyticsOptions(scope))
  res.json(data.summary)
}))

router.get('/by-type', withScope(async (req, res, scope) => {
  const data = await getAnalytics(analyticsOptions(scope))
  res.json(data.incidentsByType)
}))

router.get('/status-breakdown', withScope(async (req, res, scope) => {
  const data = await getAnalytics(analyticsOptions(scope))
  res.json(data.statusBreakdown)
}))

router.get('/by-location', withScope(async (req, res, scope) => {
  const data = await getAnalytics(analyticsOptions(scope))
  res.json(data.locationData)
}))

router.get('/this-week', withScope(async (req, res, scope) => {
  const data = await getAnalytics(analyticsOptions(scope))
  res.json(data.incidentsByDay)
}))

router.get('/response-time-trend', withScope(async (req, res, scope) => {
  const data = await getAnalytics(analyticsOptions(scope))
  res.json(data.responseTimeData)
}))

router.get('/trends', withScope(async (req, res, scope) => {
  const range = VALID_RANGES.includes(req.query.range) ? req.query.range : 'week'
  const data = await getTrends({ schoolId: scope.schoolId, range })
  res.json({ ...data, range, scope })
}))

module.exports = router
module.exports.resolveScope = resolveScope
module.exports.ScopeError = ScopeError
