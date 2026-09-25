import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { incidentAPI, setupAPI } from '../api/client'

// Quick test alerts let a School Admin fire a pre-configured emergency alert in two
// clicks (pick a type, then confirm) instead of filling in the full Alert Testing form.
// Every alert created here is labelled as a test so reviewers can tell it apart from a
// real incident.

const MAX_BUTTONS = 4
const TEST_PRIORITY = 'critical'
const TEST_LOCATION = 'Alert testing'
const TEST_TITLE_PREFIX = 'TEST'

const FALLBACK_TYPES = [
  { label: 'Fire', emoji: '🔥' },
  { label: 'Lockdown', emoji: '🔒' },
  { label: 'Medical', emoji: '🏥' },
]

// Incident types are stored as slugs, matching the Alert Testing form.
function toIncidentType(label) {
  return String(label).toLowerCase().replace(/\s+/g, '_')
}

function buildTestIncident(type, location) {
  return {
    // isTest keeps drills out of the school's analytics and badges them in the incident list.
    isTest: true,
    type: toIncidentType(type.label),
    priority: TEST_PRIORITY,
    title: `${TEST_TITLE_PREFIX}: ${type.label} alert`,
    location: location || TEST_LOCATION,
    description:
      'Test alert triggered from the Alert Testing page using a quick action. ' +
      `For testing and review purposes only, not a real ${type.label.toLowerCase()} emergency.`,
  }
}

export default function QuickTestAlerts({ locations = [] }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [pendingType, setPendingType] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [lastTest, setLastTest] = useState(null)

  const location = locations[0] || TEST_LOCATION

  useEffect(() => {
    let active = true
    setupAPI.getAlertTypes('emergency')
      .then(data => {
        if (!active) return
        const configured = (data.alertTypes || [])
          .filter(type => type?.label)
          .map(type => ({ label: type.label, emoji: type.emoji || '🚨' }))
        setTypes((configured.length ? configured : FALLBACK_TYPES).slice(0, MAX_BUTTONS))
      })
      .catch(() => { if (active) setTypes(FALLBACK_TYPES.slice(0, MAX_BUTTONS)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const handleSend = async () => {
    if (!pendingType || sending) return
    setSending(true)
    setError('')
    try {
      const incident = await incidentAPI.create(buildTestIncident(pendingType, location))
      setLastTest({ ...incident, typeLabel: pendingType.label })
      setPendingType(null)
    } catch (err) {
      setError(err.message || 'Could not send the test alert. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (!loading && types.length === 0) return null

  return (
    <section aria-labelledby="quick-test-heading" className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 id="quick-test-heading" className="font-semibold text-gray-900">Quick test alerts</h2>
        <span className="text-xs bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">
          TESTING ONLY
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Send a pre-configured alert in one click to test routing and review. Alerts sent from here are
        titled {TEST_TITLE_PREFIX} and are not real emergencies.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading alert types...</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {types.map(type => (
            <button
              key={type.label}
              type="button"
              onClick={() => { setPendingType(type); setError(''); setLastTest(null) }}
              className="flex items-center gap-2 px-3 py-3 border border-gray-200 rounded-lg text-left hover:border-amber-400 hover:bg-amber-50 transition-colors"
            >
              <span aria-hidden="true" className="text-lg">{type.emoji}</span>
              <span className="text-sm font-medium text-gray-800">Test {type.label}</span>
            </button>
          ))}
        </div>
      )}

      {error && !pendingType && <p role="alert" className="text-xs text-red-600 mt-3">{error}</p>}

      {lastTest && (
        <div className="mt-4 border border-green-200 bg-green-50 rounded-lg px-3 py-3">
          <p className="text-sm font-semibold text-green-900">{lastTest.typeLabel} test alert sent</p>
          <p className="text-xs text-green-800 mt-0.5">
            It is listed under Incidents with a TEST badge and is left out of Analytics.
          </p>
          {lastTest.id && (
            <Link to={`/incidents/${lastTest.id}`} className="text-xs font-medium text-green-900 underline mt-2 inline-block">
              View test incident{lastTest.incidentNumber ? ` ${lastTest.incidentNumber}` : ''}
            </Link>
          )}
        </div>
      )}

      {pendingType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={() => setPendingType(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-test-confirm-heading"
            className="relative bg-white border-2 border-amber-400 rounded-xl p-6 max-w-md w-full shadow-xl"
          >
            <h3 id="quick-test-confirm-heading" className="font-semibold text-gray-900">
              Send {pendingType.label} test alert?
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              This creates a test incident that you and other admins at your school can review. No
            notifications are sent to staff.
            </p>
            <dl className="mt-4 text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
              <div className="flex gap-2"><dt className="text-gray-500 w-20">Type</dt><dd className="text-gray-800">{pendingType.emoji} {pendingType.label}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-20">Priority</dt><dd className="text-gray-800">Critical</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-20">Location</dt><dd className="text-gray-800">{location}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-20">Title</dt><dd className="text-gray-800">{TEST_TITLE_PREFIX}: {pendingType.label} alert</dd></div>
            </dl>
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              For testing purposes only. Do not use during a real emergency.
            </p>
            {error && <p role="alert" className="text-xs text-red-600 mt-2">{error}</p>}
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setPendingType(null)}
                className="flex-1 py-2.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                className="flex-1 py-2.5 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {sending ? 'Sending...' : 'Send test alert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
