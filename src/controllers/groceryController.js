const prisma = require('../utils/prisma')

exports.getItems = async (req, res) => {
  try {
    const items = await prisma.groceryItem.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch grocery items' })
  }
}

exports.addItem = async (req, res) => {
  try {
    const { name, qty, store, price, category } = req.body
    if (!name) return res.status(400).json({ error: 'Name is required' })
    const item = await prisma.groceryItem.create({
      data: {
        name,
        qty: qty || '',
        store: store || '',
        price: price || '',
        category: category || '',
        checked: false,
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
    const existing = await prisma.groceryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    const item = await prisma.groceryItem.update({
      where: { id },
      data: req.body,
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
    const existing = await prisma.groceryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    await prisma.groceryItem.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete item' })
  }
}

exports.clearChecked = async (req, res) => {
  try {
    await prisma.groceryItem.deleteMany({
      where: { familyId: req.user.familyId, checked: true }
    })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to clear checked items' })
  }
}