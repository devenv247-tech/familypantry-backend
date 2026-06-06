const prisma = require('../utils/prisma')

// Helper: age in months from birthDate
const getAgeMonths = (birthDate) => {
  if (!birthDate) return null
  const birth = new Date(birthDate)
  const now = new Date()
  return (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
}

// Helper: stage from age in months
const getStage = (months) => {
  if (months === null) return null
  if (months < 6)  return { stage: 0, label: 'Breast milk / formula only',     texture: null }
  if (months < 7)  return { stage: 1, label: 'First iron-rich purées',          texture: 'smooth purée' }
  if (months < 9)  return { stage: 2, label: 'Mashed & lumpy textures',         texture: 'mashed' }
  if (months < 12) return { stage: 3, label: 'Soft finger foods',               texture: 'soft chunks' }
  if (months < 18) return { stage: 4, label: 'Most family foods',               texture: 'soft family food' }
  return              { stage: 5, label: 'Toddler table foods',                  texture: 'family table' }
}

// GET /api/baby/:memberId/profile
exports.getBabyProfile = async (req, res) => {
  try {
    const { memberId } = req.params
    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true },
      include: {
        allergenIntroductions: { orderBy: { introducedAt: 'asc' } },
        feedingLogs: { orderBy: { loggedAt: 'desc' }, take: 10 },
      }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    const months = getAgeMonths(member.birthDate)
    const stage = getStage(months)

    res.json({ member, ageMonths: months, ...stage })
  } catch (err) {
    console.error('getBabyProfile error:', err)
    res.status(500).json({ error: 'Failed to fetch baby profile' })
  }
}

// GET /api/baby/:memberId/allergens
exports.getAllergenIntroductions = async (req, res) => {
  try {
    const { memberId } = req.params
    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    const introductions = await prisma.allergenIntroduction.findMany({
      where: { memberId },
      orderBy: { introducedAt: 'asc' }
    })
    res.json(introductions)
  } catch (err) {
    console.error('getAllergenIntroductions error:', err)
    res.status(500).json({ error: 'Failed to fetch allergen introductions' })
  }
}

// POST /api/baby/:memberId/allergens
exports.logAllergenIntroduction = async (req, res) => {
  try {
    const { memberId } = req.params
    const { allergen, introducedAt, reaction, notes } = req.body
    if (!allergen) return res.status(400).json({ error: 'Allergen is required' })

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    const intro = await prisma.allergenIntroduction.upsert({
      where: { memberId_allergen: { memberId, allergen } },
      update: {
        introducedAt: introducedAt ? new Date(introducedAt) : new Date(),
        reaction: reaction || null,
        notes: notes || null,
      },
      create: {
        memberId,
        allergen,
        introducedAt: introducedAt ? new Date(introducedAt) : new Date(),
        reaction: reaction || null,
        notes: notes || null,
      }
    })
    res.status(201).json(intro)
  } catch (err) {
    console.error('logAllergenIntroduction error:', err)
    res.status(500).json({ error: 'Failed to log allergen introduction' })
  }
}

// DELETE /api/baby/:memberId/allergens/:allergen
exports.removeAllergenIntroduction = async (req, res) => {
  try {
    const { memberId, allergen } = req.params
    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    await prisma.allergenIntroduction.deleteMany({
      where: { memberId, allergen }
    })
    res.json({ success: true })
  } catch (err) {
    console.error('removeAllergenIntroduction error:', err)
    res.status(500).json({ error: 'Failed to remove allergen introduction' })
  }
}

// GET /api/baby/:memberId/feeding-log
exports.getFeedingLog = async (req, res) => {
  try {
    const { memberId } = req.params
    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    const logs = await prisma.feedingLog.findMany({
      where: { memberId },
      orderBy: { loggedAt: 'desc' }
    })
    res.json(logs)
  } catch (err) {
    console.error('getFeedingLog error:', err)
    res.status(500).json({ error: 'Failed to fetch feeding log' })
  }
}

// POST /api/baby/:memberId/feeding-log
exports.addFeedingLog = async (req, res) => {
  try {
    const { memberId } = req.params
    const { foodName, portionMl, portionG, texture, reaction, notes, loggedAt } = req.body
    if (!foodName) return res.status(400).json({ error: 'Food name is required' })

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    const log = await prisma.feedingLog.create({
      data: {
        memberId,
        foodName,
        portionMl: portionMl ? parseInt(portionMl) : null,
        portionG: portionG ? parseInt(portionG) : null,
        texture: texture || null,
        reaction: reaction || null,
        notes: notes || null,
        loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
      }
    })
    res.status(201).json(log)
  } catch (err) {
    console.error('addFeedingLog error:', err)
    res.status(500).json({ error: 'Failed to add feeding log entry' })
  }
}

// DELETE /api/baby/:memberId/feeding-log/:logId
exports.deleteFeedingLog = async (req, res) => {
  try {
    const { memberId, logId } = req.params
    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    await prisma.feedingLog.delete({ where: { id: logId } })
    res.json({ success: true })
  } catch (err) {
    console.error('deleteFeedingLog error:', err)
    res.status(500).json({ error: 'Failed to delete feeding log entry' })
  }
}