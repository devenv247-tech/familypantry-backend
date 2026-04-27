const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { logNutrition, getHealthProgress } = require('../controllers/healthProgressController')

router.post('/log', auth, logNutrition)
router.get('/progress', auth, getHealthProgress)

module.exports = router