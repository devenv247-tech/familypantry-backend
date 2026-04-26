const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { register, login, deleteAccount } = require('../controllers/authController')
const { register, login, deleteAccount, forgotPassword, resetPassword, updateAccount } = require('../controllers/authController')
const auth = require('../middleware/auth')

router.post('/register', register)
router.post('/login', login)
router.put('/account', auth, updateAccount)
router.delete('/account', auth, deleteAccount)

module.exports = router