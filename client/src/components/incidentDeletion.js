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
  'Only test alerts and resolved incidents can be deleted. Resolve this incident first.'

// Only drills and incidents whose response has finished may be deleted, so a
// live emergency is never pulled out from under the people responding to it.
// The backend enforces the same rule; this only keeps the UI honest.
export function canDeleteIncident(incident) {
  return Boolean(incident?.isTest) || incident?.status === 'resolved'
}
