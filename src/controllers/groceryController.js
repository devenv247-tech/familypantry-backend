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
    const { name, qty, store, price, category, checked } = req.body

    // If item is being checked off mark as purchased with timestamp
    const purchaseData = {}
    if (checked === true && !existing.purchased) {
      purchaseData.purchased = true
      purchaseData.purchasedAt = new Date()
    }

    const item = await prisma.groceryItem.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(qty !== undefined && { qty }),
        ...(store !== undefined && { store }),
        ...(price !== undefined && { price }),
        ...(category !== undefined && { category }),
        ...(checked !== undefined && { checked }),
        ...purchaseData,
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

exports.getPredictions = async (req, res) => {
  try {
    const familyId = req.user.familyId

    const history = await prisma.groceryItem.findMany({
      where: { familyId, purchased: true, purchasedAt: { not: null } },
      orderBy: { purchasedAt: 'asc' },
    })

    const grouped = {}
    history.forEach(item => {
      const key = item.name.toLowerCase().trim()
      if (!grouped[key]) grouped[key] = { name: item.name, dates: [] }
      grouped[key].dates.push(new Date(item.purchasedAt))
    })

    const [currentGrocery, pantryItems] = await Promise.all([
      prisma.groceryItem.findMany({ where: { familyId, checked: false } }),
      prisma.pantryItem.findMany({ where: { familyId } }),
    ])

    const onGroceryList = new Set(currentGrocery.map(i => i.name.toLowerCase().trim()))
    const inPantry = new Set(pantryItems.map(i => i.name.toLowerCase().trim()))

    const predictions = []
    const now = new Date()

    Object.values(grouped).forEach(({ name, dates }) => {
      if (dates.length < 2) return

      let totalDays = 0
      for (let i = 1; i < dates.length; i++) {
        totalDays += (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24)
      }
      const avgIntervalDays = Math.round(totalDays / (dates.length - 1))
      if (avgIntervalDays <= 0) return

      const lastPurchase = dates[dates.length - 1]
      const nextPurchaseDate = new Date(lastPurchase.getTime() + avgIntervalDays * 24 * 60 * 60 * 1000)
      const daysUntilDue = Math.round((nextPurchaseDate - now) / (1000 * 60 * 60 * 24))

      const key = name.toLowerCase().trim()
      if (daysUntilDue <= 3 && !onGroceryList.has(key) && !inPantry.has(key)) {
        predictions.push({
          name,
          avgIntervalDays,
          lastPurchased: lastPurchase,
          nextDue: nextPurchaseDate,
          daysUntilDue,
          overdue: daysUntilDue < 0,
          purchaseCount: dates.length,
        })
      }
    })

    predictions.sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    res.json({ predictions: predictions.slice(0, 8) })
  } catch (err) {
    console.error('getPredictions error:', err)
    res.status(500).json({ error: 'Failed to get predictions' })
  }
}