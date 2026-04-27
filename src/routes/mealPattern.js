const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { logCookedMeal, getCookingHistory } = require('../controllers/mealPatternController')

router.post('/log', auth, logCookedMeal)
router.get('/history', auth, getCookingHistory)

module.exports = router