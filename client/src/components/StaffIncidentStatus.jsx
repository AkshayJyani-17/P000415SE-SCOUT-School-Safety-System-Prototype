import { Link } from 'react-router-dom'

const statuses = {
  triggered: ['Triggered', 'Awaiting acknowledgement.', 'bg-red-100 text-red-800'],
  acknowledged: ['Acknowledged', 'The alert has been acknowledged.', 'bg-blue-100 text-blue-800'],
  'in-progress': ['In progress', 'A response is underway.', 'bg-purple-100 text-purple-800'],
  resolved: ['Resolved', 'The incident has been resolved.', 'bg-green-100 text-green-800'],
  archived: ['Archived', 'The incident has been archived.', 'bg-gray-100 text-gray-700'],
}

export default function StaffIncidentStatus({ incidents, connection }) {
  const sorted = [...incidents].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  const active = sorted.filter(item => !['resolved', 'archived'].includes(item.status))
  const completed = sorted.filter(item => ['resolved', 'archived'].includes(item.status)).slice(0, 10)
  return (
    <section aria-labelledby="incident-status-heading" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 id="incident-status-heading" className="font-semibold text-gray-900">My incident status</h2>
        <p role="status" className="text-xs text-gray-600">
          {connection === 'live' ? 'Live updates connected' : connection === 'error'
            ? 'Updates disconnected. Displayed statuses may be out of date. Reconnecting…'
            : 'Connecting to live updates…'}
        </p>
      </div>
      <p className="text-sm text-gray-600 mb-3">{active.length} active · All active incidents and your 10 most recent completed incidents.</p>
      {!sorted.length && <p className="p-5 bg-white border rounded-xl text-sm text-gray-600">
        {connection === 'error' ? 'Unable to load incident status. Retrying automatically…' : 'No incidents to track yet.'}
      </p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {[...active, ...completed].map(incident => {
          const [label, description, color] = statuses[incident.status] || ['Unknown', 'Status unavailable.', 'bg-gray-100 text-gray-700']
          const actors = incident.status === 'in-progress' ? incident.inProgressBy : incident.status === 'acknowledged' ? incident.acknowledgedBy : []
          const updated = incident.updatedAt || incident.createdAt
          return (
            <article key={incident.id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link to={`/incidents/${incident.id}`} className="min-w-0 break-words font-semibold text-gray-900 underline decoration-gray-300 hover:text-blue-700">
                  {incident.incidentNumber && <span className="block text-xs text-gray-500">{incident.incidentNumber}</span>}
                  {incident.title}
                </Link>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{label}</span>
              </div>
              <p className="mt-2 text-sm text-gray-700 break-words">{incident.location} · {incident.priority} priority</p>
              <p className="mt-2 text-sm text-gray-700">{description}</p>
              {actors?.length > 0 && <p className="text-sm text-gray-600 break-words">Responders: {actors.map(actor => actor.name).filter(Boolean).join(', ')}</p>}
              {updated && !Number.isNaN(Date.parse(updated)) && <p className="mt-2 text-xs text-gray-500">Updated <time dateTime={updated}>{new Date(updated).toLocaleString()}</time></p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}
