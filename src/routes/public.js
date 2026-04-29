const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getAppConfig } = require('../controllers/publicController')

router.get('/config', auth, getAppConfig)

module.exports = router