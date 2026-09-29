//loads values from .env into process.env
require('dotenv').config()


const express = require('express')
const cors = require('cors')

const { initFirebase } = require('./db/firebase')

const authRoutes = require('./routes/auth')
const incidentRoutes = require('./routes/incidents')
const notificationRoutes = require('./routes/notifications')
const analyticsRoutes = require('./routes/analytics')
const actionLogRoutes = require('./routes/actionLogs')
const settingsRoutes = require('./routes/settings')
const setupRoutes = require('./routes/setup')
const schoolRoutes = require('./routes/schools')
const quickAlertRoutes = require('./routes/quickAlerts')
const { runArchiveJob } = require('./archiver')
//app setup
const app = express()
const PORT = process.env.PORT || 5000

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'https://p000415-se-scout-school-safety-dash.vercel.app'],
  credentials: true,
}))
app.use(express.json())//parse JSON request bodies


// ── Initialise Firebase ───────────────────────────────────────────────────────
initFirebase()

// ── Demo seeding ──────────────────────────────────────────────────────────────
// Seeding is opt-in. It used to run on every startup, which meant a production
// boot wrote demo schools into the live database deleting the demo constants
// would not have helped while that was still happening.
//
// Enable locally with SEED_DEMO_DATA=true in server/.env, or run the seed
// scripts directly (npm run seed:demo). Against the emulator it always runs,
// because an emulator starts empty every time.
//
// The seed modules are required lazily so demo data is never even loaded into
// the process when seeding is off.
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const seedDemoDataEnabled = String(process.env.SEED_DEMO_DATA || '').toLowerCase() === 'true'
const isProduction = process.env.NODE_ENV === 'production'

if (useEmulator) {
  require('./db/seedEmulatorData')
    .seedEmulatorData()
    .catch(err => console.error('Failed to seed emulator data:', err))
} else if (seedDemoDataEnabled && !isProduction) {
  require('./db/seedDemoAnalytics')
    .seedDemoAnalyticsData()
    .catch(err => console.error('Failed to seed analytics:', err))
} else if (seedDemoDataEnabled && isProduction) {
  console.warn('⚠️  SEED_DEMO_DATA is set but ignored because NODE_ENV=production.')
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/incidents', incidentRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/action-logs', actionLogRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/setup', setupRoutes)
app.use('/api/schools', schoolRoutes)
app.use('/api/quick-alerts', quickAlertRoutes)
//simple route to check whether the backend is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})
//catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` })
})
//global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error.' })
})

// ── Archive job ───────────────────────────────────────────────────────────────
// Run once on startup, then every 24 hours
const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000
runArchiveJob().catch(err => console.error('[archiver] Startup run failed:', err))
setInterval(() => {
  runArchiveJob().catch(err => console.error('[archiver] Scheduled run failed:', err))
}, ARCHIVE_INTERVAL_MS)

// ── Start ─────────────────────────────────────────────────────────────────────
//start the server
app.listen(PORT, () => {
  console.log(`🚀 SCOUT backend running at http://localhost:${PORT}`)
  console.log(`   Health check: http://localhost:${PORT}/api/health`)
})
