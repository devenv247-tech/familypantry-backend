const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getStats, getRecentActivity, getWasteSavings } = require('../controllers/dashboardController')

router.get('/stats', auth, getStats)
router.get('/activity', auth, getRecentActivity)
router.get('/waste-savings', auth, getWasteSavings)

module.exports = router