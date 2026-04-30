const prisma = require('../utils/prisma')
const PANTRY_TEMPLATES = require('../utils/pantryTemplates')

exports.getTemplates = async (req, res) => {
  try {
    const templates = Object.entries(PANTRY_TEMPLATES).map(([key, template]) => ({
      id: key,
      name: template.name,
      icon: template.icon,
      description: template.description,
      itemCount: template.items.length,
    }))
    res.json(templates)
  } catch (err) {
    console.error('getTemplates error:', err)
    res.status(500).json({ error: 'Failed to get templates' })
  }
}

exports.applyTemplate = async (req, res) => {
  try {
    const { templateId } = req.body
    const familyId = req.user.familyId

    // Check plan
    const family = await prisma.family.findUnique({ where: { id: familyId } })
    if (family.plan === 'free') {
      return res.status(403).json({
        error: 'Family plan feature',
        message: 'Pantry templates are available on the Family plan ($7/mo).',
        limitReached: true
      })
    }

    const template = PANTRY_TEMPLATES[templateId]
    if (!template) {
      return res.status(404).json({ error: 'Template not found' })
    }

    // Get existing pantry items to avoid duplicates
    const existing = await prisma.pantryItem.findMany({
      where: { familyId },
      select: { name: true }
    })
    const existingNames = existing.map(i => i.name.toLowerCase())

    // Only add items that don't already exist
    const newItems = template.items.filter(
      item => !existingNames.includes(item.name.toLowerCase())
    )

    if (newItems.length === 0) {
      return res.json({
        success: true,
        added: 0,
        skipped: template.items.length,
        message: 'All template items already in your pantry!'
      })
    }

    // Add items in bulk
    await prisma.pantryItem.createMany({
      data: newItems.map(item => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        icon: item.icon,
        familyId,
      }))
    })

    res.json({
      success: true,
      added: newItems.length,
      skipped: template.items.length - newItems.length,
      message: `Added ${newItems.length} items from ${template.name} template!`
    })
  } catch (err) {
    console.error('applyTemplate error:', err)
    res.status(500).json({ error: 'Failed to apply template' })
  }
}