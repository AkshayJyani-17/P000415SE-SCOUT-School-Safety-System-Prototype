import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { archiveAPI, settingsAPI, setupAPI } from '../api/client'
import AlertTypeSelect from '../components/AlertTypeSelect'
import { useAuth } from '../context/AuthContext'
import { useSchools } from '../context/SchoolsContext'
import { applyRecipientPhone } from '../utils/routingRecipients'

const EMOJI_OPTIONS = ['🏥', '🔥', '🔒', '⚠️', '🌩️', '🔧', '📢', '🚨', '🛡️', '🌊']

// School Admin routing rules are keyed by the alert type label, so options are
// de-duplicated by label (case-insensitive) to keep one entry per routing rule.
function buildAlertTypeOptions(alertTypes) {
  const seen = new Set()
  const options = []
  for (const type of alertTypes || []) {
    const label = String(type?.label || '').trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    options.push({
      value: label,
      label,
      icon: type.emoji || (type.category === 'emergency' ? '🚨' : '📢'),
      category: type.category === 'emergency' ? 'emergency' : 'general',
    })
  }
  return options
}

function formatRole(role) {
  return String(role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function Setup() {
  const { isCompanyAdmin, isSchoolAdmin } = useAuth()
  const navigate = useNavigate()

  const {
    allSchools,
    loading: schoolsLoading,
    error: schoolsError,
    createSchool,
    renameSchool,
    setSchoolActive,
  } = useSchools()

  // ── Schools (Company Admin) ───────────────────────────────────────────────
  const [newSchoolName, setNewSchoolName] = useState('')
  const [addingSchool, setAddingSchool] = useState(false)
  const [schoolFormError, setSchoolFormError] = useState('')
  const [editingSchoolId, setEditingSchoolId] = useState(null)
  const [editSchoolName, setEditSchoolName] = useState('')
  const [savingSchoolId, setSavingSchoolId] = useState(null)

  const [alertTypes, setAlertTypes] = useState([])
  const [locations, setLocations] = useState([])
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [configError, setConfigError] = useState('')

  const [newType, setNewType] = useState({ label: '', emoji: '', category: 'general' })
  const [addingType, setAddingType] = useState(false)
  const [typeError, setTypeError] = useState('')
  const [editingTypeId, setEditingTypeId] = useState(null)
  const [editTypeForm, setEditTypeForm] = useState({ label: '', emoji: '', category: 'general' })

  const [newLocation, setNewLocation] = useState('')
  const [addingLocation, setAddingLocation] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [editingLocationId, setEditingLocationId] = useState(null)
  const [editLocationLabel, setEditLocationLabel] = useState('')

  const [alertTypeOptions, setAlertTypeOptions] = useState([])
  const [routing, setRouting] = useState({})
  const [schoolUsers, setSchoolUsers] = useState([])
  const [loadingRouting, setLoadingRouting] = useState(false)
  const [routingError, setRoutingError] = useState('')
  const [savingRouting, setSavingRouting] = useState({})
  const [saveStatus, setSaveStatus] = useState({})
  const [selectedEmergencyType, setSelectedEmergencyType] = useState('')
  const [notifyPrefs, setNotifyPrefs] = useState({})

  // ── Phone editing state (added for ClickSend SMS) ─────────────────────────
  const [editingPhoneUserId, setEditingPhoneUserId] = useState(null)
  const [editingPhoneValue, setEditingPhoneValue] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [editingEmailUserId, setEditingEmailUserId] = useState(null)
  const [editingEmailValue, setEditingEmailValue] = useState('')
  const [emailError, setEmailError] = useState('')

  const [retentionDays, setRetentionDays] = useState(30)
  const [thresholdLoading, setThresholdLoading] = useState(true)
  const [thresholdSaving, setThresholdSaving] = useState(false)
  const [thresholdError, setThresholdError] = useState('')
  const [thresholdSuccess, setThresholdSuccess] = useState(false)

  // Alert-timeout (overdue) duration, configured per-school by School Admins.
  // The company-wide value is shown only as a reference.
  const [companyOverdueThreshold, setCompanyOverdueThreshold] = useState(15)
  const [schoolThreshold, setSchoolThreshold] = useState('')
  const [schoolThresholdSaving, setSchoolThresholdSaving] = useState(false)
  const [schoolThresholdError, setSchoolThresholdError] = useState('')
  const [schoolThresholdSuccess, setSchoolThresholdSuccess] = useState(false)

  // Archive now state
  const [archiving, setArchiving] = useState(false)
  const [archiveResult, setArchiveResult] = useState(null)
  const [archiveError, setArchiveError] = useState('')

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true)
    setConfigError('')
    try {
      const [typesData, locsData] = await Promise.all([
        setupAPI.getAlertTypes(),
        setupAPI.getLocations(),
      ])
      setAlertTypes(typesData.alertTypes || [])
      setLocations(locsData.locations || [])
    } catch {
      setConfigError('Failed to load configuration. Is the backend running?')
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  useEffect(() => {
    if (isCompanyAdmin) loadConfig()
  }, [isCompanyAdmin, loadConfig])

  useEffect(() => {
    if (!isSchoolAdmin) return

    async function loadData() {
      setLoadingRouting(true)
      setRoutingError('')
      try {
        const [routingData, usersData, alertTypesData] = await Promise.all([
          setupAPI.getRouting(),
          setupAPI.getSchoolUsers(),
          setupAPI.getAlertTypes(),
        ])
        const map = {}
        for (const rule of (routingData.routing || [])) {
          map[rule.alertType] = rule.recipients || []
        }
        setRouting(map)
        setSchoolUsers(usersData.users || [])
        setAlertTypeOptions(buildAlertTypeOptions(alertTypesData.alertTypes))
      } catch {
        setRoutingError('Failed to load routing. Is the backend running?')
      } finally {
        setLoadingRouting(false)
      }
    }

    loadData()
  }, [isSchoolAdmin])

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await settingsAPI.get()
        setRetentionDays(data.archiveRetentionDays ?? 30)
        setCompanyOverdueThreshold(
          data.companyOverdueThresholdMinutes ?? data.overdueThresholdMinutes ?? 15
        )
        // Empty input means "use the company default"; a value means an active school override.
        setSchoolThreshold(
          data.schoolOverdueThresholdMinutes != null
            ? String(data.schoolOverdueThresholdMinutes)
            : ''
        )
      } catch (err) {
        console.error('Failed to load settings:', err)
      } finally {
        setThresholdLoading(false)
      }
    }

    if (isCompanyAdmin || isSchoolAdmin) {
      loadSettings()
    } else {
      setThresholdLoading(false)
    }
  }, [isCompanyAdmin, isSchoolAdmin])

  const handleAddType = async () => {
    if (!newType.label.trim()) {
      setTypeError('Label is required.')
      return
    }
    if (!newType.category) {
      setTypeError('Category is required.')
      return
    }

    setAddingType(true)
    setTypeError('')
    try {
      const data = await setupAPI.createAlertType(newType)
      setAlertTypes(prev => [...prev, data.alertType])
      setNewType({ label: '', emoji: '', category: 'general' })
    } catch (err) {
      setTypeError(err.message || 'Failed to add alert type.')
    } finally {
      setAddingType(false)
    }
  }

  const handleSaveType = async (id) => {
    if (!editTypeForm.label.trim()) return

    try {
      const data = await setupAPI.updateAlertType(id, editTypeForm)
      setAlertTypes(prev => prev.map(type => type.id === id ? data.alertType : type))
      setEditingTypeId(null)
    } catch (err) {
      setTypeError(err.message || 'Failed to update.')
    }
  }

  const handleDeleteType = async (id) => {
    if (!confirm('Delete this alert type?')) return

    try {
      const deleted = alertTypes.find(type => type.id === id)
      await setupAPI.deleteAlertType(id)
      setAlertTypes(prev => prev.filter(type => type.id !== id))
      if (deleted?.label === selectedEmergencyType) {
        setSelectedEmergencyType('')
      }
    } catch (err) {
      setTypeError(err.message || 'Failed to delete.')
    }
  }

  const handleAddLocation = async () => {
    if (!newLocation.trim()) {
      setLocationError('Label is required.')
      return
    }

    setAddingLocation(true)
    setLocationError('')
    try {
      const data = await setupAPI.createLocation({ label: newLocation })
      setLocations(prev => [...prev, data.location])
      setNewLocation('')
    } catch (err) {
      setLocationError(err.message || 'Failed to add location.')
    } finally {
      setAddingLocation(false)
    }
  }

  const handleSaveLocation = async (id) => {
    if (!editLocationLabel.trim()) return

    try {
      const data = await setupAPI.updateLocation(id, { label: editLocationLabel })
      setLocations(prev => prev.map(location => location.id === id ? data.location : location))
      setEditingLocationId(null)
    } catch (err) {
      setLocationError(err.message || 'Failed to update.')
    }
  }

  const handleDeleteLocation = async (id) => {
    if (!confirm('Delete this location?')) return

    try {
      await setupAPI.deleteLocation(id)
      setLocations(prev => prev.filter(location => location.id !== id))
    } catch (err) {
      setLocationError(err.message || 'Failed to delete.')
    }
  }

  const getRecipients = (alertType) => routing[alertType] || []

  const saveRouting = async (alertType, recipients) => {
    setSavingRouting(state => ({ ...state, [alertType]: true }))
    setSaveStatus(state => ({ ...state, [alertType]: null }))
    try {
      await setupAPI.updateRouting(alertType, recipients)
      setSaveStatus(state => ({ ...state, [alertType]: 'saved' }))
      setTimeout(() => setSaveStatus(state => ({ ...state, [alertType]: null })), 3000)
      return true
    } catch {
      setSaveStatus(state => ({ ...state, [alertType]: 'error' }))
      return false
    } finally {
      setSavingRouting(state => ({ ...state, [alertType]: false }))
    }
  }

  const handleAddUser = async (alertType, user) => {
    const notify = notifyPrefs[alertType]?.[user.id] || 'email'
    const current = getRecipients(alertType)
    const alreadyAdded = current.some(
      recipient => recipient.email?.toLowerCase() === user.email?.toLowerCase()
    )

    if (alreadyAdded) return

    const updated = [
      ...current,
      {
        name: user.name,
        email: user.email || null,
        phone: user.phone || null,
        role: user.role,
        notify,
      },
    ]

    setRouting(state => ({ ...state, [alertType]: updated }))
    await saveRouting(alertType, updated)
  }

  const handleRemoveRecipient = async (alertType, index) => {
    const updated = getRecipients(alertType).filter((_, i) => i !== index)
    setRouting(state => ({ ...state, [alertType]: updated }))
    await saveRouting(alertType, updated)
  }

  const getNotifyPref = (alertType, userId) => notifyPrefs[alertType]?.[userId] || 'email'

  const setNotifyPref = (alertType, userId, value) => {
    setNotifyPrefs(prev => ({
      ...prev,
      [alertType]: { ...(prev[alertType] || {}), [userId]: value },
    }))
  }

  // ── Phone edit handlers (added for ClickSend SMS) ─────────────────────────
  const handleEditPhone = (user) => {
    setEditingPhoneUserId(user.id)
    setEditingPhoneValue(user.phone || '')
    setPhoneError('')
  }

  const handleCancelEditPhone = () => {
    setEditingPhoneUserId(null)
    setEditingPhoneValue('')
    setPhoneError('')
  }

  const handleSavePhone = async (userId) => {
    setSavingPhone(true)
    setPhoneError('')
    try {
      const trimmed = editingPhoneValue.trim()
      const existingPhone = schoolUsers.find(u => u.id === userId)?.phone || null

    // Saving an empty field when there was no number to begin with writes null
    // over null: every request succeeds, nothing changes, and the row still
    // reads "No phone" — indistinguishable from a broken save. Refuse it and
    // say so instead.
      if (!trimmed && !existingPhone) {
        setPhoneError('Enter a phone number.')
        return
      }

    // Clearing an existing number stays allowed; nonsense does not.
      const digitCount = trimmed.replace(/\D/g, '').length
      if (trimmed && (!/^[+\d\s()-]+$/.test(trimmed) || digitCount < 8 || digitCount > 15)) {
        setPhoneError('Enter a valid phone number using 8 to 15 digits.')
        return
      }

    const newPhone = trimmed || null

    // 1. Update users collection
    await setupAPI.updateSchoolUser(userId, { phone: newPhone })

    // 2. Update local schoolUsers state
    setSchoolUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, phone: newPhone } : u
    ))

    // 3. Routing rules hold a snapshot copy of the recipient's phone, so the
    //    new number has to reach EVERY alert type this person is routed to —
    //    not just the one currently on screen. Any rule left behind would keep
    //    sending SMS for that alert to the old number, or to nowhere.
    const user = schoolUsers.find(u => u.id === userId)
    const updatesByAlertType = applyRecipientPhone(routing, user?.email, newPhone)
    const affectedTypes = Object.keys(updatesByAlertType)

    if (affectedTypes.length > 0) {
      setRouting(state => ({ ...state, ...updatesByAlertType }))

      const results = await Promise.all(
        affectedTypes.map(alertType => saveRouting(alertType, updatesByAlertType[alertType]))
      )

      const failed = affectedTypes.filter((_, index) => results[index] === false)

      if (failed.length > 0) {
        // Keep the editor open: the user record saved, but at least one routing
        // rule did not, and closing silently would hide that.
        setPhoneError(`Phone saved, but routing for ${failed.join(', ')} did not update. Please try again.`)
        return
      }
    }

    setEditingPhoneUserId(null)
    setEditingPhoneValue('')
    } catch (err) {
      setPhoneError(err.message || 'Failed to save phone number.')
    } finally {
      setSavingPhone(false)
    }
  }

  const handleEditEmail = (user) => {
    setEditingEmailUserId(user.id)
    setEditingEmailValue(user.email || '')
    setEmailError('')
  }

  const handleSaveEmail = async (userId) => {
    const email = editingEmailValue.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Enter a valid email address.')
      return
    }

    try {
      await setupAPI.updateSchoolUser(userId, { email })
      setSchoolUsers(prev => prev.map(user => user.id === userId ? { ...user, email } : user))
      setEditingEmailUserId(null)
      setEmailError('')
    } catch (err) {
      setEmailError(err.message || 'Could not save email.')
    }
  }

  async function handleSaveGlobalSettings() {
    setThresholdSaving(true)
    setThresholdError('')
    setThresholdSuccess(false)

    const parsedRetention = parseInt(retentionDays, 10)

    if (!Number.isInteger(parsedRetention) || parsedRetention < 1 || parsedRetention > 365) {
      setThresholdError('Retention period must be a whole number between 1 and 365 days.')
      setThresholdSaving(false)
      return
    }

    try {
      await settingsAPI.updateArchiveRetention(parsedRetention)
      setRetentionDays(parsedRetention)
      setThresholdSuccess(true)
      setTimeout(() => setThresholdSuccess(false), 3000)
    } catch (err) {
      setThresholdError(err.message || 'Failed to save settings.')
    } finally {
      setThresholdSaving(false)
    }
  }

  // School Admin: save this school's alert-timeout override.
  async function handleSaveSchoolThreshold() {
    setSchoolThresholdSaving(true)
    setSchoolThresholdError('')
    setSchoolThresholdSuccess(false)

    const parsed = parseInt(schoolThreshold, 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
      setSchoolThresholdError('Timeout must be a whole number between 1 and 1440 minutes.')
      setSchoolThresholdSaving(false)
      return
    }

    try {
      await settingsAPI.updateSchoolThreshold(parsed)
      setSchoolThreshold(String(parsed))
      setSchoolThresholdSuccess(true)
      setTimeout(() => setSchoolThresholdSuccess(false), 3000)
    } catch (err) {
      setSchoolThresholdError(err.message || 'Failed to save setting.')
    } finally {
      setSchoolThresholdSaving(false)
    }
  }

  // School Admin: clear the override so the school reverts to the company default.
  async function handleResetSchoolThreshold() {
    setSchoolThresholdSaving(true)
    setSchoolThresholdError('')
    setSchoolThresholdSuccess(false)

    try {
      await settingsAPI.updateSchoolThreshold(null)
      setSchoolThreshold('')
      setSchoolThresholdSuccess(true)
      setTimeout(() => setSchoolThresholdSuccess(false), 3000)
    } catch (err) {
      setSchoolThresholdError(err.message || 'Failed to reset setting.')
    } finally {
      setSchoolThresholdSaving(false)
    }
  }

  async function handleArchiveNow() {
    setArchiving(true)
    setArchiveResult(null)
    setArchiveError('')
    try {
      const result = await archiveAPI.trigger()
      setArchiveResult(result)
    } catch (err) {
      setArchiveError(err.message || 'Archiving failed.')
    } finally {
      setArchiving(false)
    }
  }

  async function handleAddSchool() {
    const name = newSchoolName.trim()
    if (!name) {
      setSchoolFormError('School name is required.')
      return
    }

    setAddingSchool(true)
    setSchoolFormError('')
    try {
      // Goes through SchoolsContext rather than the API directly, so the
      // shared list refreshes and the school appears in every dropdown at
      // once — not just on this page.
      await createSchool(name)
      setNewSchoolName('')
    } catch (err) {
      setSchoolFormError(err.message || 'Failed to add school.')
    } finally {
      setAddingSchool(false)
    }
  }

  function handleEditSchool(school) {
    setEditingSchoolId(school.id)
    setEditSchoolName(school.name || '')
    setSchoolFormError('')
  }

  function handleCancelEditSchool() {
    setEditingSchoolId(null)
    setEditSchoolName('')
  }

  async function handleSaveSchoolName(schoolId) {
    const name = editSchoolName.trim()
    if (!name) {
      setSchoolFormError('School name is required.')
      return
    }

    setSavingSchoolId(schoolId)
    setSchoolFormError('')
    try {
      await renameSchool(schoolId, name)
      setEditingSchoolId(null)
      setEditSchoolName('')
    } catch (err) {
      setSchoolFormError(err.message || 'Failed to rename school.')
    } finally {
      setSavingSchoolId(null)
    }
  }

  async function handleToggleSchoolActive(school) {
    setSavingSchoolId(school.id)
    setSchoolFormError('')
    try {
      await setSchoolActive(school.id, school.active === false)
    } catch (err) {
      // The server refuses to deactivate a school that still has an open
      // incident; surface that reason rather than failing silently.
      setSchoolFormError(err.message || 'Failed to update school.')
    } finally {
      setSavingSchoolId(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Setup</h1>

      {isCompanyAdmin && (
        <p className="text-sm text-gray-500 mb-6 max-w-2xl">
          Through this page you can design, configure, and manage the SCOUT system across all schools.
          This includes creating alert types, defining workflows, and shaping how SCOUT functions for all users.
        </p>
      )}

      {isSchoolAdmin && (
        <p className="text-sm text-gray-500 mb-6 max-w-2xl">
          Configure and apply SCOUT within your school. This includes selecting available alert types,
          choosing notification recipients, and defining who receives notifications. Use this area to test and refine
          how alerts behave before settings are applied in practice.
        </p>
      )}

      {(isCompanyAdmin || isSchoolAdmin) && (
        <button
          onClick={() => navigate('/submit')}
          className="mb-6 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-medium text-sm"
        >
          Test Alert
        </button>
      )}

      {isCompanyAdmin && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Schools</h2>
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Company Admin</span>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-sm text-gray-500 mb-4">
              Schools are read from the database, never from a fixed list. A school added here becomes
              available immediately in every school dropdown across SCOUT.
            </p>

            {schoolsError && <p className="text-xs text-red-600 mb-2">{schoolsError}</p>}
            {schoolFormError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{schoolFormError}</p>
            )}

            <div className="space-y-2 mb-4">
              {schoolsLoading && allSchools.length === 0 && (
                <p className="text-sm text-gray-400">Loading schools...</p>
              )}
              {!schoolsLoading && allSchools.length === 0 && (
                <p className="text-sm text-gray-400">No schools yet. Add the first one below.</p>
              )}

              {allSchools.map(school => {
                const isInactive = school.active === false
                const isEditingSchool = editingSchoolId === school.id
                const busy = savingSchoolId === school.id

                return (
                  <div
                    key={school.id}
                    className={`flex items-center gap-2 p-2 rounded-lg ${isInactive ? 'bg-gray-100' : 'bg-gray-50'}`}
                  >
                    {isEditingSchool ? (
                      <>
                        <input
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                          value={editSchoolName}
                          onChange={event => setEditSchoolName(event.target.value)}
                          onKeyDown={event => event.key === 'Enter' && handleSaveSchoolName(school.id)}
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveSchoolName(school.id)}
                          disabled={busy}
                          className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-60 transition-colors"
                        >
                          {busy ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={handleCancelEditSchool}
                          className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {school.name}
                            {isInactive && (
                              <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{school.id}</p>
                        </div>
                        <button
                          onClick={() => handleEditSchool(school)}
                          className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600 transition-colors"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleToggleSchoolActive(school)}
                          disabled={busy}
                          className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-60 transition-colors"
                        >
                          {busy ? '...' : isInactive ? 'Activate' : 'Deactivate'}
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500 mb-2">Add new school</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="e.g. Bunbury Senior High"
                  value={newSchoolName}
                  onChange={event => setNewSchoolName(event.target.value)}
                  onKeyDown={event => event.key === 'Enter' && handleAddSchool()}
                />
                <button
                  onClick={handleAddSchool}
                  disabled={addingSchool}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {addingSchool ? 'Adding...' : 'Add'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Schools are never deleted — deactivating hides a school from dropdowns while keeping its
                incident history intact. A school with an open incident cannot be deactivated.
              </p>
            </div>
          </div>
        </div>
      )}


      {isCompanyAdmin && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Alert Configuration</h2>
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Company Admin</span>
          </div>

          {loadingConfig && <p className="text-sm text-gray-400 mb-4">Loading...</p>}
          {configError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{configError}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Alert Types</h3>
              <p className="text-sm text-gray-500 mb-4">Appear in the alert type dropdown when submitting an alert.</p>

              {typeError && <p className="text-xs text-red-600 mb-2">{typeError}</p>}

              <div className="space-y-2 mb-4">
                {alertTypes.map(type => (
                  <div key={type.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    {editingTypeId === type.id ? (
                      <div className="flex flex-col gap-2 flex-1">
                        <div className="flex gap-2">
                          <select
                            value={editTypeForm.emoji}
                            onChange={event => setEditTypeForm(form => ({ ...form, emoji: event.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1 text-sm w-20"
                          >
                            <option value="">None</option>
                            {EMOJI_OPTIONS.map(emoji => <option key={emoji} value={emoji}>{emoji}</option>)}
                          </select>
                          <input
                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                            value={editTypeForm.label}
                            onChange={event => setEditTypeForm(form => ({ ...form, label: event.target.value }))}
                            onKeyDown={event => event.key === 'Enter' && handleSaveType(type.id)}
                          />
                        </div>
                        <div className="flex gap-2 items-center">
                          <select
                            value={editTypeForm.category}
                            onChange={event => setEditTypeForm(form => ({ ...form, category: event.target.value }))}
                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                          >
                            <option value="general">General</option>
                            <option value="emergency">Emergency</option>
                          </select>
                          <button onClick={() => handleSaveType(type.id)} className="text-xs text-green-600 hover:text-green-800 font-medium">Save</button>
                          <button onClick={() => setEditingTypeId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="text-base w-7">{type.emoji || '📢'}</span>
                        <span className="flex-1 text-sm font-medium text-gray-800">{type.label}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          type.category === 'emergency' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {type.category || 'general'}
                        </span>
                        <button
                          onClick={() => {
                            setEditingTypeId(type.id)
                            setEditTypeForm({ label: type.label, emoji: type.emoji || '', category: type.category || 'general' })
                          }}
                          className="text-xs text-gray-400 hover:text-blue-600"
                        >
                          Edit
                        </button>
                        <button onClick={() => handleDeleteType(type.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                      </>
                    )}
                  </div>
                ))}
                {alertTypes.length === 0 && !loadingConfig && (
                  <p className="text-sm text-gray-400">No alert types yet.</p>
                )}
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-500 mb-2">Add new</p>
                <div className="flex gap-2 mb-2">
                  <select
                    value={newType.emoji}
                    onChange={event => setNewType(form => ({ ...form, emoji: event.target.value }))}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20"
                  >
                    <option value="">Emoji</option>
                    {EMOJI_OPTIONS.map(emoji => <option key={emoji} value={emoji}>{emoji}</option>)}
                  </select>
                  <input
                    className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    placeholder="e.g. Medical"
                    value={newType.label}
                    onChange={event => setNewType(form => ({ ...form, label: event.target.value }))}
                    onKeyDown={event => event.key === 'Enter' && handleAddType()}
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={newType.category}
                    onChange={event => setNewType(form => ({ ...form, category: event.target.value }))}
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    <option value="general">General</option>
                    <option value="emergency">Emergency</option>
                  </select>
                  <button
                    onClick={handleAddType}
                    disabled={addingType}
                    className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {addingType ? '...' : 'Add'}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Locations</h3>
              <p className="text-sm text-gray-500 mb-4">Appear as location options when submitting an alert.</p>

              {locationError && <p className="text-xs text-red-600 mb-2">{locationError}</p>}

              <div className="space-y-2 mb-4">
                {locations.map(location => (
                  <div key={location.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    {editingLocationId === location.id ? (
                      <>
                        <input
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                          value={editLocationLabel}
                          onChange={event => setEditLocationLabel(event.target.value)}
                          onKeyDown={event => event.key === 'Enter' && handleSaveLocation(location.id)}
                        />
                        <button onClick={() => handleSaveLocation(location.id)} className="text-xs text-green-600 hover:text-green-800 font-medium">Save</button>
                        <button onClick={() => setEditingLocationId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-gray-400">📍</span>
                        <span className="flex-1 text-sm font-medium text-gray-800">{location.label}</span>
                        <button
                          onClick={() => {
                            setEditingLocationId(location.id)
                            setEditLocationLabel(location.label)
                          }}
                          className="text-xs text-gray-400 hover:text-blue-600"
                        >
                          Edit
                        </button>
                        <button onClick={() => handleDeleteLocation(location.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                      </>
                    )}
                  </div>
                ))}
                {locations.length === 0 && !loadingConfig && (
                  <p className="text-sm text-gray-400">No locations yet.</p>
                )}
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-500 mb-2">Add new</p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    placeholder="e.g. Block A"
                    value={newLocation}
                    onChange={event => setNewLocation(event.target.value)}
                    onKeyDown={event => event.key === 'Enter' && handleAddLocation()}
                  />
                  <button
                    onClick={handleAddLocation}
                    disabled={addingLocation}
                    className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {addingLocation ? '...' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          </div>


          {/* Archive Now panel */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 mt-6">
            <h3 className="font-semibold mb-1">Archive Resolved Incidents</h3>
            <p className="text-sm text-gray-500 mb-4">
              Runs automatically every 24 hours. Use this button to trigger it immediately — any resolved incident older than the configured retention period will be moved to the archive.
            </p>

            <button
              onClick={handleArchiveNow}
              disabled={archiving}
              className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50"
            >
              {archiving ? 'Archiving...' : 'Archive Now'}
            </button>

            {archiveResult !== null && !archiveError && (
              <p className="text-sm text-green-600 mt-3">
                {archiveResult.archived > 0
                  ? `✓ Archived ${archiveResult.archived} incident${archiveResult.archived === 1 ? '' : 's'}.`
                  : '✓ Nothing to archive — no resolved incidents past the retention period.'}
              </p>
            )}
            {archiveError && (
              <p className="text-sm text-red-600 mt-3">{archiveError}</p>
            )}
          </div>
        </div>
      )}

      {isSchoolAdmin && (
        <div className="mt-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">Alert Timeout</h3>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">School Admin</span>
            </div>
            <label className="block text-xs text-gray-600 mb-1">
              Unacknowledged alert timeout (minutes)
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Alerts at your school that stay unacknowledged longer than this are flagged as overdue.
              Leave blank to use the company default.
            </p>
            <input
              type="number"
              min={1}
              max={1440}
              value={thresholdLoading ? '' : schoolThreshold}
              onChange={event => {
                setSchoolThresholdSuccess(false)
                setSchoolThresholdError('')
                setSchoolThreshold(event.target.value)
              }}
              placeholder={thresholdLoading ? 'Loading...' : `Company default: ${companyOverdueThreshold}`}
              className="w-full px-3 py-2 border rounded disabled:bg-gray-50 disabled:text-gray-400"
              disabled={thresholdLoading || schoolThresholdSaving}
            />
            <p className="text-xs text-gray-400 mt-1">
              Company-wide default: {companyOverdueThreshold} minute{companyOverdueThreshold === 1 ? '' : 's'}
              {schoolThreshold === '' ? ' (currently in use)' : ''}
            </p>

            {schoolThresholdError && (
              <p className="text-xs text-red-600 mt-1">{schoolThresholdError}</p>
            )}
            {schoolThresholdSuccess && (
              <p className="text-xs text-green-600 mt-1">Saved.</p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleSaveSchoolThreshold}
                disabled={schoolThresholdSaving || thresholdLoading}
                className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {schoolThresholdSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleResetSchoolThreshold}
                disabled={schoolThresholdSaving || thresholdLoading || schoolThreshold === ''}
                className="px-3 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Reset to company default
              </button>
            </div>
           <div className="mt-6 pt-5 border-t border-gray-200">
          <label className="block text-xs text-gray-600 mb-1">
            Resolved incident retention period (days)
          </label>

          <p className="text-xs text-gray-400 mb-2">
            Resolved incidents older than this will be moved to the archive automatically.
            Archived records are never deleted.
          </p>

          <input
            type="number"
            min={1}
            max={365}
            value={thresholdLoading ? '' : retentionDays}
            onChange={event => {
              setThresholdSuccess(false)
              setThresholdError('')
              setRetentionDays(event.target.value)
            }}
            placeholder={thresholdLoading ? 'Loading...' : '30'}
            className="w-full px-3 py-2 border rounded disabled:bg-gray-50 disabled:text-gray-400"
            disabled={thresholdLoading || thresholdSaving}
          />

          {thresholdError && (
            <p className="text-xs text-red-600 mt-1">{thresholdError}</p>
          )}

          {thresholdSuccess && (
            <p className="text-xs text-green-600 mt-1">Settings saved.</p>
          )}

          <div className="mt-4">
            <button
              onClick={handleSaveGlobalSettings}
              disabled={thresholdSaving || thresholdLoading}
              className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {thresholdSaving ? 'Saving...' : 'Save retention period'}
            </button>
          </div>
        </div>
      </div>

          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Alert Recipients</h2>
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">School Admin</span>
          </div>
          <p className="text-sm text-gray-500 mb-2">Choose who should receive each alert type at your school.</p>
          

          {loadingRouting && <p className="text-sm text-gray-400 mb-4">Loading...</p>}
          {routingError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{routingError}</p>}

          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Emergency Type</label>
            <AlertTypeSelect
              types={alertTypeOptions}
              value={selectedEmergencyType}
              onChange={setSelectedEmergencyType}
              placeholder="Select an emergency type"
              disabled={loadingRouting}
            />
            {!loadingRouting && (
              <p className="text-xs text-gray-400 mt-1">
                {alertTypeOptions.length === 0
                  ? 'No alert types configured yet. A Company Admin adds them under Alert Types.'
                  : `${alertTypeOptions.length} alert type${alertTypeOptions.length !== 1 ? 's' : ''} configured by the Company Admin.`}
              </p>
            )}
          </div>

          {selectedEmergencyType && (() => {
            const type = alertTypeOptions.find(item => item.value === selectedEmergencyType)
            if (!type) return null

            const recipients = getRecipients(type.value)
            const isSaving = savingRouting[type.value]
            const status = saveStatus[type.value]

            return (
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{type.icon}</span>
                    <h3 className="font-semibold text-gray-900">{type.label}</h3>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      type.category === 'emergency' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {type.category === 'emergency' ? 'Emergency' : 'General'}
                    </span>
                    <span className="text-xs text-gray-400">{recipients.length} recipient{recipients.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSaving && <span className="text-xs text-gray-400">Saving...</span>}
                    {status === 'saved' && <span className="text-xs text-green-600">Saved</span>}
                    {status === 'error' && <span className="text-xs text-red-600">Failed to save</span>}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Current Recipients</p>
                  {recipients.length === 0 ? (
                    <p className="text-xs text-gray-400">No recipients yet. Add from school users below.</p>
                  ) : (
                    <div className="space-y-2">
                      {recipients.map((recipient, index) => (
                        <div key={`${recipient.email || recipient.phone || recipient.name}-${index}`} className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{recipient.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-gray-400">{formatRole(recipient.role)}</span>
                              {recipient.email && <span className="text-xs text-gray-400">Email: {recipient.email}</span>}
                              {recipient.phone && <span className="text-xs text-gray-400">Phone: {recipient.phone}</span>}
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                recipient.notify === 'both' ? 'bg-blue-100 text-blue-700' :
                                recipient.notify === 'sms' ? 'bg-green-100 text-green-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {recipient.notify === 'both' ? 'Email + SMS' : recipient.notify === 'sms' ? 'SMS' : 'Email'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveRecipient(type.value, index)}
                            className="text-xs text-gray-400 hover:text-red-600 shrink-0 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-medium text-gray-500 mb-2">Add from school users</p>
                  {schoolUsers.length === 0 ? (
                    <p className="text-xs text-gray-400">No other users found at your school.</p>
                  ) : (
                    <div className="space-y-2">
                      {schoolUsers.map(user => {
                        const alreadyAdded = recipients.some(
                          recipient => recipient.email?.toLowerCase() === user.email?.toLowerCase()
                        )
                        const notify = getNotifyPref(type.value, user.id)
                        const isEditingPhone = editingPhoneUserId === user.id
                        const isEditingEmail = editingEmailUserId === user.id

                        return (
                          <div key={user.id} className={`flex flex-col gap-2 px-3 py-2 rounded-lg border ${
                            alreadyAdded ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-transparent'
                          }`}>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800">{user.name}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-xs text-gray-400">{formatRole(user.role)}</span>
                                  {user.email && <span className="text-xs text-gray-400">Email: {user.email}</span>}
                                  {user.phone
                                    ? <span className="text-xs text-gray-400">Phone: {user.phone}</span>
                                    : <span className="text-xs text-amber-500">No phone</span>
                                  }
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                               <button
                                  onClick={() => isEditingPhone ? handleCancelEditPhone() : handleEditPhone(user)}
                                        className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors text-gray-600"
                                              >
                                {isEditingPhone ? 'Cancel' : '✏️ Phone'}
                                              </button>
                                <button
                                  onClick={() => isEditingEmail
                                    ? setEditingEmailUserId(null)
                                    : handleEditEmail(user)}
                                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 transition-colors text-gray-600"
                                >
                                  {isEditingEmail ? 'Cancel' : '✏️ Email'}
                                </button>
                                {alreadyAdded ? (
                                  <span className="text-xs text-green-600 font-medium">Added</span>
                                ) : (
                                  <>
                                    <select
                                      value={notify}
                                      onChange={event => setNotifyPref(type.value, user.id, event.target.value)}
                                      className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
                                    >
                                      <option value="email">Email</option>
                                      <option value="sms">SMS</option>
                                      <option value="both">Both</option>
                                    </select>
                                    <button
                                      onClick={() => handleAddUser(type.value, user)}
                                      className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
                                    >
                                      Add
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {isEditingPhone && (
                              <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
                                <input
                                  type="tel"
                                  value={editingPhoneValue}
                                  onChange={e => setEditingPhoneValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSavePhone(user.id) } }}
                                  placeholder="e.g. +61 400 000 000"
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
                                />
                                <button
                                  onClick={() => handleSavePhone(user.id)}
                                  disabled={savingPhone}
                                  className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors disabled:opacity-60"
                                >
                                  {savingPhone ? 'Saving...' : 'Save'}
                                </button>
                                {phoneError && (
                                  <span className="text-xs text-red-600">{phoneError}</span>
                                )}
                              </div>
                            )}
                            {isEditingEmail && (
                              <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
                                <input
                                  type="email"
                                  value={editingEmailValue}
                                  onChange={e => setEditingEmailValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveEmail(user.id) } }}
                                  placeholder="e.g. teacher@school.edu"
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
                                />
                                <button
                                  onClick={() => handleSaveEmail(user.id)}
                                  className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
                                >
                                  Save
                                </button>
                                {emailError && <span className="text-xs text-red-600">{emailError}</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
