const prisma = require('../utils/prisma')

exports.getItems = async (req, res) => {
  try {
    const items = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch pantry items' })
  }
}

exports.addItem = async (req, res) => {
  try {
    const { name, quantity, unit, category, expiry, icon } = req.body
    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' })
    }
    const item = await prisma.pantryItem.create({
      data: {
        name,
        quantity: parseFloat(quantity) || 0,
        unit: unit || 'pcs',
        category,
        expiry: expiry || null,
        icon: icon || '🛒',
        familyId: req.user.familyId,
      }
    })
    res.status(201).json(item)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add item' })
  }
}

exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.pantryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    const { name, quantity, unit, category, expiry, icon } = req.body
    const item = await prisma.pantryItem.update({
      where: { id },
      data: {
        name,
        quantity: parseFloat(quantity) || 0,
        unit: unit || 'pcs',
        category,
        expiry,
        icon,
      }
    })
    res.json(item)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update item' })
  }
}

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.pantryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    await prisma.pantryItem.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete item' })
  }
}

exports.subtractIngredients = async (req, res) => {
  try {
    const { ingredients } = req.body
    const results = []
    for (const ing of ingredients) {
      const item = await prisma.pantryItem.findFirst({
        where: {
          familyId: req.user.familyId,
          name: { contains: ing.name, mode: 'insensitive' }
        }
      })
      if (item) {
        const newQty = Math.max(0, item.quantity - (parseFloat(ing.quantity) || 0))
        const updated = await prisma.pantryItem.update({
          where: { id: item.id },
          data: { quantity: newQty }
        })
        results.push({ name: ing.name, updated: true, remaining: newQty, unit: updated.unit })
      } else {
        results.push({ name: ing.name, updated: false, reason: 'Not found in pantry' })
      }
    }
    res.json({ success: true, results })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to subtract ingredients' })
  }
}
exports.restockItem = async (req, res) => {
  try {
    const { id } = req.params
    const { quantity } = req.body

    const existing = await prisma.pantryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })

    if (!existing) return res.status(404).json({ error: 'Item not found' })

    const updated = await prisma.pantryItem.update({
      where: { id },
      data: {
        quantity: existing.quantity + parseFloat(quantity),
      }
    })

    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to restock item' })
  }
}