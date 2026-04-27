const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getBudgetForecast } = require('../controllers/budgetForecastController')

router.get('/forecast', auth, getBudgetForecast)

module.exports = router