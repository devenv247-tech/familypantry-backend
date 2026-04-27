require('dotenv').config()
const express = require('express')
const cors = require('cors')


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

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json())
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  next()
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'FamilyPantry API running' })
})


app.use('/api/auth', authRoutes)
app.use('/api/family', familyRoutes)
app.use('/api/pantry', pantryRoutes)
app.use('/api/grocery', groceryRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/recipes', recipesRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/recalls', recallRoutes)
app.use('/api/mealplan', mealPlanRoutes)
app.use('/api/expiry', expiryRoutes)
app.use('/api/meal-pattern', mealPatternRoutes)
app.use('/api/budget', budgetForecastRoutes)
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`FamilyPantry API running on port ${PORT}`)
})
