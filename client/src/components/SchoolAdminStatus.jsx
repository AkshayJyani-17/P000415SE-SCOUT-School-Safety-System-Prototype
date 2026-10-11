import { useState } from 'react'

const REFRESH_DESCRIPTION =
  'Incident data is fetched when the dashboard opens. Reload the page to fetch the latest data.'

export default function SchoolAdminStatus({ incidents }) {
  const [now] = useState(() => Date.now())

  const active = incidents.filter(
    i => i.status !== 'archived' && i.status !== 'resolved'
  )

  const acknowledged = active.filter(
    i => i.status !== 'triggered'
  )

  const unacked = incidents.filter(
    i =>
      (!i.acknowledgedBy || i.acknowledgedBy.length === 0) &&
      i.status !== 'resolved' &&
      i.status !== 'archived'
  )

  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)

  const resolved = incidents.filter(i => {
    if (i.status !== 'resolved') return false
    const date = i.updatedAt ? new Date(i.updatedAt) : null
    return date && !Number.isNaN(date.getTime()) && date >= weekAgo
  })

  const cards = [
    {
      title: 'Currently Active',
      count: active.length,
      detail: 'Not resolved or archived',
      explanation:
        'Number of school incidents that have not been resolved or archived.',
      color: 'text-purple-600',
    },
    {
      title: 'Being Handled',
      count: acknowledged.length,
      detail: 'Acknowledged or in progress',
      explanation:
        'Active incidents whose status is no longer triggered.',
      color: 'text-green-600',
    },
    {
      title: 'Need Response',
      count: unacked.length,
      detail: 'Waiting for acknowledgement',
      explanation:
        'Incidents without acknowledgement records that are not resolved or archived.',
      color: 'text-red-600',
    },
    {
      title: 'Resolved in Last 7 Days',
      count: resolved.length,
      detail: 'Recently resolved incidents',
      explanation:
        'Resolved incidents with an update timestamp within the previous seven days.',
      color: 'text-blue-600',
    },
  ]

  return (
    <section
      aria-label="School safety metrics"
      className="bg-gradient-to-r from-purple-50 to-purple-100 border border-purple-200 rounded-xl p-6 mb-6"
    >
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Your School's Safety Status
        </h2>

        <p className="text-sm text-gray-600">
          Quick overview of incidents managed by your school
        </p>

        <p className="text-xs text-gray-600 mt-2">
          Source: Incident records · Category: Your School
        </p>

        <span
          tabIndex={0}
          title={REFRESH_DESCRIPTION}
          aria-label={`Data refresh information: ${REFRESH_DESCRIPTION}`}
          className="inline-block mt-2 text-xs text-gray-600 cursor-help"
        >
          ⓘ Refresh information
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(card => (
          <div
            key={card.title}
            className="bg-white rounded-lg p-4 border border-purple-100"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3
                className={`text-xs font-semibold uppercase ${card.color}`}
              >
                {card.title}
              </h3>

              <span
                tabIndex={0}
                title={card.explanation}
                aria-label={`${card.title}: ${card.explanation}`}
                className="text-xs text-gray-600 cursor-help"
              >
                ⓘ
              </span>
            </div>

            <div className="text-2xl font-bold text-gray-900">
              {card.count}
            </div>

            <p className="text-xs text-gray-500 mt-1">
              {card.detail}
            </p>

            <p className="text-xs text-gray-500 mt-2">
              Source: Incident records
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
