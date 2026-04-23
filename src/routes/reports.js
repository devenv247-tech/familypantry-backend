const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')

// Routes coming soon
router.get('/', auth, (req, res) => {
  res.json({ message: 'Route working' })
})

module.exports = router