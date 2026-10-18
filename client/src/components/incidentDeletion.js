// Shared rules for the incident delete flow, kept out of the dialog component
// so the list page can import them without pulling in a component module.

// Reason codes mirror DELETION_REASON_CODES in server/src/routes/incidents.js.
// A fixed list keeps the audit trail analysable instead of a free-text dump.
export const DELETION_REASONS = [
  { code: 'duplicate', label: 'Duplicate of another incident' },
  { code: 'test_or_drill', label: 'Test alert or drill' },
  { code: 'logged_in_error', label: 'Logged in error' },
  { code: 'wrong_school', label: 'Logged against the wrong school' },
  { code: 'other', label: 'Other (please describe)' },
]

export const RESPONSE_UNDERWAY_CONFIRMATION =
  'I understand staff may still be responding'

// Narrows the auth context down to just what the delete rule needs.
export function deleteViewerFrom(auth = {}) {
  return {
    isCompanyAdmin: Boolean(auth.isCompanyAdmin),
    isSchoolAdmin: Boolean(auth.isSchoolAdmin),
    uid: auth.currentUser?.uid || null,
    email: auth.currentUser?.email || null,
  }
}

function isOwnIncident(incident, viewer) {
  if (viewer.uid && incident.triggeredById) {
    return incident.triggeredById === viewer.uid
  }

  if (viewer.email && incident.triggeredByEmail) {
    return String(incident.triggeredByEmail).toLowerCase() === String(viewer.email).toLowerCase()
  }

  return false
}

// Who may delete a record:
//   Company Admin: anything, at any school.
//   School Admin: only test alerts they raised themselves, so a school
//     cannot quietly erase genuine incident records of its own. School
//     Admins run the drills, so they can still clear up after themselves.
// The backend enforces the same rule; this only keeps the UI honest.
//
// There is deliberately no check on how old the incident is. That check used
// to live here and on the server, reading different settings, so this file
// could offer a delete the server then refused. How recent the alert is now
// only produces a warning, see buildResponseWarning below.
export function canRoleDeleteIncident(incident, viewer = {}) {
  if (!incident) return false
  if (viewer.isCompanyAdmin) return true
  if (!viewer.isSchoolAdmin) return false

  return Boolean(incident.isTest) && isOwnIncident(incident, viewer)
}

// The sentence shown in the delete dialog when staff at the incident's own
// school may still be working on the alert, or null when there is nothing to
// warn about.
//
// Every judgement here comes from responseWindow, which the server sends with
// the incident. Nothing is recalculated, because doing the same sum in two
// places using two different settings is what caused this bug.
export function buildResponseWarning(incident) {
  const window = incident?.responseWindow

  if (!window || !window.responseMayBeUnderway) return null

  const school = incident.schoolName || 'This school'
  const minutes = Number(window.windowMinutes)
  const age = Number(window.ageMinutes)

  if (!Number.isFinite(minutes) || !Number.isFinite(age)) return null

  const ageText = age < 1
    ? 'less than a minute old'
    : `${age} ${age === 1 ? 'minute' : 'minutes'} old`

  return `${school} allows ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} to respond` +
    ` and this alert is ${ageText}. Staff there may still be working on it.`
}
