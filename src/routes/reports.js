const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getReports, getAISavingsTips } = require('../controllers/reportsController')

router.get('/', auth, getReports)
router.get('/tips', auth, getAISavingsTips)

module.exports = router