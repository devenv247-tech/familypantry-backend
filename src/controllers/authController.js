const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')


const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' })
}
const prisma = require('../utils/prisma')
exports.register = async (req, res) => {
  try {
    const { familyName, name, email, password } = req.body
    if (!familyName || !name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' })
    }
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' })
    }
    const hashedPassword = await bcrypt.hash(password, 12)
    const family = await prisma.family.create({
      data: { name: familyName }
    })
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: 'admin',
        familyId: family.id,
      }
    })
    const member = await prisma.member.create({
      data: {
        name,
        familyId: family.id,
        role: 'Admin',
      }
    })
    const token = generateToken({ userId: user.id, familyId: family.id, email })
    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
      family: { id: family.id, name: family.name, plan: family.plan },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Registration failed' })
  }
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { family: true }
    })

    if (!user) {
      // Don't reveal if email exists
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil - new Date()) / 60000)
      return res.status(423).json({
        error: `Account temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`
      })
    }

    const valid = await bcrypt.compare(password, user.password)

    if (!valid) {
      // Increment failed attempts
      const attempts = (user.loginAttempts || 0) + 1
      const MAX_ATTEMPTS = 5

      if (attempts >= MAX_ATTEMPTS) {
        // Lock account for 15 minutes
        const lockedUntil = new Date(Date.now() + 15 * 60 * 1000)
        await prisma.user.update({
          where: { email },
          data: { loginAttempts: attempts, lockedUntil }
        })
        return res.status(423).json({
          error: 'Too many failed attempts. Account locked for 15 minutes.'
        })
      }

      await prisma.user.update({
        where: { email },
        data: { loginAttempts: attempts }
      })

      const remaining = MAX_ATTEMPTS - attempts
      return res.status(401).json({
        error: `Invalid email or password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining before lockout.`
      })
    }

    // Successful login — reset attempts and lock
    await prisma.user.update({
      where: { email },
      data: { loginAttempts: 0, lockedUntil: null }
    })

    const token = generateToken({ userId: user.id, familyId: user.familyId, email })
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
      family: { id: user.family.id, name: user.family.name, plan: user.family.plan },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Login failed' })
  }
}
exports.deleteAccount = async (req, res) => {
  try {
    const { userId, familyId } = req.user

    // Delete everything related to this family in order
    await prisma.groceryItem.deleteMany({ where: { familyId } })
    await prisma.pantryItem.deleteMany({ where: { familyId } })
    await prisma.member.deleteMany({ where: { familyId } })
    await prisma.user.deleteMany({ where: { familyId } })
    await prisma.family.delete({ where: { id: familyId } })

    res.json({ success: true, message: 'Account permanently deleted' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete account' })
  }
}

exports.updateAccount = async (req, res) => {
  try {
    const { userId, familyId } = req.user
    const { name, email, familyName, password } = req.body

    // Update user
    const updateData = {}
    if (name) updateData.name = name
    if (email) updateData.email = email
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' })
      }
      updateData.password = await bcrypt.hash(password, 12)
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    })

    // Update family name if provided
    if (familyName) {
      await prisma.family.update({
        where: { id: familyId },
        data: { name: familyName },
      })
    }

    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
      family: familyName ? { name: familyName } : undefined,
    })
  } catch (err) {
    console.error(err)
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Email already in use' })
    }
    res.status(500).json({ error: 'Failed to update account' })
  }
}
const crypto = require('crypto')

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email is required' })

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent' })
    }

  const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenExpiry = new Date(Date.now() + 3600000)

    // Hash the token before storing — plain token goes to user, hash goes to DB
    const hashedToken = await bcrypt.hash(resetToken, 10)

    await prisma.user.update({
      where: { email },
      data: { resetToken: hashedToken, resetTokenExpiry }
    })

    // In production this token is emailed to the user via SendGrid
    // Only log in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] Reset token for ${email}: ${resetToken}`)
    }

    res.json({ success: true, message: 'If that email exists, a reset link has been sent', devToken: process.env.NODE_ENV === 'production' ? undefined : resetToken })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to send reset email' })
  }
}

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' })
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })

    // Find users with non-expired tokens and verify hash
    const users = await prisma.user.findMany({
      where: {
        resetToken: { not: null },
        resetTokenExpiry: { gt: new Date() }
      }
    })

    // Find the user whose hashed token matches
    let user = null
    for (const u of users) {
      if (u.resetToken) {
        const matches = await bcrypt.compare(token, u.resetToken)
        if (matches) {
          user = u
          break
        }
      }
    }

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' })

    const hashedPassword = await bcrypt.hash(password, 12)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      }
    })

    res.json({ success: true, message: 'Password reset successfully' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to reset password' })
  }
}
exports.logout = async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ success: true })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Store token in denylist until it expires
    await prisma.tokenDenylist.create({
      data: {
        token,
        expiresAt: new Date(decoded.exp * 1000),
      }
    })

    res.json({ success: true, message: 'Logged out successfully' })
  } catch (err) {
    // Even if token is invalid, logout succeeds
    res.json({ success: true })
  }
}

// Clean up expired tokens from denylist (run periodically)
exports.cleanupDenylist = async () => {
  try {
    const result = await prisma.tokenDenylist.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    })
    console.log(`Cleaned up ${result.count} expired tokens from denylist`)
  } catch (err) {
    console.error('Denylist cleanup error:', err)
  }
}