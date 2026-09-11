import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SchoolsProvider } from './context/SchoolsContext'
import Analytics from './pages/Analytics'
import Dashboard from './pages/Dashboard'
import IncidentDetail from './pages/IncidentDetail'
import Incidents from './pages/Incidents'
import Login from './pages/Login'
import Notifications from './pages/Notifications'
import Setup from './pages/Setup'
import SubmitAlert from './pages/SubmitAlert'

// ── PrivateRoute ──────────────────────────────────────────────────────────────
// Blocks access to protected pages when the user is not authenticated.
// Shows a loading screen while Firebase resolves the initial auth state.
function PrivateRoute({ children }) {
  const { currentUser, authLoading } = useAuth()

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-red-600 rounded-xl mb-3">
            <span className="text-white text-xl">S</span>
          </div>
          <p className="text-sm text-gray-500 mt-2">Loading...</p>
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  return children
}

// ── PublicRoute ───────────────────────────────────────────────────────────────
// Redirects already-authenticated users away from the login page.
function PublicRoute({ children }) {
  const { currentUser, authLoading, isCompanyAdmin } = useAuth()

  if (authLoading) return null  // wait silently; PrivateRoute handles the spinner

  if (currentUser) {
    return <Navigate to={isCompanyAdmin ? '/setup' : '/dashboard'} replace />
  }

  return children
}

function SetupRoute({ children }) {
  const { isCompanyAdmin, isSchoolAdmin } = useAuth()

  if (!isCompanyAdmin && !isSchoolAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

function SubmitRoute({ children }) {
  const { isSchoolAdmin, isStaff, isCompanyAdmin, authLoading, userRole } = useAuth()

  if (authLoading || userRole === null) {
    return null
  }

  if (!isSchoolAdmin && !isStaff && !isCompanyAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

// ── NotCompanyAdminRoute ──────────────────────────────────────────────────────
// Waits for the user's role to load before rendering. Company Admins are no
// longer redirected to /setup and can open these pages as well.
function NotCompanyAdminRoute({ children }) {
  const { authLoading, userRole } = useAuth()

  if (authLoading || userRole === null) {
    return null
  }

  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Public */}
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

      {/* Protected */}
      <Route path="/dashboard"       element={<PrivateRoute><NotCompanyAdminRoute><Layout><Dashboard /></Layout></NotCompanyAdminRoute></PrivateRoute>} />
      <Route path="/incidents"       element={<PrivateRoute><NotCompanyAdminRoute><Layout><Incidents /></Layout></NotCompanyAdminRoute></PrivateRoute>} />
      <Route path="/incidents/:id"   element={<PrivateRoute><NotCompanyAdminRoute><Layout><IncidentDetail /></Layout></NotCompanyAdminRoute></PrivateRoute>} />
      <Route path="/submit"          element={<PrivateRoute><SubmitRoute><Layout><SubmitAlert /></Layout></SubmitRoute></PrivateRoute>} />
      <Route path="/setup"           element={<PrivateRoute><SetupRoute><Layout><Setup /></Layout></SetupRoute></PrivateRoute>} />
      <Route path="/analytics"       element={<PrivateRoute><NotCompanyAdminRoute><Layout><Analytics /></Layout></NotCompanyAdminRoute></PrivateRoute>} />
      <Route path="/notifications"   element={<PrivateRoute><NotCompanyAdminRoute><Layout><Notifications /></Layout></NotCompanyAdminRoute></PrivateRoute>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      {/* Inside AuthProvider: the school list is role-scoped, so it can only be
          fetched once the signed-in user's role is known. */}
      <SchoolsProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SchoolsProvider>
    </AuthProvider>
  )
}

export default App
