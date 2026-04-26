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
      family: { id: family.id, name: family.name },
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
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const token = generateToken({ userId: user.id, familyId: user.familyId, email })
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
      family: { id: user.family.id, name: user.family.name },
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