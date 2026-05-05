const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const prisma = require('../utils/prisma')
const { getAppConfig } = require('../controllers/publicController')

// Public — no auth — used by landing page for pricing cards
router.get('/config/public', async (req, res) => {
  try {
    const flags = await prisma.featureFlag.findMany({
      where: { enabled: true },
      select: { name: true, description: true, requiredPlan: true }
    })
    res.json({ flags })
  } catch (err) {
    console.error('Public config error:', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// Private — requires auth — used by the app itself
router.get('/config', auth, getAppConfig)

module.exports = router