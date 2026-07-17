const prisma = require('../utils/prisma')

const registerToken = async (req, res) => {
  try {
    const { token, platform } = req.body
    const userId = req.user.userId

    if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken[')) {
      return res.status(400).json({ error: 'Invalid push token' })
    }
    if (!platform || !['ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be ios or android' })
    }

    await prisma.pushToken.upsert({
      where: { token },
      update: { userId, platform, lastSeenAt: new Date() },
      create: { userId, token, platform },
    })

    res.json({ success: true })
  } catch (err) {
    console.error('registerToken error:', err)
    res.status(500).json({ error: 'Failed to register token' })
  }
}

const deregisterToken = async (req, res) => {
  try {
    const { token } = req.body
    const userId = req.user.userId
    if (!token) return res.status(400).json({ error: 'Token required' })

    await prisma.pushToken.deleteMany({ where: { token, userId } })
    res.json({ success: true })
  } catch (err) {
    console.error('deregisterToken error:', err)
    res.status(500).json({ error: 'Failed to deregister token' })
  }
}

module.exports = { registerToken, deregisterToken }
