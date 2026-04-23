const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getRecalls, checkPantryMatches, getTodaysRecalls } = require('../controllers/recallController')

router.get('/', auth, getRecalls)
router.get('/check-pantry', auth, checkPantryMatches)
router.get('/recent', auth, getTodaysRecalls)

module.exports = router