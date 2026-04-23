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
    const { name, qty, category, expiry, icon } = req.body
    if (!name || !qty || !category) {
      return res.status(400).json({ error: 'Name, quantity and category are required' })
    }
    const item = await prisma.pantryItem.create({
      data: {
        name,
        qty,
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
    const { name, qty, category, expiry, icon } = req.body
    const existing = await prisma.pantryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    const item = await prisma.pantryItem.update({
      where: { id },
      data: { name, qty, category, expiry, icon }
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