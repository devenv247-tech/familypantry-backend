const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { register, login, deleteAccount, forgotPassword, resetPassword, updateAccount, logout, acceptInvite } = require('../controllers/authController')
const { validateRegister, validateLogin, validateForgotPassword, validateResetPassword } = require('../middleware/validate')

router.post('/register', register)
router.post('/login', login)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)
router.put('/account', auth, updateAccount)
router.delete('/account', auth, deleteAccount)
router.post('/logout', auth, logout)
router.post('/accept-invite', acceptInvite)

module.exports = router