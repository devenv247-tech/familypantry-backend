const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { register, login, deleteAccount } = require('../controllers/authController')

router.post('/register', register)
router.post('/login', login)
router.delete('/account', auth, deleteAccount)

module.exports = router