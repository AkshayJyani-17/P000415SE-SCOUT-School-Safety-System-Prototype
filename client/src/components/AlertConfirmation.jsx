import { Link } from 'react-router-dom'

// Counts how many recipients the backend actually reached. The notification
// response carries a per-recipient result, so partial delivery is visible
// rather than being flattened into a single success flag.
function summariseDelivery(delivery) {
  if (!delivery) return null

  const results = Array.isArray(delivery.results) ? delivery.results : []
  const sent = results.filter(
    result => result.emailStatus === 'sent' || result.smsStatus === 'sent'
  ).length

  return { sent, total: results.length }
}

function formatTime(value) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Confirmation shown after an alert is submitted. Shared by the Submit Alert
 * form, the dashboard quick alerts and the quick test alerts, so every path
 * reports the outcome the same way.
 *
 * It only claims an alert was delivered when `delivery` is supplied, which is
 * the response from POST /notifications/emergency. Paths that record an alert
 * without attempting to notify anyone pass nothing, and the wording says the
 * alert was logged instead.
 *
 * `recipientsConfigured` is the count routing resolved for the alert type, used
 * where no delivery was attempted so the user still knows who it routes to.
 * Pass null when the count is not known.
 *
 * `note` adds a line specific to the path, such as flagging a drill.
 *
 * Stays on screen until dismissed. A safety confirmation that disappears on a
 * timer can be missed, which is the problem this exists to solve.
 */
export default function AlertConfirmation({
  incident,
  delivery = null,
  recipientsConfigured = null,
  note = null,
  onDismiss,
  dismissLabel = 'Done',
}) {
  if (!incident) return null

  const summary = summariseDelivery(delivery)
  const attempted = summary !== null && summary.total > 0

  // Three outcomes: nothing was sent because nothing was tried, everything
  // arrived, or some or all of it failed.
  const failed = attempted && summary.sent === 0
  const partial = attempted && summary.sent > 0 && summary.sent < summary.total

  const heading = !attempted
    ? 'Alert logged'
    : failed
      ? 'Alert logged, but not delivered'
      : partial
        ? 'Alert sent to some recipients'
        : 'Alert sent'

  const warn = failed || partial
  const reference = incident.incidentNumber || incident.id
  const submittedAt = formatTime(incident.createdAt) || formatTime(delivery?.timestamp)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alert-confirmation-title"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="text-center">
          <div className="text-4xl mb-3" aria-hidden="true">{warn ? '⚠️' : '✅'}</div>
          <h2
            id="alert-confirmation-title"
            className={`text-lg font-semibold mb-1 ${warn ? 'text-amber-900' : 'text-gray-900'}`}
          >
            {heading}
          </h2>
        </div>

        <dl className="mt-4 bg-gray-50 border border-gray-200 rounded-lg divide-y divide-gray-200 text-sm">
          <div className="flex justify-between gap-3 px-4 py-2">
            <dt className="text-gray-500">Alert ID</dt>
            <dd className="font-medium text-gray-900">{reference}</dd>
          </div>
          {submittedAt && (
            <div className="flex justify-between gap-3 px-4 py-2">
              <dt className="text-gray-500">Submitted</dt>
              <dd className="font-medium text-gray-900">{submittedAt}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 px-4 py-2">
            <dt className="text-gray-500">Recipients</dt>
            <dd className="font-medium text-gray-900 text-right">
              {attempted
                ? `${summary.sent} of ${summary.total} notified`
                : recipientsConfigured === null
                  ? 'Not notified'
                  : `${recipientsConfigured} configured`}
            </dd>
          </div>
        </dl>

        <p
          aria-live="polite"
          className={`mt-3 text-xs rounded-lg px-3 py-2 ${
            warn
              ? 'text-amber-800 bg-amber-50 border border-amber-200'
              : 'text-gray-600 bg-gray-50 border border-gray-200'
          }`}
        >
          {attempted
            ? failed
              ? 'The alert is recorded in the incident log, but nobody could be reached. Follow up another way and tell a Company Admin.'
              : partial
                ? 'The alert is recorded in the incident log. Some recipients could not be reached, so check that the right people know.'
                : 'Recipients have been notified and the alert is recorded in the incident log.'
            : recipientsConfigured === 0
              ? 'The alert is recorded in the incident log. No recipients are configured for this alert type, so nobody has been contacted.'
              : 'The alert is recorded in the incident log. Nobody has been contacted automatically.'}
        </p>

        {note && <p className="mt-2 text-xs text-gray-500">{note}</p>}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors"
          >
            {dismissLabel}
          </button>
          {incident.id && (
            <Link
              to={`/incidents/${incident.id}`}
              className="flex-1 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors text-center"
            >
              View alert details
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
