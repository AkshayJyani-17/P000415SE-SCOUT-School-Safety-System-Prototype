const express = require('express')
const admin = require('firebase-admin')
const { getDb, docToObject, snapshotToArray } = require('../db/firebase')
const { alertTypeKey } = require('../services/alertRouting')

const router = express.Router()

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

function normaliseRole(role) {
  return String(role || '').toLowerCase().replace(/[-_\s]/g, '')
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

  return { uid, email, role: 'staff' }
}

// Blocks the route if user is not a Company Admin
async function requireCompanyAdmin(req, res, next) {
  try {
    const profile = await getUserProfile(req.user)
    if (normaliseRole(profile.role) !== 'companyadmin') {
      return res.status(403).json({ error: 'Company Admin access required.' })
    }
    req.profile = profile
    next()
  } catch (err) {
    next(err)
  }
}

// Blocks the route if user is not a School Admin
async function requireSchoolAdmin(req, res, next) {
  try {
    const profile = await getUserProfile(req.user)
    if (normaliseRole(profile.role) !== 'schooladmin') {
      return res.status(403).json({ error: 'School Admin access required.' })
    }
    if (!profile.schoolId) {
      return res.status(403).json({ error: 'Your account is not assigned to a school.' })
    }
    req.profile = profile
    next()
  } catch (err) {
    next(err)
  }
}

// ── Alert Types ───────────────────────────────────────────────────────────────

// Two alert types cannot share a name. Each school saves its recipient list
// against the name, so a second type with the same name could never be given
// recipients of its own, and alerts of that type would reach nobody.
//
// Names are compared in the same normalised form the recipient lookup uses,
// so "Fire" and "fire" count as the same name.
async function findAlertTypeWithSameName(db, label, exceptId = null) {
  const snapshot = await db.collection('alertTypes').get()
  const wanted = alertTypeKey(label)

  return (
    snapshot.docs.find(
      doc => doc.id !== exceptId && alertTypeKey(doc.data()?.label) === wanted
    ) || null
  )
}

// GET /api/setup/alert-types
// Optional query param: ?category=emergency or ?category=general
// Any authenticated user can read (SubmitAlert needs this)
router.get('/alert-types', verifyToken, async (req, res, next) => {
  try {
    const { category } = req.query

    // Filter and sort in memory: an orderBy() drops documents that are missing
    // the field (older alert types have no createdAt), and pairing a where()
    // with an orderBy() would need a composite index.
    const snapshot = await getDb().collection('alertTypes').get()
    const alertTypes = snapshotToArray(snapshot)
      .filter(type => !category || type.category === category)
      .sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
        String(a.label || '').localeCompare(String(b.label || ''))
      )

    res.json({ alertTypes })
  } catch (err) {
    next(err)
  }
})

