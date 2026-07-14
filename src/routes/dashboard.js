const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getStats, getRecentActivity, getWasteSavings, getNudges, getTonightSuggestion } = require('../controllers/dashboardController')

router.get('/stats', auth, getStats)
router.get('/activity', auth, getRecentActivity)
router.get('/waste-savings', auth, getWasteSavings)
router.get('/nudges', auth, getNudges)
router.get('/tonight', auth, getTonightSuggestion)

module.exports = router