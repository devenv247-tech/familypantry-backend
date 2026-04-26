const jwt = require('jsonwebtoken')

module.exports = (req, res, next) => {
  try {
    let token = null

    // Try Authorization header
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
    req.user = decoded
    next()
  } catch (err) {
    console.error('Auth error:', err.message)
    return res.status(401).json({ error: 'Invalid token' })
  }
}