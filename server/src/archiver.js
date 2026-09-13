const { getDb } = require('./db/firebase')
const { invalidateIncidentListCache } = require('./incidentListCache')
const { invalidateAnalyticsCache } = require('./analyticsCache')

const SETTINGS_DOC = 'settings/global'
const DEFAULT_RETENTION_DAYS = 30

/**
 * Moves resolved incidents older than the configured retention period
 * into the archivedIncidents collection.
 *
 * @returns {{ archived: number }} count of incidents moved
 */
async function runArchiveJob() {
  const db = getDb()

  // Read retention setting
  const settingsDoc = await db.doc(SETTINGS_DOC).get()
  const retentionDays = settingsDoc.exists
    ? (settingsDoc.data()?.archiveRetentionDays ?? DEFAULT_RETENTION_DAYS)
    : DEFAULT_RETENTION_DAYS

  // Cutoff: anything resolved before this moment is eligible
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffIso = cutoff.toISOString()

  // Query resolved incidents updated before the cutoff
  const snapshot = await db.collection('incidents')
    .where('status', '==', 'resolved')
    .get()

  const eligible = snapshot.docs.filter(doc => {
    const data = doc.data()
    const updatedAt = data.updatedAt
    if (!updatedAt) return false
    // updatedAt may be a Firestore Timestamp or an ISO string
    const updatedAtDate = updatedAt.toDate ? updatedAt.toDate() : new Date(updatedAt)
    return updatedAtDate < cutoff
  })

  if (eligible.length === 0) {
    console.log(`[archiver] No incidents eligible for archiving (retention: ${retentionDays} days)`)
    return { archived: 0 }
  }

  const archivedAt = new Date().toISOString()
  const batch = db.batch()

  for (const doc of eligible) {
    const archiveRef = db.collection('archivedIncidents').doc(doc.id)
    batch.set(archiveRef, { ...doc.data(), archivedAt })
    batch.delete(db.collection('incidents').doc(doc.id))
  }

  await batch.commit()
  invalidateIncidentListCache()
  invalidateAnalyticsCache()

  console.log(`[archiver] Archived ${eligible.length} incident(s) (retention: ${retentionDays} days, cutoff: ${cutoffIso})`)
  return { archived: eligible.length }
}

module.exports = { runArchiveJob }
