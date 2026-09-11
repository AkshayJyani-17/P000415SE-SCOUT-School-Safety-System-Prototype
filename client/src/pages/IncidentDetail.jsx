import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getIncidentById, incidentAPI, settingsAPI } from '../api/client'
import { useAuth } from '../context/AuthContext'

const progressSteps = [
  { key: 'triggered', label: 'Unacknowledged' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
]

const statusStepIndex = {
  triggered: 0,
  acknowledged: 1,
  'in-progress': 2,
  resolved: 3,
  archived: 3,
}

function normalizeUsers(list) {
  if (!Array.isArray(list)) return []

  return [...new Set(list
    .map(item => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''

      return (
        item.name ||
        item.displayName ||
        item.userName ||
        item.fullName ||
        item.acknowledgedByName ||
        item.inProgressByName ||
        ''
      ).trim()
    })
    .filter(Boolean))]
}

function extractUsersFromHistory(history, statuses) {
  if (!Array.isArray(history)) return []

  return [...new Set(history
    .filter(entry => statuses.includes(entry?.status || entry?.toStatus || entry?.newStatus))
    .map(entry => (
      entry?.userName ||
      entry?.actorName ||
      entry?.updatedByName ||
      entry?.displayName ||
      entry?.name ||
      ''
    ).trim())
    .filter(Boolean))]
}

const priorityColors = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
}

const statusColors = {
  triggered: 'bg-red-100 text-red-700',
  acknowledged: 'bg-blue-100 text-blue-700',
  'in-progress': 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
}

const typeIcons = {
  medical: '🏥',
  behaviour: '⚠️',
  fire: '🔥',
  lockdown: '🔒',
  weather: '🌩️',
  maintenance: '🔧',
  general: '📢',
}

const nextStatus = {
  triggered: 'acknowledged',
  acknowledged: 'in-progress',
  'in-progress': 'resolved',
}

const nextLabel = {
  triggered: 'Acknowledge',
  acknowledged: 'Mark In Progress',
  'in-progress': 'Mark Resolved',
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  const dayLabel = days === 1 ? 'day' : 'days'

  return remainingHours > 0 ? `${days} ${dayLabel} ${remainingHours} hr` : `${days} ${dayLabel}`
}

