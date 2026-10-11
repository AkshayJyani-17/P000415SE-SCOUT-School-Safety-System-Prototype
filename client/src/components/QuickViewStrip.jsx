
const REFRESH_DESCRIPTION =
  'Incident data is fetched when the dashboard opens. Reload the page to fetch the latest data.'

export default function QuickViewStrip({
  incidents,
  schoolName = 'All Schools',
}) {
  const active = incidents.filter(
    i => i.status !== 'archived' && i.status !== 'resolved'
  )

  const unacked = active.filter(
    i => i.status === 'triggered'
  ).length

  const critical = active.filter(
    i => i.priority === 'critical'
  ).length

  const incidentsToday = incidents.filter(i => {
    if (!i.createdAt) return false

    const incidentDate = new Date(i.createdAt)
    if (Number.isNaN(incidentDate.getTime())) return false

    return incidentDate.toDateString() === new Date().toDateString()
  }).length

  const cards = [
    {
      title: 'Active Incidents',
      count: active.length,
      detail: `${critical} critical`,
      explanation:
        'Incidents that have not been resolved or archived. Critical incidents are those marked with critical priority.',
      color: 'from-red-50 to-red-100 border-red-200',
      textColor: 'text-red-700',
    },
    {
      title: 'Unacknowledged',
      count: unacked,
      detail: 'Awaiting acknowledgement',
      explanation:
        'Active incidents with triggered status that are waiting to be acknowledged.',
      color: 'from-orange-50 to-orange-100 border-orange-200',
      textColor: 'text-orange-700',
    },
    {
      title: 'Incidents Created Today',
      count: incidentsToday,
      detail: 'New incident records today',
      explanation:
        'Number of incident records created today, based on their creation date.',
      color: 'from-blue-50 to-blue-100 border-blue-200',
      textColor: 'text-blue-700',
    },
  ]

  return (
    <section aria-label="Incident dashboard metrics" className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">
            Incident Overview
          </h2>
          <p className="text-xs text-gray-600">
            Source: Incident records · School: {schoolName}
          </p>
        </div>

        <span
          tabIndex={0}
          title={REFRESH_DESCRIPTION}
          aria-label={`Data refresh information: ${REFRESH_DESCRIPTION}`}
          className="text-xs text-gray-600 cursor-help"
        >
          ⓘ Refresh information
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map(card => (
          <div
            key={card.title}
            className={`bg-gradient-to-br ${card.color} border rounded-lg p-4`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3
                className={`text-xs font-semibold uppercase ${card.textColor}`}
              >
                {card.title}
              </h3>

              <span
                tabIndex={0}
                title={card.explanation}
                aria-label={`${card.title}: ${card.explanation}`}
                className="text-xs cursor-help"
              >
                ⓘ
              </span>
            </div>

            <div className={`text-3xl font-bold ${card.textColor}`}>
              {card.count}
            </div>

            <p className={`text-xs mt-1 ${card.textColor}`}>
              {card.detail}
            </p>

            <p className="text-xs text-gray-600 mt-2">
              Source: Incident records
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
