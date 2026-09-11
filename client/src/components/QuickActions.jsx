import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { incidentAPI, apiCall, setupAPI } from '../api/client'

const FALLBACK_EMERGENCY_TYPES = [
  { value: 'Natural Disaster', icon: '🌊', desc: 'Earthquake, flood, severe weather' },
  { value: 'Fire', icon: '🔥', desc: 'Fire emergency or smoke detected' },
  { value: 'Threat', icon: '🛡️', desc: 'Security threat or lockdown' },
]

const FALLBACK_ACTION2_TYPES = [
  { value: 'general', label: 'General', icon: '📢', desc: 'General incident or school-wide notice' },
  { value: 'behaviour', label: 'Behaviour', icon: '⚠️', desc: 'Student behaviour and conduct incidents' },
  { value: 'medical', label: 'Medical', icon: '🏥', desc: 'Health and first-aid incidents' },
  { value: 'maintenance', label: 'Maintenance', icon: '🔧', desc: 'Facilities and maintenance issues' },
]

export default function QuickActions() {
  const { isStaff, currentUser } = useAuth()
  const [feedback, setFeedback] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showCategory, setShowCategory] = useState(false)
  const [showAction2Category, setShowAction2Category] = useState(false)
  const [showKeypad, setShowKeypad] = useState(false)
  const [selectedType, setSelectedType] = useState(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [customMessage, setCustomMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [showResult, setShowResult] = useState(null)
  const [emergencyTypes, setEmergencyTypes] = useState(FALLBACK_EMERGENCY_TYPES)
  const [action2Types, setAction2Types] = useState(FALLBACK_ACTION2_TYPES)

  // Fetch alert types from Firestore — fall back to hardcoded if API unavailable
  useEffect(() => {
    // Fetch emergency types for Button 1
    setupAPI.getAlertTypes('emergency')
      .then(data => {
        if (data.alertTypes?.length) {
          setEmergencyTypes(data.alertTypes.map(t => ({
            value: t.label,
            icon: t.emoji || '🚨',
            desc: t.desc || '',
          })))
        }
      })
      .catch(() => {})

    // Fetch general types for Button 2
    setupAPI.getAlertTypes('general')
      .then(data => {
        if (data.alertTypes?.length) {
          setAction2Types(data.alertTypes.map(t => ({
            value: t.value || t.label.toLowerCase().replace(/\s+/g, '_'),
            label: t.label,
            icon: t.emoji || '📢',
            desc: t.desc || '',
          })))
        }
      })
      .catch(() => {})
  }, [])


  const handleEmergencyClick = () => {
    setShowConfirm(true)
  }

  const handleConfirm = () => {
    setShowConfirm(false)
    setShowCategory(true)
  }

  const handleCategorySelect = type => {
    setSelectedType(type)
    setShowCategory(false)
    setShowKeypad(true)
    setCode('')
    setCodeError('')
    setCustomMessage('')
  }

  const createIncidentRecord = async (typeValue, description) => {
    // Use value field from Firestore if available, otherwise derive from label
    const matchedType = emergencyTypes.find(t => t.value === typeValue)
    const incidentType = matchedType?.value
      ? matchedType.value.toLowerCase().replace(/\s+/g, '_')
      : typeValue.toLowerCase().replace(/\s+/g, '_')

    try {
      const incident = await incidentAPI.create({
        type: incidentType,
        priority: 'critical',
        title: `${typeValue} alert`,
        location: 'Dashboard quick action',
        description: description || `${typeValue} emergency triggered from dashboard.`,
        triggeredByName: currentUser?.displayName ||
          currentUser?._profileName || 'Unknown',
        triggeredById: currentUser?.uid || null,
      })
      return incident
    } catch (err) {
      console.error('Failed to create incident record:', err)
      return null
    }
  }

  const handleCodeSubmit = async () => {
    if (code !== '000') {
      setCodeError('Invalid code. Please enter 000 to confirm emergency.')
      return
    }

    setLoading(true)
    setCodeError('')

    try {
      const incident = await createIncidentRecord(selectedType.value, customMessage)
      const incidentId = incident?.id || null

      const data = await apiCall('/notifications/emergency', {
        method: 'POST',
        body: JSON.stringify({
          code,
          emergencyType: selectedType.value,
          location: '',
          message: customMessage || `Emergency alert triggered for ${selectedType.value}. All relevant staff have been notified.`,
          incidentId,
        }),
      })

      if (data.success) {
        if (incidentId) {
          localStorage.setItem('activeEmergency', JSON.stringify({
            incidentId,
            emergencyType: selectedType.value,
            triggeredAt: new Date().toISOString(),
          }))
          window.dispatchEvent(new Event('emergencyTriggered'))
        }

        setShowKeypad(false)
        setShowResult(data)
        setFeedback({ type: selectedType.value })
        setTimeout(() => setFeedback(null), 3000)
      } else {
        setCodeError(data.error || 'Failed to send alert. Please try again.')
      }
    } catch (error) {
      setCodeError(error.message || 'Could not connect to server. Make sure the backend is running.')
    }

    setLoading(false)
  }

  const handleAction2 = async () => {
    setShowAction2Category(true)
  }

  const handleAction2CategorySelect = async (selectedAction2Type) => {
    setShowAction2Category(false)
    setLoading(true)
    setCodeError('')

    try {
      const incident = await incidentAPI.create({
        type: selectedAction2Type.value,
        priority: 'medium',
        title: `${selectedAction2Type.label} alert`,
        location: 'Dashboard quick action',
        description: `${selectedAction2Type.label} quick action triggered from dashboard.`,
        triggeredByName: currentUser?.displayName ||
          currentUser?._profileName || 'Unknown',
        triggeredById: currentUser?.uid || null,
      })

      const incidentId = incident?.id || null

      const data = await apiCall('/notifications/emergency', {
        method: 'POST',
        body: JSON.stringify({
          code: '000',
          emergencyType: selectedAction2Type.value,
          location: 'Dashboard quick action',
          message: `${selectedAction2Type.label} quick action triggered from dashboard.`,
          incidentId,
          incidentTitle: `${selectedAction2Type.label} alert`,
        }),
      })

      if (incidentId) {
        localStorage.setItem('activeEmergency', JSON.stringify({
          incidentId,
          emergencyType: selectedAction2Type.label,
          triggeredAt: new Date().toISOString(),
        }))
        window.dispatchEvent(new Event('emergencyTriggered'))
      }

      setShowResult(data)
      setFeedback({ type: selectedAction2Type.label })
      setTimeout(() => setFeedback(null), 3000)
    } catch (err) {
      console.error('Failed to create incident or send notifications for action 2:', err)
      setCodeError(err.message || 'Could not create the incident or send notifications. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!isStaff) return null

  const emergencyPreview = emergencyTypes.slice(0, 3).map(t => t.value).join(', ')
  const generalPreview   = action2Types.slice(0, 3).map(t => t.label).join(', ')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Quick Alert</h2>
        <p className="text-xs text-gray-500">Choose the alert that best matches what is happening.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleEmergencyClick}
          className="relative bg-red-50 border-2 border-red-300 rounded-xl p-6 hover:border-red-500 hover:bg-red-100 transition-all text-left"
        >
          <span className="absolute top-2 right-2 text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-semibold">
            EMERGENCY
          </span>
          <div className="text-lg font-bold text-red-700 mb-2">Emergency alert</div>
          <p className="text-xs text-red-700">{emergencyPreview || 'Fire, Medical, Lockdown'}</p>
          <p className="text-xs text-red-500 mt-3">Use when immediate response is required.</p>
        </button>

        <button
          onClick={handleAction2}
          className="bg-white border-2 border-gray-300 rounded-xl p-6 hover:border-green-500 hover:bg-green-50 transition-all text-left"
        >
          <div className="text-lg font-bold text-gray-800 mb-2">General alert</div>
          <p className="text-xs text-gray-600">{generalPreview || 'Behaviour, Maintenance, General'}</p>
          <p className="text-xs text-gray-400 mt-3">Use for structured reporting and awareness.</p>
        </button>
      </div>

      {feedback && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <span className="text-green-600">✅</span>
          <div>
            <p className="text-sm font-semibold text-green-900">{feedback.type} alert sent</p>
            <p className="text-xs text-green-700">Help is on the way. Relevant staff have been notified.</p>
          </div>
        </div>
      )}


      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={() => setShowConfirm(false)} />
          <div className="relative bg-white border-2 border-red-500 rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-lg">⚠️</div>
              <div>
                <h4 className="font-semibold text-gray-900">Emergency Alert Confirmation</h4>
                <p className="text-sm text-gray-500 mt-1">
                  This will alert the relevant response staff immediately.
                </p>
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-800">Are you sure you want to proceed?</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleConfirm} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {showCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={() => setShowCategory(false)} />
          <div className="relative bg-white border border-gray-200 rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-gray-900">Select Emergency Type</h4>
              <button onClick={() => setShowCategory(false)} className="text-gray-400 hover:text-gray-600">X</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Choose the category that best describes this emergency:</p>
            <div className="space-y-2">
              {emergencyTypes.map(type => (
                <button
                  key={type.value}
                  onClick={() => handleCategorySelect(type)}
                  className="w-full flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-red-400 hover:bg-red-50 transition-all text-left"
                >
                  <span className="text-sm font-semibold text-gray-600">{type.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{type.value}</p>
                    <p className="text-xs text-gray-400">{type.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAction2Category && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={() => setShowAction2Category(false)} />
          <div className="relative bg-white border border-gray-200 rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-gray-900">Select Incident Category</h4>
              <button onClick={() => setShowAction2Category(false)} className="text-gray-400 hover:text-gray-600">X</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Choose the category for this incident. No passcode is required.</p>
            <div className="space-y-2">
              {action2Types.map(type => (
                <button
                  key={type.value}
                  onClick={() => handleAction2CategorySelect(type)}
                  className="w-full flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition-all text-left"
                >
                  <span className="text-sm font-semibold text-gray-600">{type.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{type.label}</p>
                    <p className="text-xs text-gray-400">{type.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showKeypad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-50" />
          <div className="relative bg-white border-2 border-red-500 rounded-xl p-6 max-w-sm w-full shadow-xl">
            <div className="text-center mb-4">
              <div className="text-lg font-semibold mb-2">{selectedType?.icon}</div>
              <h4 className="font-bold text-gray-900">{selectedType?.value} Emergency</h4>
              <p className="text-sm text-gray-500 mt-1">Enter <strong className="text-red-600">000</strong> to confirm and send alerts to all teams.</p>
            </div>
            <div className="mb-4">
              <input
                type="text"
                value={code}
                onChange={event => { setCode(event.target.value); setCodeError('') }}
                placeholder="Enter 000"
                maxLength={3}
                className="w-full text-center text-3xl font-bold tracking-widest px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-red-500"
              />
              {codeError && <p className="text-xs text-red-600 text-center mt-2">{codeError}</p>}
            </div>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">Additional message <span className="text-gray-400">(optional)</span></label>
              <textarea
                value={customMessage}
                onChange={event => setCustomMessage(event.target.value)}
                placeholder="e.g. Fire spotted near Block B, students evacuating..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-red-500 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowKeypad(false); setCode(''); setCodeError(''); setCustomMessage('') }}
                className="flex-1 py-2.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCodeSubmit}
                disabled={loading || code.length !== 3}
                className={`flex-1 py-2.5 text-sm rounded-lg font-semibold transition-colors ${loading || code.length !== 3 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}
              >
                {loading ? 'Sending...' : '🚨 Send Alert'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={() => setShowResult(null)} />
          <div className="relative bg-white border border-gray-200 rounded-xl p-6 max-w-sm w-full shadow-xl text-center">
            <div className="text-4xl mb-3">✅</div>
            <h4 className="font-bold text-gray-900 text-lg mb-1">Alert sent</h4>
            <p className="text-sm text-gray-500 mb-6">Help is on the way. Relevant staff have been notified and will respond shortly.</p>
            <button
              onClick={() => setShowResult(null)}
              className="w-full py-2.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}


    </div>
  )
}
