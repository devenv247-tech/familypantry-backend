const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { recordPrice, checkPriceAnomaly, getPriceAlerts } = require('../controllers/priceAnomalyController')

router.post('/record', auth, recordPrice)
router.post('/check', auth, checkPriceAnomaly)
router.get('/alerts', auth, getPriceAlerts)

module.exports = router