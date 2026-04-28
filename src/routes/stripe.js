const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  getSubscription
} = require('../controllers/stripeController')

// Webhook must use raw body — registered before json middleware in index.js
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook)

router.post('/checkout', auth, createCheckoutSession)
router.post('/portal', auth, createPortalSession)
router.get('/subscription', auth, getSubscription)

module.exports = router