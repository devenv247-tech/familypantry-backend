const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { registerToken, deregisterToken } = require('../controllers/pushController')

router.post('/register', auth, registerToken)
router.delete('/register', auth, deregisterToken)

module.exports = router
