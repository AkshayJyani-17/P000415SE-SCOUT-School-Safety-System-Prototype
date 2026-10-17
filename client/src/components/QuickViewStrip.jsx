
const REFRESH_DESCRIPTION =
  'Incident data is fetched when the dashboard opens. Reload the page to fetch the latest data.'

const TEST_ALERT_NOTE =
  'Test alerts are left out of this number, to match how Analytics reports them.'

function isActive(incident) {
  return incident.status !== 'archived' && incident.status !== 'resolved'
}

function isCreatedToday(incident) {
  if (!incident.createdAt) return false

  const incidentDate = new Date(incident.createdAt)
  if (Number.isNaN(incidentDate.getTime())) return false

  return incidentDate.toDateString() === new Date().toDateString()
}

// Drills are still worth seeing, they just must not be added into the headline
// number. Without this an admin who runs a drill sees nothing change at all and
// cannot tell whether it worked.
function testAlertCountNote(count) {
  if (!count) return null

  return `Plus ${count} test ${count === 1 ? 'alert' : 'alerts'}, not counted`
}

export default function QuickViewStrip({
  incidents,
  schoolName = 'All Schools',
}) {
  // Alerts sent from the Alert Testing page carry isTest. Analytics already
  // leaves them out of its figures, through excludeTestIncidents in
  // server/src/analyticsCache.js, so these counts have to do the same or the
  // two screens report different numbers for the same day.
  const realIncidents = incidents.filter(i => i.isTest !== true)
  const testIncidents = incidents.filter(i => i.isTest === true)

  const active = realIncidents.filter(isActive)

  const unacked = active.filter(
    i => i.status === 'triggered'
  ).length

  const critical = active.filter(
    i => i.priority === 'critical'
  ).length

  const incidentsToday = realIncidents.filter(isCreatedToday).length

  const activeTests = testIncidents.filter(isActive)
  const unackedTests = activeTests.filter(i => i.status === 'triggered').length
  const testsToday = testIncidents.filter(isCreatedToday).length

  const cards = [
    {
      title: 'Active Incidents',
      count: active.length,
      detail: `${critical} critical`,
      testNote: testAlertCountNote(activeTests.length),
      explanation:
        `Incidents that have not been resolved or archived. Critical incidents are those marked with critical priority. ${TEST_ALERT_NOTE}`,
      color: 'from-red-50 to-red-100 border-red-200',
      textColor: 'text-red-700',
    },
    {
      title: 'Unacknowledged',
      count: unacked,
      detail: 'Awaiting acknowledgement',
      testNote: testAlertCountNote(unackedTests),
      explanation:
        `Active incidents with triggered status that are waiting to be acknowledged. ${TEST_ALERT_NOTE}`,
      color: 'from-orange-50 to-orange-100 border-orange-200',
      textColor: 'text-orange-700',
    },
    {
      title: 'Incidents Created Today',
      count: incidentsToday,
      detail: 'New incident records today',
      testNote: testAlertCountNote(testsToday),
      explanation:
        `Number of incident records created today, based on their creation date. ${TEST_ALERT_NOTE}`,
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

            {card.testNote && (
              <p className="text-xs text-amber-700 mt-1">
                {card.testNote}
              </p>
            )}

            <p className="text-xs text-gray-600 mt-2">
              Source: Incident records
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
