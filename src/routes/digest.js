const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const prisma = require('../utils/prisma')
const { sendWeeklyDigest } = require('../jobs/weeklyDigest')

// Unsubscribe via token — no auth needed (clicked from email)
router.get('/unsubscribe', async (req, res) => {
  try {
    const { token } = req.query
    if (!token) return res.status(400).send('Invalid unsubscribe link.')

    const family = await prisma.family.findFirst({
      where: { unsubscribeToken: token }
    })

    if (!family) return res.status(404).send('Unsubscribe link not found.')

    await prisma.family.update({
      where: { id: family.id },
      data: { digestEnabled: false }
    })

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Unsubscribed — Nooka</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px 20px;background:#f9fafb">
        <div style="max-width:400px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb">
          <p style="font-size:40px;margin:0">✅</p>
          <h2 style="color:#111827;margin-top:16px">Unsubscribed</h2>
          <p style="color:#6b7280">You've been removed from Nooka's weekly digest emails.</p>
          <p style="color:#6b7280;font-size:13px">You can re-enable digest emails anytime in your account settings.</p>
          <a href="https://nooka.ca/app/settings" style="display:inline-block;margin-top:24px;background:#2563eb;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Go to settings</a>
        </div>
      </body>
      </html>
    `)
  } catch (err) {
    console.error('Unsubscribe error:', err)
    res.status(500).send('Something went wrong.')
  }
})

// Toggle digest from settings (requires auth)
router.put('/digest-preference', auth, async (req, res) => {
  try {
    const { enabled } = req.body
    await prisma.family.update({
      where: { id: req.user.familyId },
      data: { digestEnabled: enabled }
    })
    res.json({ success: true, digestEnabled: enabled })
  } catch (err) {
    console.error('Digest preference error:', err)
    res.status(500).json({ error: 'Failed to update preference' })
  }
})

// Manual trigger — admin only (for testing)
router.post('/digest/send-now', auth, async (req, res) => {
  try {
    await sendWeeklyDigest()
    res.json({ success: true, message: 'Digest sent' })
  } catch (err) {
    console.error('Manual digest error:', err)
    res.status(500).json({ error: 'Failed to send digest' })
  }
})

module.exports = router