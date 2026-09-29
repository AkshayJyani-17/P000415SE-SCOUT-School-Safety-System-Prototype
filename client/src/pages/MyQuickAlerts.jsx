import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { quickAlertsAPI, setupAPI } from '../api/client'

const PRIORITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const EMPTY_FORM = {
  label: '',
  alertTypeId: '',
  priority: '',
  location: '',
  description: '',
}

export default function MyQuickAlerts() {
  const { isStaff, authLoading, userRole } = useAuth()

  const [quickAlerts, setQuickAlerts] = useState([])
  const [limit, setLimit] = useState(null)
  const [alertTypes, setAlertTypes] = useState([])
  const [locations, setLocations] = useState([])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')

    try {
      const [alertsData, typesData, locationsData] = await Promise.all([
        quickAlertsAPI.list(),
        setupAPI.getAlertTypes(),
        setupAPI.getLocations(),
      ])

      setQuickAlerts(alertsData.quickAlerts || [])
      setLimit(alertsData.limit ?? null)
      setAlertTypes((typesData.alertTypes || []).filter(type => type.active !== false))
      setLocations((locationsData.locations || []).map(location => location.label).filter(Boolean))
    } catch (err) {
      setLoadError(err.message || 'Failed to load your quick alerts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isStaff) return
    load()
  }, [isStaff, load])

  const atLimit = limit !== null && quickAlerts.length >= limit
  const canAdd = !atLimit && alertTypes.length > 0

  const alertTypesById = useMemo(
    () => new Map(alertTypes.map(type => [type.id, type])),
    [alertTypes]
  )

  const selectedType = alertTypesById.get(form.alertTypeId) || null

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = quickAlert => {
    setForm({
      label: quickAlert.label || '',
      alertTypeId: quickAlert.alertTypeId || '',
      priority: quickAlert.priority || '',
      location: quickAlert.location || '',
      description: quickAlert.description || '',
    })
    setEditingId(quickAlert.id)
    setFormError('')
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  const updateField = (field, value) => {
    setForm(previous => ({ ...previous, [field]: value }))
    setFormError('')
  }

  const handleSave = async () => {
    if (saving) return

    if (!form.label.trim()) {
      setFormError('Give your quick alert a name.')
      return
    }
    if (!form.alertTypeId) {
      setFormError('Choose the alert type this shortcut sends.')
      return
    }

    setSaving(true)
    setFormError('')

    const payload = {
      label: form.label.trim(),
      alertTypeId: form.alertTypeId,
      priority: form.priority || undefined,
      location: form.location || null,
      description: form.description.trim() || null,
    }

    try {
      const data = editingId
        ? await quickAlertsAPI.update(editingId, payload)
        : await quickAlertsAPI.create(payload)

      setQuickAlerts(data.quickAlerts || [])
      setLimit(data.limit ?? limit)
      closeForm()
    } catch (err) {
      setFormError(err.message || 'Could not save your quick alert.')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async quickAlert => {
    if (removingId) return
    if (!window.confirm(`Remove "${quickAlert.label}" from your quick alerts?`)) return

    setRemovingId(quickAlert.id)

    try {
      const data = await quickAlertsAPI.remove(quickAlert.id)
      setQuickAlerts(data.quickAlerts || [])
      setLimit(data.limit ?? limit)
    } catch (err) {
      setLoadError(err.message || 'Could not remove that quick alert.')
    } finally {
      setRemovingId(null)
    }
  }

  if (authLoading || userRole === null) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-gray-500 text-center py-12">Loading...</p>
      </div>
    )
  }

  if (!isStaff) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Quick Alerts</h1>
        <p className="text-sm text-gray-500 mt-1">
          Save shortcuts for the emergencies you report most often. Each one appears as a
          single button on your dashboard and notifies the same people as the alert type it uses.
        </p>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-center py-12">Loading your quick alerts...</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-600">
              {quickAlerts.length} of {limit ?? '—'} saved
            </p>
            <button
              onClick={openCreate}
              disabled={!canAdd}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add quick alert
            </button>
          </div>

          {atLimit && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              You have reached the limit of {limit} quick alerts. Remove one to add another.
            </p>
          )}

          {alertTypes.length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              No alert types have been configured yet. Ask your School Admin to set them up
              before saving a quick alert.
            </p>
          )}

          {quickAlerts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-sm text-gray-600 font-medium">You have no quick alerts yet</p>
              <p className="text-xs text-gray-400 mt-1">
                Add one to trigger the alerts you use most with a single tap.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {quickAlerts.map(quickAlert => (
                <li
                  key={quickAlert.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">{quickAlert.alertType?.emoji || '🔔'}</span>
                      <p className="font-semibold text-gray-900 truncate">{quickAlert.label}</p>
                      <PriorityBadge priority={quickAlert.priority} />
                      {!quickAlert.available && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                          Needs attention
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-500 mt-1">
                      Sends {quickAlert.alertType?.label || 'an unavailable alert type'}
                      {quickAlert.location ? ` · ${quickAlert.location}` : ''}
                    </p>

                    {quickAlert.description && (
                      <p className="text-xs text-gray-400 mt-1 truncate">{quickAlert.description}</p>
                    )}

                    {!quickAlert.available && (
                      <p className="text-xs text-red-600 mt-1">{quickAlert.unavailableReason}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(quickAlert)}
                      aria-label={`Edit ${quickAlert.label}`}
                      className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRemove(quickAlert)}
                      disabled={removingId === quickAlert.id}
                      aria-label={`Remove ${quickAlert.label}`}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeForm} />
          <div className="relative bg-white border border-gray-200 rounded-xl p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editingId ? 'Edit quick alert' : 'New quick alert'}
            </h2>

            <div className="space-y-4">
              <Field label="Name" required>
                <input
                  type="text"
                  value={form.label}
                  onChange={event => updateField('label', event.target.value)}
                  placeholder="e.g. Asthma attack — Oval"
                  maxLength={40}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </Field>

              <Field label="Alert type" required hint="Decides who gets notified.">
                <select
                  value={form.alertTypeId}
                  onChange={event => updateField('alertTypeId', event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Select an alert type</option>
                  {alertTypes.map(type => (
                    <option key={type.id} value={type.id}>
                      {type.emoji ? `${type.emoji} ` : ''}{type.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Priority"
                hint={selectedType ? `Defaults to the usual priority for ${selectedType.label}.` : undefined}
              >
                <select
                  value={form.priority}
                  onChange={event => updateField('priority', event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Use the default</option>
                  {PRIORITIES.map(priority => (
                    <option key={priority.value} value={priority.value}>{priority.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Location" hint="Optional. Pre-fills the location when you trigger it.">
                <select
                  value={form.location}
                  onChange={event => updateField('location', event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">No preset location</option>
                  {locations.map(location => (
                    <option key={location} value={location}>{location}</option>
                  ))}
                </select>
              </Field>

              <Field label="Notes" hint="Optional. Included in the alert message.">
                <textarea
                  value={form.description}
                  onChange={event => updateField('description', event.target.value)}
                  placeholder="e.g. Student has a reliever inhaler in the first-aid room"
                  rows={3}
                  maxLength={280}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </Field>
            </div>

            {formError && <p className="text-xs text-red-600 mt-3">{formError}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={closeForm}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300 transition-colors"
              >
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Save quick alert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-gray-400 mt-1">{hint}</span>}
    </label>
  )
}

function PriorityBadge({ priority }) {
  const styles = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  }

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[priority] || styles.low}`}>
      {priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : 'Low'}
    </span>
  )
}
