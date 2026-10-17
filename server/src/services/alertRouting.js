// One place that answers "which recipient list applies to this alert type".
//
// The preview and the real send used to work this out separately, and they
// compared the alert type name in different ways. The preview ignored capital
// letters while the send needed an exact match, so the preview could list
// people the send would never reach. Both now call in here, so they cannot
// drift apart again.

// Alert type names are compared in one normalised form, so "Fire", "fire" and
// "Fire " all match the same saved list.
function alertTypeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

/**
 * Finds the recipient list a school has saved for an alert type.
 *
 * `alertTypeName` can be the type's label or its slug. Both normalise to the
 * same key, so either works.
 *
 * A list with no `active` field counts as active. Older lists were saved
 * without it, and treating them as switched off would silently drop their
 * recipients.
 *
 * Returns the saved list, or null when the school has none for that type.
 */
async function findSchoolRoutingRule(db, schoolId, alertTypeName) {
  if (!schoolId || !alertTypeName) return null

  const wanted = alertTypeKey(alertTypeName)

  const snapshot = await db
    .collection('notificationRouting')
    .where('schoolId', '==', schoolId)
    .get()

  return (
    snapshot.docs
      .map(doc => doc.data())
      .find(rule => rule.active !== false && alertTypeKey(rule.alertType) === wanted) || null
  )
}

module.exports = { alertTypeKey, findSchoolRoutingRule }