export default function IncidentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUser, userRole, isAdmin, isSchoolAdmin, authLoading } = useAuth()
  const [incident, setIncident] = useState(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [showProgressDetails, setShowProgressDetails] = useState(false)
  const [acknowledgedUsers, setAcknowledgedUsers] = useState([])
  const [inProgressUsers, setInProgressUsers] = useState([])

  // New — track who acknowledged
  const [acknowledgedBy, setAcknowledgedBy] = useState([])
  const [refreshingStatus, setRefreshingStatus] = useState(false)
  const [refreshError, setRefreshError] = useState('')

  // Overdue threshold
  const [overdueThresholdMinutes, setOverdueThresholdMinutes] = useState(15)

  // Review flag state
  const [showFlagForm, setShowFlagForm] = useState(false)
  const [flagComment, setFlagComment] = useState('')
  const [flagging, setFlagging] = useState(false)
  const [flagError, setFlagError] = useState('')
  const [reviewCommentText, setReviewCommentText] = useState('')
  const [addingReviewComment, setAddingReviewComment] = useState(false)
  const [reviewCommentError, setReviewCommentError] = useState('')

  // Shared helper — apply a fresh record from the API to all state
  function applyRecord(record) {
    setIncident(record)
    setStatus(record?.status || '')
    setAcknowledgedBy(record?.acknowledgedBy || [])

    const acknowledged = normalizeUsers([
      ...(record?.acknowledgedUsers || []),
      ...(record?.acknowledgedBy || []),
      ...(record?.ackUsers || []),
      ...(record?.acknowledgements || []),
    ])
    const acknowledgedFromHistory = extractUsersFromHistory(record?.statusHistory, ['acknowledged'])

    const inProgress = normalizeUsers([
      ...(record?.inProgressUsers || []),
      ...(record?.inProgressBy || []),
      ...(record?.workingUsers || []),
      ...(record?.responders || []),
    ])
    const inProgressFromHistory = extractUsersFromHistory(record?.statusHistory, ['in-progress', 'in_progress'])

    setAcknowledgedUsers([...new Set([...acknowledged, ...acknowledgedFromHistory])])
    setInProgressUsers([...new Set([...inProgress, ...inProgressFromHistory])])
  }

  useEffect(() => {
    if (authLoading || userRole === null) return

    let isActive = true

    async function loadIncident() {
      setLoading(true)
      setError('')

      try {
        const [record, settings] = await Promise.all([
          getIncidentById(id),
          settingsAPI.get().catch(() => ({ overdueThresholdMinutes: 15 })),
        ])
        if (isActive) {
          applyRecord(record)
          setOverdueThresholdMinutes(settings.overdueThresholdMinutes ?? 15)
        }
      } catch (err) {
        if (isActive) {
          setError(err.message || 'Failed to load incident.')
        }
      } finally {
        if (isActive) {
          setLoading(false)
        }
      }
    }

    loadIncident()
    return () => { isActive = false }
  }, [authLoading, id, userRole])

  const refreshIncidentStatus = async () => {
    if (!id || refreshingStatus) return

    setRefreshingStatus(true)
    setRefreshError('')

    try {
      const record = await getIncidentById(id)
      applyRecord(record)
    } catch (err) {
      setRefreshError(err.message || 'Failed to refresh incident status.')
    } finally {
      setRefreshingStatus(false)
    }
  }

  const handleFlagSubmit = async () => {
    if (!flagComment.trim()) {
      setFlagError('Please add a comment before flagging.')
      return
    }
    setFlagging(true)
    setFlagError('')
    try {
      const result = await incidentAPI.setReviewFlag(incident.id, true, flagComment.trim())
      applyRecord(result.incident)
      setShowFlagForm(false)
      setFlagComment('')
    } catch (err) {
      setFlagError(err.message || 'Failed to flag for review.')
    } finally {
      setFlagging(false)
    }
  }

  const handleCloseReview = async () => {
    setFlagError('')
    try {
      const result = await incidentAPI.setReviewFlag(incident.id, false, '')
      applyRecord(result.incident)
    } catch (err) {
      setFlagError(err.message || 'Failed to close review.')
    }
  }

  const handleAddReviewComment = async () => {
    if (!reviewCommentText.trim()) {
      setReviewCommentError('Comment cannot be empty.')
      return
    }
    setAddingReviewComment(true)
    setReviewCommentError('')
    try {
      const result = await incidentAPI.addReviewComment(incident.id, reviewCommentText.trim())
      applyRecord(result.incident)
      setReviewCommentText('')
    } catch (err) {
      setReviewCommentError(err.message || 'Failed to add comment.')
    } finally {
      setAddingReviewComment(false)
    }
  }

  const found = incident

  if (authLoading || userRole === null || loading) {
    return <div className="p-6 text-center text-gray-500">Loading incident...</div>
  }

  if (error) {
    return (
      <div className="p-6 text-center text-gray-500">
        {error}{' '}
        <button onClick={() => navigate('/incidents')} className="text-blue-600 hover:underline">
          Go back
        </button>
      </div>
    )
  }

  if (!found) {
    return (
      <div className="p-6 text-center text-gray-500">
        Incident not found.{' '}
        <button onClick={() => navigate('/incidents')} className="text-blue-600 hover:underline">
          Go back
        </button>
      </div>
    )
  }

  const currentStepIndex = statusStepIndex[status] ?? 0

  // Compute whether this incident is overdue (triggered and past threshold)
  const overdueElapsedMinutes = (() => {
    if (status !== 'triggered' || !found?.createdAt) return 0
    const created = new Date(found.createdAt)
    if (Number.isNaN(created.getTime())) return 0
    return Math.floor((Date.now() - created.getTime()) / 60000)
  })()
  const isOverdue = overdueElapsedMinutes > overdueThresholdMinutes

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* Back */}
      <button
        onClick={() => navigate('/incidents')}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
      >
        ← Back to Incidents
      </button>

      {/* Overdue warning banner */}
      {isOverdue && (
        <div className="bg-amber-50 border border-amber-400 rounded-xl px-5 py-4 mb-4 flex items-start gap-3">
          <span className="text-2xl">⏰</span>
          <div>
            <p className="font-semibold text-amber-800">Alert overdue — no acknowledgement received</p>
            <p className="text-sm text-amber-700 mt-0.5">
              This alert has been unacknowledged for{' '}
              <strong>{formatDuration(overdueElapsedMinutes)}</strong>, exceeding the{' '}
              {formatDuration(overdueThresholdMinutes)} threshold. Please review and respond immediately.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-medium text-gray-800">Acknowledgement status</p>
          <p className="text-xs text-gray-500">Refresh only when you need the latest response update.</p>
          {refreshError && <p className="text-xs text-red-500 mt-1">{refreshError}</p>}
        </div>
        <button
          type="button"
          onClick={refreshIncidentStatus}
          disabled={refreshingStatus}
          className="px-3 py-2 bg-white border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {refreshingStatus ? 'Refreshing...' : 'Refresh Status'}
        </button>
      </div>

      {/* Review Required banner */}
      {found.reviewRequired && (
        <div className="bg-red-50 border border-red-400 rounded-xl px-5 py-4 mb-4 flex items-start gap-3">
          <span className="text-2xl">🚩</span>
          <div className="flex-1">
            <p className="font-semibold text-red-800">Review Required</p>
            <p className="text-sm text-red-700 mt-0.5">
              This resolved incident has been flagged for follow-up. See the Review section below.
            </p>
          </div>
        </div>
      )}

      {/* Help is on the way banner */}
      {acknowledgedBy.length > 0 && (
        <div className="bg-green-50 border border-green-300 rounded-xl px-5 py-4 mb-4 flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-semibold text-green-800">Help is on the way!</p>
            <p className="text-sm text-green-600 mt-0.5">
              {acknowledgedBy.length} person{acknowledgedBy.length > 1 ? 's have' : ' has'} acknowledged this alert and are responding.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{typeIcons[found.type]}</span>
            <h1 className="text-xl font-bold text-gray-900">
              {found.incidentNumber ? `${found.incidentNumber} · ` : ''}{found.title}
            </h1>
          </div>
          <div className="flex gap-2 shrink-0">
            <span className={`text-xs px-2 py-1 rounded ${priorityColors[found.priority]}`}>
              {found.priority}
            </span>
            <span className={`text-xs px-2 py-1 rounded ${statusColors[status] || statusColors.archived}`}>
              {status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-400">Location</p>
            <p className="text-gray-800">📍 {found.location}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Time</p>
            <p className="text-gray-800">🕐 {found.timestamp}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Reported by</p>
            <p className="text-gray-800">👤 {found.triggeredByName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Type</p>
            <p className="text-gray-800 capitalize">{found.type}</p>
          </div>
        </div>
      </div>

      {/* Ticket Progress */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Ticket Progress</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {progressSteps.map((step, idx) => {
            const isCompleted = idx <= currentStepIndex
            const isCurrent = idx === currentStepIndex

            return (
              <div
                key={step.key}
                className={`rounded-lg border px-3 py-2 ${
                  isCurrent
                    ? 'border-red-300 bg-red-50'
                    : isCompleted
                      ? 'border-green-200 bg-green-50'
                      : 'border-gray-200 bg-gray-50'
                }`}
              >
                <p
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    isCurrent
                      ? 'text-red-700'
                      : isCompleted
                        ? 'text-green-700'
                        : 'text-gray-500'
                  }`}
                >
                  Step {idx + 1}
                </p>
                <p
                  className={`text-sm mt-1 ${
                    isCurrent
                      ? 'text-red-700'
                      : isCompleted
                        ? 'text-green-700'
                        : 'text-gray-500'
                  }`}
                >
                  {step.label}
                </p>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowProgressDetails(prev => !prev)}
          className="mt-4 text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          {showProgressDetails ? 'Hide details' : 'More details'}
        </button>

        {showProgressDetails && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Acknowledged by</p>
              {acknowledgedUsers.length > 0 ? (
                <ul className="space-y-1">
                  {acknowledgedUsers.map(name => (
                    <li key={name} className="text-sm text-gray-800">• {name}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No users have acknowledged this ticket yet.</p>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">In progress by</p>
              {inProgressUsers.length > 0 ? (
                <ul className="space-y-1">
                  {inProgressUsers.map(name => (
                    <li key={name} className="text-sm text-gray-800">• {name}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No users are currently marked in-progress.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-2">Description</h2>
        <p className="text-sm text-gray-600">
          {found.description || 'No additional description provided for this incident.'}
        </p>
      </div>

      {/* Acknowledged By — only shown if someone has responded */}
      {acknowledgedBy.length > 0 && (
        <div className="bg-white border border-green-200 rounded-xl p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">Acknowledged By</h2>
          <div className="space-y-2">
            {acknowledgedBy.map((ack, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-green-500">✅</span>
                  <div>
                    <p className="text-gray-800 font-medium">{ack.name}</p>
                    <p className="text-xs text-gray-400">{ack.role} · {ack.email}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  {new Date(ack.acknowledgedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-up Review section */}
      {/* Flag for Review — School Admin only, resolved incident, not yet flagged */}
      {isSchoolAdmin && status === 'resolved' && !found.reviewRequired && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Follow-up Review</h2>
              <p className="text-sm text-gray-500 mt-0.5">Flag this resolved incident if further review is needed.</p>
            </div>
            {!showFlagForm && (
              <button
                type="button"
                onClick={() => setShowFlagForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-700 text-sm rounded-lg hover:bg-red-50 transition-colors"
              >
                🚩 Flag for Review
              </button>
            )}
          </div>
          {showFlagForm && (
            <div className="mt-4">
              <textarea
                rows={3}
                value={flagComment}
                onChange={e => setFlagComment(e.target.value)}
                placeholder="Describe what needs to be reviewed…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
              {flagError && <p className="text-sm text-red-500 mt-1">{flagError}</p>}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleFlagSubmit}
                  disabled={flagging}
                  className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {flagging ? 'Flagging…' : '🚩 Confirm Flag'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowFlagForm(false); setFlagComment(''); setFlagError('') }}
                  className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Review Required thread — shown when flagged */}
      {found.reviewRequired && (
        <div className="bg-white border border-red-200 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              🚩 Review Thread
            </h2>
            {isSchoolAdmin && (
              <button
                type="button"
                onClick={handleCloseReview}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-green-400 text-green-700 text-sm rounded-lg hover:bg-green-50 transition-colors"
              >
                ✅ Close Review
              </button>
            )}
          </div>

          {/* Comments */}
          <div className="space-y-3 mb-4">
            {(found.reviewComments || []).length === 0 ? (
              <p className="text-sm text-gray-400">No comments yet.</p>
            ) : (
              (found.reviewComments || []).map((c, idx) => (
                <div key={idx} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-gray-800">{c.name}</span>
                    <span className="text-xs text-gray-400">
                      {c.createdAt ? new Date(c.createdAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-1">{c.role}</p>
                  <p className="text-sm text-gray-700">{c.comment}</p>
                </div>
              ))
            )}
          </div>

          {/* Add comment — any admin */}
          {isAdmin && (
            <div>
              <textarea
                rows={2}
                value={reviewCommentText}
                onChange={e => setReviewCommentText(e.target.value)}
                placeholder="Add a response or note…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
              {reviewCommentError && (
                <p className="text-sm text-red-500 mt-1">{reviewCommentError}</p>
              )}
              <button
                type="button"
                onClick={handleAddReviewComment}
                disabled={addingReviewComment}
                className="mt-2 px-4 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900 disabled:opacity-50 transition-colors"
              >
                {addingReviewComment ? 'Adding…' : 'Add Comment'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Notification Status */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-3">Notification Delivery</h2>
        {found.notifications && found.notifications.length > 0 ? (
          <div className="space-y-2">
            {found.notifications.map((n, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{n.recipientName}</span>
                <div className="flex gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${n.sms === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    SMS {n.sms}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${n.email === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    Email {n.email}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No notification records found.</p>
        )}
      </div>

      {/* Action Button — admin only */}
      {isAdmin ? (
        nextStatus[status] && (
          <>
            {statusError && (
              <p className="text-sm text-red-500 mb-2 text-center">{statusError}</p>
            )}
            <button
              disabled={statusUpdating}
              onClick={async () => {
                setStatusUpdating(true)
                setStatusError('')
                try {
                  const upcomingStatus = nextStatus[status]
                  // Resolve the actor name: profile name → display name → email
                  const actorName = currentUser?._profileName || currentUser?.displayName || currentUser?.email || ''
                  const actorRole = userRole || ''

                  await incidentAPI.updateStatus(found.id, upcomingStatus, {
                    updatedByName: actorName,
                    updatedByRole: actorRole,
                  })

                  // Optimistic update first so the UI feels instant
                  setStatus(upcomingStatus)
                  if (actorName && upcomingStatus === 'acknowledged') {
                    setAcknowledgedUsers(prev => prev.includes(actorName) ? prev : [...prev, actorName])
                  }
                  if (actorName && upcomingStatus === 'in-progress') {
                    setInProgressUsers(prev => prev.includes(actorName) ? prev : [...prev, actorName])
                  }

                  // Then re-fetch from Firestore so "More details" reflects the real stored data
                  try {
                    const fresh = await getIncidentById(found.id)
                    applyRecord(fresh)
                  } catch {
                    // Optimistic state already applied — safe to swallow re-fetch error
                  }
                } catch (err) {
                  setStatusError(err.message || 'Failed to update status. Please try again.')
                } finally {
                  setStatusUpdating(false)
                }
              }}
              className="w-full py-3 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {statusUpdating ? 'Updating...' : nextLabel[status]}
            </button>
          </>
        )
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-2 text-sm text-gray-500">
          🔒 Status can only be updated by an Admin
        </div>
      )}

      {status === 'archived' && (
        <div className="text-center text-sm text-gray-400 py-3">
          This incident has been archived.
        </div>
      )}

    </div>
  )
}
