const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getStats, getRecentActivity } = require('../controllers/dashboardController')

router.get('/stats', auth, getStats)
router.get('/activity', auth, getRecentActivity)

module.exports = router