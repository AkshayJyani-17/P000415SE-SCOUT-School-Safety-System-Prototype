import { auth } from '../firebase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

async function sendRequest(path, options, forceRefreshToken = false) {
  await auth.authStateReady?.()
  const token = await auth.currentUser?.getIdToken(forceRefreshToken)

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
}

// Helper function to make API requests and handle errors
async function request(path, options = {}) {
  let response = await sendRequest(path, options)

  if (response.status === 401 && auth.currentUser) {
    response = await sendRequest(path, options, true)
  }

  if (!response.ok) {
    let message = 'Request failed.'
    //tries to read the backend JSON error message
    try {
      const payload = await response.json()
      message = payload.error || message
    } catch {
      // Keep the fallback message when the error response is not JSON.
    }

    throw new Error(message)
  }
  //204 means success but no content returned
  if (response.status === 204) {
    return null
  }
  //parse and return the JSON response body
  return response.json()
}

export const apiCall = request

export async function getIncidents() {
  const data = await request('/incidents')
  return data.incidents || []
}

export async function getIncidentById(id) {
  const data = await request(`/incidents/${id}`)
  return data.incident || null
}

export const incidentAPI = {
  create: data =>
    request('/incidents', { method: 'POST', body: JSON.stringify(data) }),
  previewRecipients: (type, schoolId) =>
    request(`/incidents/preview/recipients?${new URLSearchParams({ type, ...(schoolId ? { schoolId } : {}) })}`),
  list: () => request('/incidents').then(data => data.incidents ?? data),
  updateStatus: (id, status, extra = {}) =>
    request(`/incidents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, ...extra }) }),
  setReviewFlag: (id, reviewRequired, comment) =>
    request(`/incidents/${id}/review-flag`, { method: 'PATCH', body: JSON.stringify({ reviewRequired, comment }) }),
  addReviewComment: (id, comment) =>
    request(`/incidents/${id}/review-comment`, { method: 'POST', body: JSON.stringify({ comment }) }),
}

export const notificationsAPI = {
  list: () => request('/notifications').then(data => data.notifications ?? data),
}

// Schools are role-scoped by the backend: a Company Admin receives every
// school, everyone else receives only their own. The response also carries a
// `version` that increments on every change, which SchoolsContext uses to tell
// "nothing changed" from "changed" while polling.
export const schoolAPI = {
  list: ({ includeInactive = false } = {}) =>
    request(`/schools${includeInactive ? '?includeInactive=true' : ''}`)
      .then(data => ({ schools: data.schools ?? [], version: data.version ?? 0 })),
  get: id => request(`/schools/${encodeURIComponent(id)}`).then(data => data.school ?? null),
  create: name =>
    request('/schools', { method: 'POST', body: JSON.stringify({ name }) }).then(data => data.school),
  rename: (id, name) =>
    request(`/schools/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  setActive: (id, active) =>
    request(`/schools/${encodeURIComponent(id)}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }).then(data => data.school),
}


export const setupAPI = {
  // Alert types
  getAlertTypes: (category) => request(`/setup/alert-types${category ? `?category=${category}` : ''}`),
  createAlertType: data => request('/setup/alert-types', { method: 'POST', body: JSON.stringify(data) }),
  updateAlertType: (id, data) => request(`/setup/alert-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAlertType: id => request(`/setup/alert-types/${id}`, { method: 'DELETE' }),

  // Locations
  getLocations: () => request('/setup/locations'),
  createLocation: data => request('/setup/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id, data) => request(`/setup/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: id => request(`/setup/locations/${id}`, { method: 'DELETE' }),

  // Routing (School Admin)
  getRouting: () => request('/setup/routing'),
  updateRouting: (alertType, recipients) =>
    request(`/setup/routing/${encodeURIComponent(alertType)}`, {
      method: 'PUT',
      body: JSON.stringify({ recipients }),
    }),

  // School users (School Admin)
  getSchoolUsers: () => request('/setup/school-users'),
  updateSchoolUser: (uid, details) =>
    request(`/setup/school-users/${uid}`, { method: 'PATCH', body: JSON.stringify(details) }),
}


// `schoolId` is the Company Admin school filter. Omitting it (or passing 'all')
// returns every school; the backend pins a School Admin to their own school
// regardless of what is sent.
function analyticsQuery(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const analyticsAPI = {
  summary: (schoolId) => request(`/analytics/summary${analyticsQuery({ schoolId })}`),
  byType: (schoolId) => request(`/analytics/by-type${analyticsQuery({ schoolId })}`),
  statusBreakdown: (schoolId) => request(`/analytics/status-breakdown${analyticsQuery({ schoolId })}`),
  byLocation: (schoolId) => request(`/analytics/by-location${analyticsQuery({ schoolId })}`),
  thisWeek: (schoolId) => request(`/analytics/this-week${analyticsQuery({ schoolId })}`),
  responseTimeTrend: (schoolId) => request(`/analytics/response-time-trend${analyticsQuery({ schoolId })}`),
  all: (schoolId) => request(`/analytics/all${analyticsQuery({ schoolId })}`),
  trends: (range = 'week', schoolId) => request(`/analytics/trends${analyticsQuery({ range, schoolId })}`),
}

export const settingsAPI = {
  get: () => request('/settings'),
  update: (fields) =>
    request('/settings', {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),
  // School Admin: set the school's own overdue threshold, or pass null to clear the override.
  updateSchoolThreshold: (overdueThresholdMinutes) =>
    request('/settings/school-threshold', {
      method: 'PATCH',
      body: JSON.stringify({ overdueThresholdMinutes }),
    }),
}

export const archiveAPI = {
  trigger: () => request('/settings/archive', { method: 'POST' }),
  list: () => request('/incidents/archived').then(data => data.incidents ?? []),
}
