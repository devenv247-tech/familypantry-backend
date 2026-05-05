const prisma = require('../utils/prisma')

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