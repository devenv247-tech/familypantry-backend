const jwt = require('jsonwebtoken')
const prisma = require('../utils/prisma')

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Verify user exists and is admin
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    })

    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    if (!user.isAdmin) {
      return res.status(403).json({ error: 'Access denied — admin only' })
    }

    req.user = {
      userId: user.id,
      familyId: user.familyId,
      email: user.email,
      isAdmin: true
    }

    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}