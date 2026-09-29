import { useState } from 'react'
import { useSchools } from '../context/SchoolsContext'

export default function SchoolManagement() {
  const {
    allSchools,
    loading,
    error,
    createSchool,
    renameSchool,
    setSchoolActive,
  } = useSchools()

  const [newSchoolName, setNewSchoolName] = useState('')
  const [editingSchoolId, setEditingSchoolId] = useState(null)
  const [editSchoolName, setEditSchoolName] = useState('')
  const [busySchoolId, setBusySchoolId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')

  async function handleAddSchool() {
    const name = newSchoolName.trim()
    if (!name) {
      setFormError('School name is required.')
      return
    }

    setAdding(true)
    setFormError('')
    setMessage('')
    try {
      await createSchool(name)
      setNewSchoolName('')
      setMessage('School added successfully.')
    } catch (err) {
      setFormError(err.message || 'Failed to add school.')
    } finally {
      setAdding(false)
    }
  }

  async function handleRenameSchool(schoolId) {
    const name = editSchoolName.trim()
    if (!name) {
      setFormError('School name is required.')
      return
    }

    setBusySchoolId(schoolId)
    setFormError('')
    setMessage('')
    try {
      await renameSchool(schoolId, name)
      setEditingSchoolId(null)
      setEditSchoolName('')
      setMessage('School renamed successfully.')
    } catch (err) {
      setFormError(err.message || 'Failed to rename school.')
    } finally {
      setBusySchoolId(null)
    }
  }

  async function handleToggleSchool(school) {
    const activating = school.active === false
    if (!activating && !window.confirm(`Deactivate ${school.name}?`)) return

    setBusySchoolId(school.id)
    setFormError('')
    setMessage('')
    try {
      await setSchoolActive(school.id, activating)
      setMessage(`School ${activating ? 'activated' : 'deactivated'} successfully.`)
    } catch (err) {
      setFormError(err.message || 'Failed to update school.')
    } finally {
      setBusySchoolId(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">School Management</h1>
      <p className="text-sm text-gray-500 mt-2 mb-6">
        Add, rename, activate or deactivate schools used across SCOUT.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {formError && <p className="text-sm text-red-600 mb-3">{formError}</p>}
        {message && <p className="text-sm text-green-600 mb-3">{message}</p>}

        <div className="space-y-2 mb-5">
          {loading && allSchools.length === 0 && <p className="text-sm text-gray-400">Loading schools...</p>}
          {!loading && allSchools.length === 0 && <p className="text-sm text-gray-400">No schools yet.</p>}

          {allSchools.map(school => {
            const inactive = school.active === false
            const editing = editingSchoolId === school.id
            const busy = busySchoolId === school.id

            return (
              <div key={school.id} className={`flex items-center gap-2 p-3 rounded-lg ${inactive ? 'bg-gray-100' : 'bg-gray-50'}`}>
                {editing ? (
                  <>
                    <input
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                      value={editSchoolName}
                      onChange={event => setEditSchoolName(event.target.value)}
                    />
                    <button onClick={() => handleRenameSchool(school.id)} disabled={busy} className="px-3 py-1 bg-green-600 text-white text-xs rounded">
                      Save
                    </button>
                    <button onClick={() => setEditingSchoolId(null)} className="px-2 py-1 text-xs border border-gray-300 rounded">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {school.name}
                        {inactive && <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>}
                      </p>
                      <p className="text-xs text-gray-400">ID: {school.id}</p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingSchoolId(school.id)
                        setEditSchoolName(school.name || '')
                      }}
                      className="px-2 py-1 text-xs border border-gray-300 rounded"
                    >
                      Rename
                    </button>
                    <button onClick={() => handleToggleSchool(school)} disabled={busy} className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-60">
                      {busy ? 'Please wait...' : inactive ? 'Activate' : 'Deactivate'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <label className="text-sm font-medium text-gray-700">Add new school</label>
          <div className="flex gap-2 mt-2">
            <input
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
              placeholder="School name"
              value={newSchoolName}
              onChange={event => setNewSchoolName(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && handleAddSchool()}
            />
            <button onClick={handleAddSchool} disabled={adding} className="px-4 py-2 bg-red-600 text-white text-sm rounded disabled:opacity-50">
              {adding ? 'Adding...' : 'Add School'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            A school ID is created automatically. Deactivated schools are hidden from school dropdowns but their incident history is kept.
          </p>
        </div>
      </div>
    </div>
  )
}
