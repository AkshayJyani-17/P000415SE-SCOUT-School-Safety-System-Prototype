import { useState } from 'react'

export default function SchoolAdminStatus({ incidents }) {
  // Captured once on mount so the "this week" window stays stable across re-renders
  const [now] = useState(() => Date.now())
  const active      = incidents.filter(i => i.status !== 'archived' && i.status !== 'resolved')
  const acknowledged = active.filter(i => i.status !== 'triggered')
  // Match analytics definition: no acknowledgedBy entries and not resolved/archived
  const unacked     = incidents.filter(i =>
    (!i.acknowledgedBy || i.acknowledgedBy.length === 0) &&
    i.status !== 'resolved' &&
    i.status !== 'archived'
  )
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const resolved = incidents.filter(i => {
    if (i.status !== 'resolved') return false
    const d = i.updatedAt ? new Date(i.updatedAt) : null
    return d && !Number.isNaN(d.getTime()) && d >= weekAgo
  })

  return (
    <div className="bg-gradient-to-r from-purple-50 to-purple-100 border border-purple-200 rounded-xl p-6 mb-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Your School's Safety Status</h2>
        <p className="text-sm text-gray-600">Quick overview of incidents managed by your school</p>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-purple-100">
          <div className="text-xs font-semibold text-purple-600 uppercase mb-2">Currently Active</div>
          <div className="text-2xl font-bold text-gray-900">{active.length}</div>
          <div className="text-xs text-gray-500 mt-1">incidents in progress</div>
        </div>
        
        <div className="bg-white rounded-lg p-4 border border-purple-100">
          <div className="text-xs font-semibold text-green-600 uppercase mb-2">Being Handled</div>
          <div className="text-2xl font-bold text-gray-900">{acknowledged.length}</div>
          <div className="text-xs text-gray-500 mt-1">staff responding</div>
        </div>
        
        <div className="bg-white rounded-lg p-4 border border-purple-100">
          <div className="text-xs font-semibold text-red-600 uppercase mb-2">Need Response</div>
          <div className="text-2xl font-bold text-gray-900">{unacked.length}</div>
          <div className="text-xs text-gray-500 mt-1">waiting for acknowledgement</div>
        </div>
        
        <div className="bg-white rounded-lg p-4 border border-purple-100">
          <div className="text-xs font-semibold text-blue-600 uppercase mb-2">Resolved This Week</div>
          <div className="text-2xl font-bold text-gray-900">{resolved.length}</div>
          <div className="text-xs text-gray-500 mt-1">handled successfully</div>
        </div>
      </div>
    </div>
  )
}
