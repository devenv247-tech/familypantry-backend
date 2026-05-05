const jwt = require('jsonwebtoken')
const prisma = require('../utils/prisma')

module.exports = async (req, res, next) => {
  try {
    let token = null

    const authHeader = req.headers['authorization'] || req.headers['Authorization']
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const secret = process.env.JWT_SECRET
    if (!secret) {
      console.error('JWT_SECRET is not set!')
      return res.status(500).json({ error: 'Server configuration error' })
    }

    const decoded = jwt.verify(token, secret)

    // Check if token is in denylist (logged out)
    const denied = await prisma.tokenDenylist.findUnique({
      where: { token }
    })

    if (denied) {
      return res.status(401).json({ error: 'Token has been invalidated. Please log in again.' })
    }

    req.user = decoded
    next()
  } catch (err) {
    console.error('Auth error:', err.message)
    return res.status(401).json({ error: 'Invalid token' })
  }
}