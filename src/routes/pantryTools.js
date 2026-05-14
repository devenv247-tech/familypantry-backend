const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { scanPantryPhoto, getScanStatus, scanRateLimit } = require('../controllers/pantryScanController')
const { getTemplates, applyTemplate } = require('../controllers/pantryTemplateController')

router.post('/scan', auth, scanRateLimit, scanPantryPhoto)
router.get('/scan-status', auth, getScanStatus)
router.get('/templates', auth, getTemplates)
router.post('/templates/apply', auth, applyTemplate)

module.exports = router