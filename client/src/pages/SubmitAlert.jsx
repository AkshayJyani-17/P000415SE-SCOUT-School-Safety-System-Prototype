import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { incidentAPI, schoolAPI, setupAPI } from '../api/client'
import { useAuth } from '../context/AuthContext'

const FALLBACK_ALERT_TYPES = [
  { value: 'medical', label: '🏥 Medical' },
  { value: 'fire', label: '🔥 Fire' },
  { value: 'lockdown', label: '🔒 Lockdown' },
  { value: 'behaviour', label: '⚠️ Behaviour' },
  { value: 'weather', label: '🌩️ Weather' },
  { value: 'maintenance', label: '🔧 Maintenance' },
  { value: 'general', label: '📢 General' },
]

const FALLBACK_LOCATIONS = [
  'Oval', 'Canteen', 'Block A', 'Block B', 'Block C',
  'Main Building', 'Cafeteria', 'Library', 'Car Park', 'Reception',
]

const priorities = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high', label: '🟠 High' },
  { value: 'medium', label: '🟡 Medium' },
  { value: 'low', label: '⚪ Low' },
]

export default function SubmitAlert() {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [alertTypes, setAlertTypes] = useState(FALLBACK_ALERT_TYPES)
  const [locations, setLocations] = useState(FALLBACK_LOCATIONS)
  const [form, setForm] = useState({
    type: '',
    priority: '',
    title: '',
    description: '',
    location: '',
  })
  const [errors, setErrors] = useState({})
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [recipients, setRecipients] = useState([])
  const [schools, setSchools] = useState([])
  const { currentUser, isSchoolAdmin, isCompanyAdmin } = useAuth()

  useEffect(() => {
    if (isCompanyAdmin) schoolAPI.list().then(data => setSchools(data.schools)).catch(() => setErrors(prev => ({ ...prev, schools: 'Could not load schools.' })))
    setupAPI.getAlertTypes()
      .then(data => {
        if (data.alertTypes?.length) {
          setAlertTypes(data.alertTypes.map(t => ({
            value: t.label.toLowerCase().replace(/\s+/g, '_'),
            label: `${t.emoji || '📢'} ${t.label}`,
          })))
        }
      })
      .catch(() => {}) // keep fallback on error

    setupAPI.getLocations()
      .then(data => {
        if (data.locations?.length) {
          setLocations(data.locations.map(l => l.label))
        }
      })
      .catch(() => {}) // keep fallback on error
  }, [isCompanyAdmin])

  // TODO: Keep basic client-side validation here, but also validate all alert fields again on the backend before saving.
  const validate = () => {
    const e = {}
    if (!form.type) e.type = 'Please select an alert type'
    if (!form.priority) e.priority = 'Please select a priority'
    const title = form.title.trim()
    if (!title) e.title = 'Please enter a title'
    else if (title.length < 3 || (title.match(/[A-Za-z]/g) || []).length < 2) {
      e.title = 'Enter a meaningful title using at least 3 characters and 2 letters'
    }
    if (!form.location) e.location = 'Please select a location'
    if (isCompanyAdmin && !form.schoolId) e.schoolId = 'Please select a school'
    return e
  }

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: '' }))
    setIsPreviewing(false)
  }

  const handlePreview = async () => {
    if (isSubmitting) return

    const e2 = validate()
    if (Object.keys(e2).length > 0) {
      setErrors(e2)
      return
    }

    setIsSubmitting(true)
    try {
      const data = await incidentAPI.previewRecipients(form.type, form.schoolId)
      setRecipients(data.recipients || [])
      setIsPreviewing(true)
    } catch (error) {
      setErrors({ submit: error.message || 'Could not load notification recipients.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    if (isSubmitting || !isPreviewing) return
    setIsSubmitting(true)
    try {
      const createdIncident = await incidentAPI.create({
        ...form,
        triggeredByName:
          currentUser?.displayName ||
          currentUser?._profileName ||
          'Unknown',
        triggeredById: currentUser?.uid || null,
      })
      navigate(`/incidents/${createdIncident.id}`)
    } catch (error) {
      console.error('Failed to submit alert:', error)
      setErrors({ submit: 'Failed to submit alert. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isPreviewing) return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Review alert</h1>
      <p className="text-sm text-gray-600 mb-6">Check these details before final submission.</p>
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <dl className="space-y-3 text-sm">
          <div><dt className="font-medium text-gray-600">Alert type</dt><dd>{alertTypes.find(t => t.value === form.type)?.label || form.type}</dd></div>
          <div><dt className="font-medium text-gray-600">Priority</dt><dd>{priorities.find(p => p.value === form.priority)?.label || form.priority}</dd></div>
          {isCompanyAdmin && <div><dt className="font-medium text-gray-600">School</dt><dd>{schools.find(s => s.id === form.schoolId)?.name || form.schoolId}</dd></div>}
          <div><dt className="font-medium text-gray-600">Location</dt><dd>{form.location}</dd></div>
          <div><dt className="font-medium text-gray-600">Message</dt><dd className="whitespace-pre-wrap">{form.title}{form.description ? ` — ${form.description}` : ''}</dd></div>
        </dl>
        <section aria-label="Notification recipients">
          <h2 className="font-semibold text-gray-900">Notification recipients ({recipients.length})</h2>
          {recipients.length ? <ul className="mt-2 space-y-2 text-sm">{recipients.map((recipient, index) => (
            <li key={`${recipient.email || recipient.phone}-${index}`} className="border rounded-lg p-2">
              <span className="font-medium">{recipient.name || recipient.email || recipient.phone}</span>
              <span className="block text-gray-600">{[recipient.email, recipient.phone].filter(Boolean).join(' · ')}</span>
            </li>
          ))}</ul> : <p className="text-sm text-amber-700 mt-2">No notification recipients are configured for this alert type at this school.</p>}
        </section>
        {errors.submit && <p role="alert" className="text-sm text-red-600">{errors.submit}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={() => { setIsPreviewing(false); setErrors({}) }} className="flex-1 py-3 border rounded-lg">Edit alert</button>
          <button type="button" onClick={() => navigate('/dashboard')} className="flex-1 py-3 border rounded-lg">Cancel</button>
        </div>
        <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="w-full py-3 bg-red-600 text-white font-medium rounded-lg disabled:opacity-50">{isSubmitting ? 'Submitting...' : 'Confirm and submit alert'}</button>
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-lg mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {isSchoolAdmin ? 'Alert Testing' : 'Submit Alert'}
        </h1>
        <p className="text-sm text-gray-500">
          {isSchoolAdmin
            ? 'Design, test, and review how alerts behave before they are used in practice.'
            : 'Create a structured alert with the key details staff need to respond.'}
        </p>
      </div>

      {/* Form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">

        {isCompanyAdmin && <div>
          <label htmlFor="alert-school" className="block text-sm font-medium text-gray-700 mb-1">School <span className="text-red-500">*</span></label>
          <select id="alert-school" value={form.schoolId || ''} onChange={e => handleChange('schoolId', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select a school</option>
            {schools.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {errors.schoolId && <p className="text-xs text-red-500 mt-1">{errors.schoolId}</p>}
          {errors.schools && <p className="text-xs text-red-500 mt-1">{errors.schools}</p>}
        </div>}

        {/* Alert Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Alert Type <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {alertTypes.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => handleChange('type', t.value)}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors text-left ${form.type === t.value
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {errors.type && <p className="text-xs text-red-500 mt-1">{errors.type}</p>}
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Priority <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {priorities.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => handleChange('priority', p.value)}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors text-left ${form.priority === p.value
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {errors.priority && <p className="text-xs text-red-500 mt-1">{errors.priority}</p>}
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={e => handleChange('title', e.target.value)}
            placeholder="Brief description of the incident"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title}</p>}
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Location <span className="text-red-500">*</span>
          </label>
          <select
            value={form.location}
            onChange={e => handleChange('location', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">Select a location</option>
            {locations.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          {errors.location && <p className="text-xs text-red-500 mt-1">{errors.location}</p>}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description <span className="text-gray-400 text-xs">(optional)</span>
          </label>
          <textarea
            value={form.description}
            onChange={e => handleChange('description', e.target.value)}
            placeholder="Any additional details about the incident..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
          />
        </div>

        {/* Submit */}
        {errors.submit && <p className="text-xs text-red-500">{errors.submit}</p>}
        <button
          onClick={handlePreview}
          disabled={isSubmitting}
          className="w-full py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
        >
          {isSubmitting ? 'Loading preview...' : 'Preview alert'}
        </button>

      </div>
    </div>
  )
}
