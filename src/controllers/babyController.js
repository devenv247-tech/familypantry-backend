const prisma = require('../utils/prisma')
const Anthropic = require('@anthropic-ai/sdk')

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

// POST /api/baby/:memberId/recipe
exports.generateBabyRecipe = async (req, res) => {
  try {
    const { memberId } = req.params
    const { mealType } = req.body

    // Plan gate — Premium only
    const family = await prisma.family.findUnique({ where: { id: req.user.familyId } })
    if (!['premium'].includes(family.plan)) {
      return res.status(403).json({
        error: 'Premium plan required',
        message: 'Upgrade to Premium to generate baby-safe recipes.',
        limitReached: true,
      })
    }

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true },
      include: { allergenIntroductions: true }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    const months = getAgeMonths(member.birthDate)
    const stage = getStage(months)

    if (stage.stage === 0) {
      return res.status(400).json({ error: 'No solid food recipes for babies under 6 months. Breast milk or formula only.' })
    }

    // Get pantry
    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId }
    })
    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ') || 'basic pantry staples'

    // Already introduced allergens
    const introducedAllergens = member.allergenIntroductions.map(a => a.allergen).join(', ') || 'none yet'

    // Known allergen reactions to avoid
    const severeAllergens = member.allergenIntroductions
      .filter(a => a.reaction === 'severe')
      .map(a => a.allergen).join(', ') || 'none'

    const prompt = `You are a Canadian pediatric nutrition expert generating baby food recipes following Health Canada guidelines.

Baby details:
- Age: ${months} months old
- Feeding stage: Stage ${stage.stage} — ${stage.label}
- Texture level: ${stage.texture}
- Allergens already introduced: ${introducedAllergens}
- Allergens with SEVERE reaction (NEVER include): ${severeAllergens}
- Meal type requested: ${mealType || 'any'}
- Available pantry items: ${pantryList}

STRICT SAFETY RULES — NEVER VIOLATE:
1. NO honey for babies under 12 months (botulism risk) — ${months < 12 ? 'STRICTLY FORBIDDEN' : 'allowed'}
2. NO whole grapes, whole cherry tomatoes, whole blueberries — always halved or mashed
3. NO whole nuts or large nut pieces — smooth nut butters only if allergen introduced
4. NO hard raw vegetables (carrots, celery, apple chunks) — must be cooked soft
5. NO added salt or sugar
6. NO cow's milk as main drink under 12 months (in recipes as ingredient is fine if introduced)
7. NO unpasteurized cheese or honey-based products under 12 months
8. TEXTURE must match Stage ${stage.stage}: ${stage.texture}
9. NEVER include allergens that had severe reactions: ${severeAllergens || 'none'}
10. Portions appropriate for ${months}-month-old baby

Respond ONLY with a valid JSON object in this exact format:
{
  "name": "Recipe name",
  "icon": "single emoji",
  "stage": ${stage.stage},
  "ageRange": "${months} months+",
  "texture": "${stage.texture}",
  "time": "X mins",
  "portions": "X ice cube trays / X tbsp",
  "freezable": true or false,
  "ingredients": [
    { "name": "ingredient", "amount": "amount", "prep": "how to prepare e.g. steamed and mashed" }
  ],
  "steps": [
    "Step 1 instruction",
    "Step 2 instruction"
  ],
  "freezingTip": "How to freeze and reheat safely",
  "healthNote": "Key nutritional benefit for baby",
  "allergenNote": "Which allergens this contains if any",
  "safetyNote": "Any extra safety reminders"
}`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })

    const raw = response.content[0].text.replace(/```json|```/g, '').trim()
    const recipe = JSON.parse(raw)

    res.json(recipe)
  } catch (err) {
    console.error('generateBabyRecipe error:', err)
    res.status(500).json({ error: 'Failed to generate baby recipe' })
  }
}

