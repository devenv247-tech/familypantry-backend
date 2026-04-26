const jwt = require('jsonwebtoken')

module.exports = (req, res, next) => {
  const header = req.headers.authorization || req.headers.Authorization
  
  console.log('Auth header:', header ? 'present' : 'missing')
  console.log('All headers:', JSON.stringify(Object.keys(req.headers)))
  
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }
  
  const token = header.split(' ')[1]
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    console.error('JWT error:', err.message)
    res.status(401).json({ error: 'Invalid token' })
  }
}