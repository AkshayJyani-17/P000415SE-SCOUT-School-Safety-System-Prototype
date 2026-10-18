import { Trash2 } from 'lucide-react'
import { canRoleDeleteIncident } from './incidentDeletion'

/**
 * Row-level delete icon for an incident in a list.
 *
 * Renders nothing unless this viewer's role lets them delete this particular
 * incident, which keeps lists free of a column of disabled icons.
 *
 * The viewer prop carries the role flags plus uid and email, because a
 * School Admin may only delete test alerts they raised themselves.
 *
 * How recent the alert is does not decide whether the icon appears. The
 * dialog warns about that instead, so this icon can no longer offer a delete
 * the server refuses.
 *
 * List rows open the incident when clicked, so the press is stopped from
 * bubbling up to the row.
 */
export default function DeleteIncidentButton({ incident, viewer, onRequestDelete }) {
  if (!canRoleDeleteIncident(incident, viewer)) return null

  return (
    <button
      type="button"
      aria-label={`Delete ${incident.incidentNumber || incident.title}`}
      title="Delete this incident"
      onClick={event => {
        event.stopPropagation()
        onRequestDelete(incident)
      }}
      className="p-1.5 rounded-lg text-gray-400 transition-colors hover:text-red-600 hover:bg-red-50"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}
