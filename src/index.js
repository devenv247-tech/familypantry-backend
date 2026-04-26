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

app.get('/api/debug-token', (req, res) => {
  const jwt = require('jsonwebtoken')
  const header = req.headers['authorization'] || ''
  const token = header.replace('Bearer ', '')
  
  if (!token) return res.json({ error: 'no token' })
  
  try {
    const secret = process.env.JWT_SECRET
    const decoded = jwt.verify(token, secret)
    res.json({ 
      success: true, 
      decoded,
      secretLength: secret?.length,
      secretFirst5: secret?.substring(0, 5)
    })
  } catch (err) {
    res.json({ 
      error: err.message,
      secretLength: process.env.JWT_SECRET?.length,
      secretFirst5: process.env.JWT_SECRET?.substring(0, 5)
    })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/family', familyRoutes)
app.use('/api/pantry', pantryRoutes)
app.use('/api/grocery', groceryRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/recipes', recipesRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/recalls', recallRoutes)

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`FamilyPantry API running on port ${PORT}`)
})
