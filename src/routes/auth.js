const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { register, login, deleteAccount, forgotPassword, resetPassword, updateAccount } = require('../controllers/authController')

router.post('/register', register)
router.post('/login', login)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)
router.put('/account', auth, updateAccount)
router.delete('/account', auth, deleteAccount)

module.exports = router