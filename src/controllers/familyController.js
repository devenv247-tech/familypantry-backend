const prisma = require('../utils/prisma')
const crypto = require('crypto')
const { sendFamilyInvite } = require('../utils/email')

exports.getMembers = async (req, res) => {
  try {
    const members = await prisma.member.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { createdAt: 'asc' },
    })
    res.json(members)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch members' })
  }
}

exports.addMember = async (req, res) => {
  try {
    const { name, age, weight, weightUnit, height, goals, dietary, allergens } = req.body
    if (!name) return res.status(400).json({ error: 'Name is required' })
    const member = await prisma.member.create({
      data: {
        name,
        age: age ? parseInt(age) : null,
        weight: weight ? parseFloat(weight) : null,
        weightUnit: weightUnit || 'kg',
        height: height || null,
        goals: goals || null,
        dietary: dietary || null,
        allergens: allergens || null,
        role: 'Member',
        familyId: req.user.familyId,
      }
    })
    res.status(201).json(member)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add member' })
  }
}

exports.updateMember = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.member.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Member not found' })
    const { name, age, weight, weightUnit, height, goals, dietary, allergens } = req.body
    const member = await prisma.member.update({
      where: { id },
      data: {
        name,
        age: age ? parseInt(age) : null,
        weight: weight ? parseFloat(weight) : null,
        weightUnit: weightUnit || 'kg',
        height: height || null,
        goals: goals || null,
        dietary: dietary || null,
        allergens: allergens || null,
      }
    })
    res.json(member)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update member' })
  }
}

exports.deleteMember = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.member.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Member not found' })
    if (existing.role === 'Admin') {
      return res.status(400).json({ error: 'Cannot delete admin member' })
    }
    await prisma.member.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete member' })
  }
}

exports.inviteMember = async (req, res) => {
  try {
    const { id } = req.params
    const { email } = req.body
    const familyId = req.user.familyId

    if (!email) return res.status(400).json({ error: 'Email is required' })

    const member = await prisma.member.findFirst({ where: { id, familyId } })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    if (member.inviteAccepted) return res.status(400).json({ error: 'This member already has a login' })

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(400).json({ error: 'That email already has a Nooka account' })

    const token = crypto.randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await prisma.member.update({
      where: { id },
      data: { email, inviteToken: token, inviteExpiry: expiry, inviteAccepted: false }
    })

    const family = await prisma.family.findUnique({ where: { id: familyId } })
    await sendFamilyInvite(email, member.name, family.name, token)

    res.json({ success: true, message: 'Invite sent' })
  } catch (err) {
    console.error('inviteMember error:', err)
    res.status(500).json({ error: 'Failed to send invite' })
  }
}