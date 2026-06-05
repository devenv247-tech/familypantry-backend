const prisma = require('../utils/prisma')
const { getStockPercent } = require('../utils/normalizeUnit')

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
    const now = new Date()
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

    // ─── Fetch all data in parallel ───────────────────────────────────────────
    const [history, currentGrocery, pantryItems, family] = await Promise.all([
      prisma.groceryItem.findMany({
        where: { familyId, purchased: true, purchasedAt: { not: null } },
        orderBy: { purchasedAt: 'asc' },
      }),
      prisma.groceryItem.findMany({ where: { familyId, checked: false } }),
      prisma.pantryItem.findMany({ where: { familyId } }),
      prisma.family.findUnique({ where: { id: familyId } }),
    ])

    const onGroceryList = new Set(currentGrocery.map(i => i.name.toLowerCase().trim()))
    const restockThreshold = family?.restockThresholdPercent ?? 20
    const urgentThreshold = restockThreshold * 0.1

    const predictions = []
    const addedNames = new Set()

    // ─── Signal 1: Percentage-based low stock (works from day one) ────────────
    for (const item of pantryItems) {
      const key = item.name.toLowerCase().trim()

      // Skip if already on grocery list
      if (onGroceryList.has(key)) continue

      // Skip if no maxQuantity set yet (old items with no baseline)
      if (!item.maxQuantity || item.maxQuantity <= 0) continue

      // Skip if not used in 60 days (seasonal suppression)
      if (item.lastUsedAt && new Date(item.lastUsedAt) < sixtyDaysAgo) continue

      const stockPct = getStockPercent(item.normalizedQty ?? item.quantity, item.maxQuantity)
      if (stockPct === null) continue

      // Use tighter threshold for spices
      const effectiveThreshold = item.isSpice ? restockThreshold / 4 : restockThreshold

      if (stockPct <= effectiveThreshold) {
        const urgent = stockPct <= urgentThreshold || stockPct <= 0

        predictions.push({
          name: item.name,
          source: 'low_stock',
          stockPercent: stockPct,
          urgent,
          reason: stockPct <= 0
            ? 'Out of stock'
            : `${Math.round(stockPct)}% remaining`,
          daysUntilDue: urgent ? -1 : 0, // used for sorting
          overdue: urgent,
        })
        addedNames.add(key)
      }
    }

    // ─── Signal 2: Purchase interval predictions ──────────────────────────────
    const grouped = {}
    history.forEach(item => {
      const key = item.name.toLowerCase().trim()
      if (!grouped[key]) grouped[key] = { name: item.name, dates: [] }
      grouped[key].dates.push(new Date(item.purchasedAt))
    })

    Object.values(grouped).forEach(({ name, dates }) => {
      if (dates.length < 2) return

      const key = name.toLowerCase().trim()

      // Skip if already on grocery list or already added via low-stock signal
      if (onGroceryList.has(key) || addedNames.has(key)) return

      let totalDays = 0
      for (let i = 1; i < dates.length; i++) {
        totalDays += (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24)
      }
      const avgIntervalDays = Math.round(totalDays / (dates.length - 1))
      if (avgIntervalDays <= 0) return

      const lastPurchase = dates[dates.length - 1]
      const nextPurchaseDate = new Date(lastPurchase.getTime() + avgIntervalDays * 24 * 60 * 60 * 1000)
      const daysUntilDue = Math.round((nextPurchaseDate - now) / (1000 * 60 * 60 * 24))

      // Wider window for auto-generate (7 days), shown in UI at 3 days
      if (daysUntilDue <= 7) {
        predictions.push({
          name,
          source: 'interval',
          avgIntervalDays,
          lastPurchased: lastPurchase,
          nextDue: nextPurchaseDate,
          daysUntilDue,
          overdue: daysUntilDue < 0,
          urgent: daysUntilDue < 0,
          purchaseCount: dates.length,
          reason: daysUntilDue < 0
            ? `Every ${avgIntervalDays}d — overdue by ${Math.abs(daysUntilDue)}d`
            : daysUntilDue === 0
            ? `Every ${avgIntervalDays}d — due today`
            : `Every ${avgIntervalDays}d — due in ${daysUntilDue}d`,
        })
        addedNames.add(key)
      }
    })

    // ─── Sort: urgent first, then by stockPercent/daysUntilDue ───────────────
    predictions.sort((a, b) => {
      if (a.urgent && !b.urgent) return -1
      if (!a.urgent && b.urgent) return 1
      if (a.source === 'low_stock' && b.source === 'low_stock') {
        return (a.stockPercent ?? 100) - (b.stockPercent ?? 100)
      }
      return (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0)
    })

    res.json({ predictions: predictions.slice(0, 10) })
  } catch (err) {
    console.error('getPredictions error:', err)
    res.status(500).json({ error: 'Failed to get predictions' })
  }
}