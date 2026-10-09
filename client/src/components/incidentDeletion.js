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

export const DELETE_INELIGIBLE_MESSAGE =
  'This incident has a response underway. It can be deleted once it is resolved, or once it is overdue with nobody having acknowledged it.'

// Matches DEFAULT_OVERDUE_THRESHOLD_MINUTES on the server.
const DEFAULT_OVERDUE_THRESHOLD_MINUTES = 15

function elapsedMinutes(incident) {
  const raw = incident.createdAt
  if (!raw) return 0

  const created = new Date(raw)
  if (Number.isNaN(created.getTime())) return 0

  return Math.floor((Date.now() - created.getTime()) / 60000)
}

// What may be deleted, and why:
//   - a drill, which carries no genuine record value;
//   - a resolved incident, whose response has finished;
//   - an abandoned one: still triggered, nobody acknowledged it, and already
//     past the overdue threshold the UI flags it with. Nothing is responding
//     to it, so no response record is destroyed.
//
// Everything else is a live response and stays protected, including an alert
// that only just fired and may still be going out.
//
// The backend enforces the same rule; this only keeps the UI honest, so the
// threshold must be the effective per-school one the pages already load.
export function canDeleteIncident(incident, overdueThresholdMinutes = DEFAULT_OVERDUE_THRESHOLD_MINUTES) {
  if (!incident) return false
  if (incident.isTest) return true
  if (incident.status === 'resolved') return true

  if (incident.status !== 'triggered') return false
  if (Array.isArray(incident.acknowledgedBy) && incident.acknowledgedBy.length > 0) return false

  return elapsedMinutes(incident) > overdueThresholdMinutes
}
