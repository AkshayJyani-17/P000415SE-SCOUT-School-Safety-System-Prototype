import { Trash2 } from 'lucide-react'
import { canDeleteIncident } from './incidentDeletion'

/**
 * Row-level delete icon for an incident in a list.
 *
 * Renders nothing unless the viewer is an admin and the incident is actually
 * deletable, which keeps the common "active incidents" views free of a column
 * of disabled icons. The incident detail page explains the rule for anyone
 * looking for the action.
 *
 * List rows open the incident when clicked, so the press is stopped from
 * bubbling up to the row.
 */
export default function DeleteIncidentButton({ incident, isAdmin, onRequestDelete }) {
  if (!isAdmin || !canDeleteIncident(incident)) return null

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
