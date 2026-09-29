import {
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  Settings,
  Siren,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { getIncidentById } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Layout({ children }) {
  const location = useLocation()
  const { currentUser, userRole, logout, isCompanyAdmin, isSchoolAdmin, isStaff } = useAuth()

  const [activeEmergency, setActiveEmergency] = useState(null)
  const [acknowledgedBy, setAcknowledgedBy] = useState([])

  useEffect(() => {
    const loadActiveEmergency = () => {
      const stored = localStorage.getItem('activeEmergency')
      if (!stored) {
        setActiveEmergency(null)
        setAcknowledgedBy([])
        return
      }

      try {
        const parsed = JSON.parse(stored)
        setActiveEmergency(parsed)
        setAcknowledgedBy(parsed.acknowledgedBy || [])
      } catch {
        localStorage.removeItem('activeEmergency')
      }
    }

    const handleStorage = event => {
      if (event.key === 'activeEmergency') {
        loadActiveEmergency()
      }
    }

    loadActiveEmergency()
    window.addEventListener('emergencyTriggered', loadActiveEmergency)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener('emergencyTriggered', loadActiveEmergency)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    if (!activeEmergency?.incidentId || acknowledgedBy.length > 0) return

    const interval = setInterval(async () => {
      try {
        const incident = await getIncidentById(activeEmergency.incidentId)
        const ackBy = incident?.acknowledgedBy || []
        if (ackBy.length > 0) {
          setAcknowledgedBy(ackBy)
          const stored = JSON.parse(localStorage.getItem('activeEmergency') || '{}')
          localStorage.setItem('activeEmergency', JSON.stringify({
            ...stored,
            acknowledgedBy: ackBy,
          }))
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Polling failed:', err)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [activeEmergency?.incidentId, acknowledgedBy.length])

  const dismissBanner = () => {
    localStorage.removeItem('activeEmergency')
    setActiveEmergency(null)
    setAcknowledgedBy([])
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  const navigationSections = [
    {
      title: 'SCOUT Setup / Config',
      visible: isCompanyAdmin || isSchoolAdmin,
      items: [
        { path: '/schools', label: 'School Management', icon: GraduationCap, visible: isCompanyAdmin },
        { path: '/setup', label: 'Setup', icon: Settings, visible: isCompanyAdmin || isSchoolAdmin },
        { path: '/submit', label: 'Alert Testing', icon: Siren, visible: isSchoolAdmin || isCompanyAdmin },
      ],
    },
    {
      title: 'Live Operations',
      visible: true,
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: true },
        { path: '/submit', label: 'Submit Alert', icon: PlusCircle, visible: isStaff || isCompanyAdmin },
        { path: '/incidents', label: 'Incidents', icon: ClipboardList, visible: isCompanyAdmin || isSchoolAdmin || isStaff },
      ],
    },
    {
      title: 'My Settings',
      visible: isStaff,
      items: [
        { path: '/my-quick-alerts', label: 'My Quick Alerts', icon: Zap, visible: isStaff },
      ],
    },
    {
      title: 'Data & Insights',
      visible: isSchoolAdmin || isCompanyAdmin,
      items: [
        { path: '/analytics', label: 'Analytics', icon: BarChart3, visible: isSchoolAdmin || isCompanyAdmin },
        { path: '/notifications', label: 'Notifications', icon: Bell, visible: isSchoolAdmin || isCompanyAdmin },
      ],
    },
  ]

  const isAcknowledged = acknowledgedBy.length > 0
  const firstAck = acknowledgedBy[0]
  const displayName = currentUser.displayName || currentUser._profileName || currentUser.name || currentUser.email

  return (
    <div className="flex h-screen bg-gray-50">

      {activeEmergency && (
        <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-3 flex items-center justify-between shadow-lg ${
          isAcknowledged ? 'bg-green-600' : 'bg-red-600'
        }`}>
          <div className="flex items-center gap-3">
            {isAcknowledged ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-white" aria-hidden="true" />
                <div>
                  <p className="text-white font-semibold text-sm">Help is on the way!</p>
                  <p className="text-white text-xs opacity-90">
                    {firstAck.name} acknowledged at {new Date(firstAck.acknowledgedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </>
            ) : (
              <>
                <Siren className="w-5 h-5 text-white animate-pulse" aria-hidden="true" />
                <div>
                  <p className="text-white font-semibold text-sm">
                    {activeEmergency.emergencyType} Emergency Alert Sent
                  </p>
                  <p className="text-white text-xs opacity-90">
                    Waiting for acknowledgement...
                  </p>
                </div>
              </>
            )}
          </div>
          <button
            onClick={dismissBanner}
            className="text-white text-xs opacity-75 hover:opacity-100 px-2 py-1 rounded hover:bg-white/20 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className={`w-56 bg-white border-r border-gray-200 flex flex-col ${activeEmergency ? 'mt-12' : ''}`}>
        <Link to="/dashboard" className="flex items-center gap-2 px-4 py-5 border-b border-gray-200">
          <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm">S</span>
          </div>
          <span className="font-bold text-gray-900">SCOUT</span>
        </Link>

        <nav className="flex-1 p-3 space-y-4">
          {navigationSections.map(section => {
            const visibleItems = section.items.filter(item => item.visible)
            if (visibleItems.length === 0) return null

            return (
              <div key={section.title}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {visibleItems.map(item => {
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                          location.pathname === item.path
                            ? 'bg-red-50 text-red-600 font-medium'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <div className="px-3 py-2 mb-1">
            <p className="text-sm font-medium text-gray-800 truncate mb-1">{displayName}</p>
            <div className="mb-1">
              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
                isCompanyAdmin
                  ? 'bg-red-100 text-red-700'
                  : isSchoolAdmin
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {userRole || currentUser.role}
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate">{currentUser.email}</p>
          </div>
          <button
            onClick={logout}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            Logout
          </button>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto ${activeEmergency ? 'mt-12' : ''}`}>
        {children}
      </div>

    </div>
  )
}
