require('dotenv').config()
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const helmet = require('helmet')

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
// Helmet — sets 15+ security headers automatically
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Disabled — handled by Vercel on frontend
}))
// ⚠️ Stripe webhook MUST be before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./controllers/stripeController').handleWebhook)

// ─── Rate limiting ────────────────────────────────────────────────────────────

// Global limit — all routes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per 15 mins per IP
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Strict limit — auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 mins
  message: { error: 'Too many login attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// AI limit — expensive Claude API calls
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 AI calls per hour per IP
  message: { error: 'Too many AI requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Admin limit
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many admin requests.' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use(globalLimiter)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ limit: '10mb', extended: true }))

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  next()
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Nooka API running' })
})

const authRoutes = require('./routes/auth')
const familyRoutes = require('./routes/family')
const pantryRoutes = require('./routes/pantry')
const groceryRoutes = require('./routes/grocery')
const reportsRoutes = require('./routes/reports')
const recipesRoutes = require('./routes/recipes')
const dashboardRoutes = require('./routes/dashboard')
const recallRoutes = require('./routes/recalls')
const mealPlanRoutes = require('./routes/mealplan')
const expiryRoutes = require('./routes/expiry')
const mealPatternRoutes = require('./routes/mealPattern')
const budgetForecastRoutes = require('./routes/budgetForecast')
const healthProgressRoutes = require('./routes/healthProgress')
const priceAnomalyRoutes = require('./routes/priceAnomaly')
const smartInsightsRoutes = require('./routes/smartInsights')
const stripeRoutes = require('./routes/stripe')
const savedRecipesRoutes = require('./routes/savedRecipes')
const adminRoutes = require('./routes/admin')
const publicRoutes = require('./routes/public')
const pantryToolsRoutes = require('./routes/pantryTools')
const healthTrackerRoutes = require('./routes/healthTracker')


app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/family', familyRoutes)
app.use('/api/pantry', pantryRoutes)
app.use('/api/grocery', groceryRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/recipes', aiLimiter, recipesRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/recalls', recallRoutes)
app.use('/api/mealplan', aiLimiter, mealPlanRoutes)
app.use('/api/expiry', expiryRoutes)
app.use('/api/meal-pattern', mealPatternRoutes)
app.use('/api/budget', budgetForecastRoutes)
app.use('/api/health', healthProgressRoutes)
app.use('/api/price', priceAnomalyRoutes)
app.use('/api/insights', smartInsightsRoutes)
app.use('/api/stripe', stripeRoutes)
app.use('/api/saved-recipes', savedRecipesRoutes)
app.use('/api/admin', adminLimiter, adminRoutes)
app.use('/api/app', publicRoutes)
app.use('/api/pantry-tools', aiLimiter, pantryToolsRoutes)
app.use('/api/health-tracker', healthTrackerRoutes)

app.use((err, req, res, next) => {
  // Only log full stack in development
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack)
  } else {
    console.error(`${err.message} — ${req.method} ${req.path}`)
  }

  // Never leak stack traces to client
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err.message || 'Something went wrong'
  })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Nooka API running on port ${PORT}`)
})

// Clean up expired tokens from denylist every 24 hours
const { cleanupDenylist } = require('./controllers/authController')
setInterval(cleanupDenylist, 24 * 60 * 60 * 1000)
cleanupDenylist() // Run on startup