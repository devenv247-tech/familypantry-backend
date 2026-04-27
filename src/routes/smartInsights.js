const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getPantryCO2, getCostcoRecommendations, getItemCO2 } = require('../controllers/smartInsightsController')

router.get('/co2', auth, getPantryCO2)
router.get('/costco', auth, getCostcoRecommendations)
router.get('/co2/:itemName', auth, getItemCO2)

module.exports = router