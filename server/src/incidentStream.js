const { snapshotToArray } = require('./db/firebase')

// Mirror the list endpoint's scope; never subscribe staff to the whole collection.
function watchIncidents(db, profile, onData, onError) {
  const collection = db.collection('incidents')
  const role = String(profile.role || '').toLowerCase().replace(/[-_\s]/g, '')
  const queries = role === 'companyadmin' ? [collection]
    : role === 'schooladmin' ? (profile.schoolId ? [collection.where('schoolId', '==', profile.schoolId)] : [])
      : [
          collection.where('triggeredById', '==', profile.uid),
          collection.where('assignedUserIds', 'array-contains', profile.uid),
          ...(profile.email ? [collection.where('assignedUserEmails', 'array-contains', profile.email)] : []),
        ]
  const snapshots = new Map()
  const unsubscribers = []
  if (!queries.length) onData([])
  try {
    queries.forEach((query, index) => {
      unsubscribers.push(query.onSnapshot(snapshot => {
        snapshots.set(index, snapshotToArray(snapshot))
        if (snapshots.size !== queries.length) return
        const incidents = new Map()
        snapshots.forEach(records => records.forEach(record => incidents.set(record.id, record)))
        onData([...incidents.values()])
      }, onError))
    })
  } catch (error) {
    unsubscribers.forEach(unsubscribe => unsubscribe())
    throw error
  }
  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}

module.exports = { watchIncidents }
