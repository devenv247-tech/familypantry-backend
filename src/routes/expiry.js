const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { predictExpiry, getExpiringSoon, logItemRemoval } = require('../controllers/expiryController')

router.post('/predict', auth, predictExpiry)
router.get('/expiring-soon', auth, getExpiringSoon)
router.post('/log-removal', auth, logItemRemoval)

module.exports = router