// GET /api/baby/:memberId/report
exports.generatePediatricianReport = async (req, res) => {
  try {
    const { memberId } = req.params

    // Plan gate — Premium only
    const family = await prisma.family.findUnique({ where: { id: req.user.familyId } })
    if (family.plan !== 'premium') {
      return res.status(403).json({
        error: 'Premium plan required',
        message: 'Upgrade to Premium to export pediatrician reports.',
      })
    }

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId: req.user.familyId, isBaby: true },
      include: {
        allergenIntroductions: { orderBy: { introducedAt: 'asc' } },
        feedingLogs: { orderBy: { loggedAt: 'desc' }, take: 50 },
      }
    })
    if (!member) return res.status(404).json({ error: 'Baby member not found' })

    const months = getAgeMonths(member.birthDate)
    const stage = getStage(months)

    const PDFDocument = require('pdfkit')
    const doc = new PDFDocument({ margin: 50, size: 'A4' })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="nooka-report-${member.name.toLowerCase().replace(/\s+/g, '-')}.pdf"`)
    doc.pipe(res)

    // ── Header ──────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').text('Nooka — Pediatric Feeding Report', { align: 'center' })
    doc.fontSize(10).font('Helvetica').fillColor('#666').text(`Generated ${new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' })
    doc.moveDown(1.5)

    // ── Baby info ────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('Baby Information')
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb')
    doc.moveDown(0.5)

    const infoRows = [
      ['Name', member.name],
      ['Date of birth', member.birthDate ? new Date(member.birthDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not provided'],
      ['Age', months !== null ? `${months} months` : 'Unknown'],
      ['Current feeding stage', stage ? `Stage ${stage.stage} — ${stage.label}` : 'Unknown'],
      ['Texture level', stage?.texture || 'Unknown'],
      ['Report date', new Date().toLocaleDateString('en-CA')],
    ]

    infoRows.forEach(([label, value]) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151').text(label + ':', { continued: true, width: 180 })
      doc.font('Helvetica').fillColor('#000').text('  ' + value)
    })

    doc.moveDown(1.5)

    // ── Allergen introductions ───────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('Allergen Introduction History')
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb')
    doc.moveDown(0.5)

    if (member.allergenIntroductions.length === 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#666').text('No allergen introductions recorded yet.')
    } else {
      // Table header
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151')
      doc.text('Allergen', 50, doc.y, { width: 120 })
      doc.text('Date Introduced', 170, doc.y - doc.currentLineHeight(), { width: 130 })
      doc.text('Reaction', 300, doc.y - doc.currentLineHeight(), { width: 100 })
      doc.text('Notes', 400, doc.y - doc.currentLineHeight(), { width: 145 })
      doc.moveDown(0.3)
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb')
      doc.moveDown(0.3)

      member.allergenIntroductions.forEach((intro, i) => {
        const reactionLabel = intro.reaction === 'none' ? 'No reaction' : intro.reaction === 'mild' ? 'Mild reaction' : intro.reaction === 'severe' ? 'SEVERE' : intro.reaction || '—'
        const reactionColor = intro.reaction === 'severe' ? '#dc2626' : intro.reaction === 'mild' ? '#d97706' : '#16a34a'
        const y = doc.y
        doc.fontSize(9).font('Helvetica').fillColor('#000').text(intro.allergen, 50, y, { width: 120 })
        doc.text(new Date(intro.introducedAt).toLocaleDateString('en-CA'), 170, y, { width: 130 })
        doc.fillColor(reactionColor).text(reactionLabel, 300, y, { width: 100 })
        doc.fillColor('#666').text(intro.notes || '—', 400, y, { width: 145 })
        doc.moveDown(0.5)
        if (i < member.allergenIntroductions.length - 1) {
          doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#f3f4f6')
        }
      })
    }

    doc.moveDown(1.5)

    // ── Feeding log ──────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('Recent Feeding Log (last 50 entries)')
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb')
    doc.moveDown(0.5)

    if (member.feedingLogs.length === 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#666').text('No feeding entries recorded yet.')
    } else {
      // Table header
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151')
      doc.text('Date', 50, doc.y, { width: 100 })
      doc.text('Food', 150, doc.y - doc.currentLineHeight(), { width: 130 })
      doc.text('Texture', 280, doc.y - doc.currentLineHeight(), { width: 90 })
      doc.text('Reaction', 370, doc.y - doc.currentLineHeight(), { width: 90 })
      doc.text('Notes', 460, doc.y - doc.currentLineHeight(), { width: 85 })
      doc.moveDown(0.3)
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb')
      doc.moveDown(0.3)

      member.feedingLogs.forEach((log, i) => {
        // Page break if needed
        if (doc.y > 720) {
          doc.addPage()
          doc.moveDown(1)
        }
        const reactionLabel = log.reaction === 'none' ? 'No reaction' : log.reaction === 'mild' ? 'Mild' : log.reaction === 'severe' ? 'SEVERE' : log.reaction || '—'
        const reactionColor = log.reaction === 'severe' ? '#dc2626' : log.reaction === 'mild' ? '#d97706' : '#16a34a'
        const y = doc.y
        doc.fontSize(9).font('Helvetica').fillColor('#000')
        doc.text(new Date(log.loggedAt).toLocaleDateString('en-CA'), 50, y, { width: 100 })
        doc.text(log.foodName, 150, y, { width: 130 })
        doc.fillColor('#666').text(log.texture || '—', 280, y, { width: 90 })
        doc.fillColor(reactionColor).text(reactionLabel, 370, y, { width: 90 })
        doc.fillColor('#666').text(log.notes || '—', 460, y, { width: 85 })
        doc.moveDown(0.5)
        if (i < member.feedingLogs.length - 1) {
          doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#f3f4f6')
        }
      })
    }

    doc.moveDown(2)

    // ── Footer ───────────────────────────────────────────────
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e5e7eb')
    doc.moveDown(0.5)
    doc.fontSize(8).font('Helvetica').fillColor('#9ca3af')
      .text('Generated by Nooka — AI-powered meal planning for Canadian families — nooka.ca', { align: 'center' })
    doc.text('This report is for informational purposes only. Always consult your pediatrician or public health nurse for medical advice.', { align: 'center' })

    doc.end()
  } catch (err) {
    console.error('generatePediatricianReport error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate report' })
    }
  }
}