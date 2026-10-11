import { useState } from 'react'
import { incidentAPI } from '../api/client'
import { DELETION_REASONS } from './incidentDeletion'

/**
 * Confirmation dialog for deleting an incident. Shared by the incident list
 * and the incident detail page so there is one delete flow, not two.
 *
 * `onDeleted` receives the deleted incident id once the backend confirms.
 */
export default function DeleteIncidentDialog({ incident, onCancel, onDeleted }) {
  const [reasonCode, setReasonCode] = useState('')
  const [detail, setDetail] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState('')

  // The incident list payload carries acknowledgedBy but not notifications, so
  // each count is reported only when it is actually known.
  const acknowledgedCount = Array.isArray(incident.acknowledgedBy) ? incident.acknowledgedBy.length : 0
  const notifiedCount = Array.isArray(incident.notifications) ? incident.notifications.length : 0

  const confirmable = Boolean(reasonCode) && (reasonCode !== 'other' || detail.trim().length > 0)

  const incidentLabel = `${incident.type} · ${incident.incidentNumber || incident.id}`

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      await incidentAPI.remove(incident.id, { reasonCode, reason: detail })
      setDeleted(true)
      setDeleting(false)
    } catch (err) {
      setError(err.message || 'Failed to delete this incident. Please try again.')
      setDeleting(false)
    }
  }

  if (deleted) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-incident-title"
      >
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
          <h2
            id="delete-incident-title"
            className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2"
          >
            <span aria-hidden="true">✅</span> Incident deleted
          </h2>

          <p className="text-sm text-gray-600" aria-live="polite">
            <span className="font-medium text-gray-900">{incidentLabel}</span> has been removed from
            the incident log, dashboard counts and analytics. A copy has been kept for audit.
          </p>

          <div className="flex justify-end mt-5">
            <button
              type="button"
              autoFocus
              onClick={() => onDeleted(incident.id)}
              className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-incident-title"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 id="delete-incident-title" className="text-lg font-semibold text-gray-900 mb-3">
          Delete this incident?
        </h2>

        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-3">
          <p className="text-sm font-medium text-gray-900">{incidentLabel}</p>
          <p className="text-xs text-gray-500 mt-0.5">{incident.schoolName || 'Unknown school'}</p>
        </div>

        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          This action cannot be undone. The incident will be removed from the incident log,
          dashboard counts and analytics.
        </p>

        {acknowledgedCount > 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            {acknowledgedCount} {acknowledgedCount === 1 ? 'person has' : 'people have'} already
            acknowledged this alert. Deleting removes that response record from the log.
          </p>
        ) : notifiedCount > 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            {notifiedCount} {notifiedCount === 1 ? 'person was' : 'people were'} notified about this
            alert. Deleting removes that record from the log.
          </p>
        ) : null}

        <label htmlFor="delete-reason-code" className="block text-xs font-medium text-gray-600 mb-1">
          Reason for deleting <span className="text-red-500">*</span>
        </label>
        <select
          id="delete-reason-code"
          value={reasonCode}
          onChange={event => setReasonCode(event.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          <option value="">Select a reason</option>
          {DELETION_REASONS.map(reason => (
            <option key={reason.code} value={reason.code}>{reason.label}</option>
          ))}
        </select>

        <label htmlFor="delete-reason-detail" className="block text-xs font-medium text-gray-600 mb-1">
          Detail{' '}
          {reasonCode === 'other'
            ? <span className="text-red-500">*</span>
            : <span className="text-gray-400">(optional)</span>}
        </label>
        <textarea
          id="delete-reason-detail"
          rows={2}
          maxLength={500}
          value={detail}
          onChange={event => setDetail(event.target.value)}
          placeholder="Anything that should sit with the audit record"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
        />

        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || !confirmable}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleting ? 'Deleting...' : 'Delete Incident'}
          </button>
        </div>
      </div>
    </div>
  )
}