// POST /api/setup/alert-types — Company Admin only
router.post('/alert-types', verifyToken, requireCompanyAdmin, async (req, res, next) => {
  try {
    const { label, emoji, category } = req.body
    if (!label?.trim()) return res.status(400).json({ error: 'Label is required.' })
    if (!category) return res.status(400).json({ error: 'Category is required.' })
    if (!['emergency', 'general'].includes(category)) {
      return res.status(400).json({ error: 'Category must be emergency or general.' })
    }

    const db = getDb()

    const clash = await findAlertTypeWithSameName(db, label)
    if (clash) {
      return res.status(409).json({
        error: `An alert type called "${clash.data().label}" already exists.`,
      })
    }

    const now = new Date().toISOString()
    const value = alertTypeKey(label)

    const docRef = await db.collection('alertTypes').add({
      label: label.trim(),
      value,
      emoji: emoji?.trim() || '',
      category,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const doc = await docRef.get()
    res.status(201).json({ alertType: docToObject(doc) })
  } catch (err) {
    next(err)
  }
})

// PUT /api/setup/alert-types/:id — Company Admin only
router.put('/alert-types/:id', verifyToken, requireCompanyAdmin, async (req, res, next) => {
  try {
    const { label, emoji, category } = req.body
    if (!label?.trim()) return res.status(400).json({ error: 'Label is required.' })
    if (category && !['emergency', 'general'].includes(category)) {
      return res.status(400).json({ error: 'Category must be emergency or general.' })
    }

    const db = getDb()
    const ref = db.collection('alertTypes').doc(req.params.id)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: 'Alert type not found.' })

    const previousLabel = doc.data()?.label
    const nextLabel = label.trim()

    const clash = await findAlertTypeWithSameName(db, nextLabel, req.params.id)
    if (clash) {
      return res.status(409).json({
        error: `An alert type called "${clash.data().label}" already exists.`,
      })
    }

    const now = new Date().toISOString()

    const updateData = {
      label: nextLabel,
      emoji: emoji?.trim() || '',
      updatedAt: now,
    }

    // Only update category if provided
    if (category) updateData.category = category

    // Each school's recipient list is stored against the alert type's label,
    // so a rename has to move those lists across too. Without this the old
    // list stays behind under the old label, the renamed type has nobody
    // attached, and alerts of that type would reach nobody.
    //
    // The label and the lists are written in one batch, so a rename can never
    // half happen and leave some schools with a list nothing looks for.
    const renamed = previousLabel && previousLabel !== nextLabel

    const affectedRouting = renamed
      ? await db.collection('notificationRouting').where('alertType', '==', previousLabel).get()
      : { docs: [] }

    const batch = db.batch()
    batch.update(ref, updateData)

    for (const routingDoc of affectedRouting.docs) {
      batch.update(db.collection('notificationRouting').doc(routingDoc.id), {
        alertType: nextLabel,
        updatedAt: now,
      })
    }

    await batch.commit()

    const updated = await ref.get()
    res.json({ alertType: docToObject(updated), routingUpdated: affectedRouting.docs.length })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/setup/alert-types/:id — Company Admin only
router.delete('/alert-types/:id', verifyToken, requireCompanyAdmin, async (req, res, next) => {
  try {
    const ref = getDb().collection('alertTypes').doc(req.params.id)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: 'Alert type not found.' })

    await ref.delete()
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ── Locations ─────────────────────────────────────────────────────────────────


function normaliseLocationName(label) {
  return String(label || '').trim().toLowerCase()
}

async function findLocationWithSameName(db, label, exceptId = null) {
  const snapshot = await db.collection('locations').get()
  const wanted = normaliseLocationName(label)

  return snapshot.docs.find(
    doc =>
      doc.id !== exceptId &&
      normaliseLocationName(doc.data()?.label) === wanted
  ) || null
}
// GET /api/setup/locations
// Any authenticated user can read (SubmitAlert needs this)
router.get('/locations', verifyToken, async (req, res, next) => {
  try {
    const snapshot = await getDb()
      .collection('locations')
      .orderBy('createdAt', 'asc')
      .get()
    res.json({ locations: snapshotToArray(snapshot) })
  } catch (err) {
    next(err)
  }
})

// POST /api/setup/locations — Company Admin only
router.post('/locations', verifyToken, requireCompanyAdmin, async (req, res, next) => {
  try {
    const { label } = req.body
    if (!label?.trim()) return res.status(400).json({ error: 'Label is required.' })
  const db = getDb()
  const clash = await findLocationWithSameName(db, label)

  if (clash) {
    return res.status(409).json({
      error: 'This location already exists.',
    })
  }


    const now = new Date().toISOString()
    const docRef = await getDb().collection('locations').add({
      label: label.trim(),
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const doc = await docRef.get()
    res.status(201).json({ location: docToObject(doc) })
  } catch (err) {
    next(err)
  }
})

// PUT /api/setup/locations/:id — Company Admin only
router.put('/locations/:id', verifyToken, requireCompanyAdmin, async (req, res, next) => {
  try {
    const { label } = req.body
    if (!label?.trim()) return res.status(400).json({ error: 'Label is required.' })

    const ref = getDb().collection('locations').doc(req.params.id)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: 'Location not found.' })
  const clash = await findLocationWithSameName(
    getDb(),
    label,
    req.params.id
  )

  if (clash) {
    return res.status(409).json({
      error: 'This location already exists.',
  } )
  }


    await ref.update({
      label: label.trim(),
      updatedAt: new Date().toISOString(),
    })

    const updated = await ref.get()
    res.json({ location: docToObject(updated) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/setup/locations/:id — Company Admin only
router.delete('/locations/:id', verifyToken, requireCompanyAdmin, async (req, res, next) => {
  try {
    const ref = getDb().collection('locations').doc(req.params.id)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ error: 'Location not found.' })

    await ref.delete()
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ── Email Routing (School Admin) ──────────────────────────────────────────────

// GET /api/setup/routing — get all routing rules for this school
router.get('/routing', verifyToken, requireSchoolAdmin, async (req, res, next) => {
  try {
    const { schoolId } = req.profile
    const snapshot = await getDb()
      .collection('notificationRouting')
      .where('schoolId', '==', schoolId)
      .get()
    const routing = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    res.json({ routing })
  } catch (err) {
    next(err)
  }
})

// PUT /api/setup/routing/:alertType — upsert recipients for one alert type at this school
router.put('/routing/:alertType', verifyToken, requireSchoolAdmin, async (req, res, next) => {
  try {
    const { schoolId } = req.profile
    const alertType = decodeURIComponent(req.params.alertType)
    const { recipients } = req.body

    if (!Array.isArray(recipients)) {
      return res.status(400).json({ error: 'recipients must be an array.' })
    }

    for (const r of recipients) {
      if (!r.email?.trim() && !r.phone?.trim()) {
        return res.status(400).json({ error: 'Each recipient needs at least an email or phone.' })
      }
    }

    const now = new Date().toISOString()
    const db = getDb()

    const existing = await db.collection('notificationRouting')
      .where('schoolId', '==', schoolId)
      .where('alertType', '==', alertType)
      .limit(1)
      .get()

    const payload = {
      schoolId,
      alertType,
      alertScope: 'emergency',
      active: true,
      recipients: recipients.map(r => ({
        name: r.name?.trim() || r.email?.trim() || r.phone?.trim(),
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
        role: r.role || 'recipient',
        notify: r.notify || 'email',
      })),
      updatedAt: now,
    }

    let docId
    if (!existing.empty) {
      docId = existing.docs[0].id
      await db.collection('notificationRouting').doc(docId).update(payload)
    } else {
      payload.createdAt = now
      const ref = await db.collection('notificationRouting').add(payload)
      docId = ref.id
    }

    const updated = await db.collection('notificationRouting').doc(docId).get()
    res.json({ routing: { id: updated.id, ...updated.data() } })
  } catch (err) {
    next(err)
  }
})

// GET /api/setup/school-users — get all users belonging to the school admin's school
router.get('/school-users', verifyToken, requireSchoolAdmin, async (req, res, next) => {
  try {
    const { schoolId, uid } = req.profile
    const snapshot = await getDb()
      .collection('users')
      .where('schoolId', '==', schoolId)
      .get()

    const users = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(u => u.id !== uid)
      .map(u => ({
        id: u.id,
        name: u.name || '',
        email: u.email || null,
        phone: u.phone || null,
        role: u.role || '',
      }))

    res.json({ users })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/setup/school-users/:uid — update contact details for a user in the school admin's school
router.patch('/school-users/:uid', verifyToken, requireSchoolAdmin, async (req, res, next) => {
  try {
    const { schoolId } = req.profile
    const { uid } = req.params
    const { phone, email } = req.body

    const userDoc = await getDb().collection('users').doc(uid).get()
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' })
    }
    if (userDoc.data().schoolId !== schoolId) {
      return res.status(403).json({ error: 'You can only edit users in your own school.' })
    }

    const changes = { updatedAt: new Date().toISOString() }
    if (phone !== undefined) changes.phone = phone?.trim() || null
    if (email !== undefined) changes.email = email.trim()

    await getDb().collection('users').doc(uid).update(changes)

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

module.exports = router
module.exports.normaliseRole = normaliseRole
