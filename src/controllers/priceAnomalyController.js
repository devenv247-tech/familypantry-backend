const prisma = require('../utils/prisma')

// Record a price when item is purchased
const recordPrice = async (req, res) => {
  try {
    const { itemName, price, store } = req.body
    const familyId = req.user.familyId

    if (!itemName || !price || parseFloat(price) <= 0) {
      return res.json({ success: true, skipped: true })
    }

    await prisma.priceHistory.create({
      data: {
        itemName: itemName.toLowerCase().trim(),
        price: parseFloat(price),
        store: store || null,
        familyId
      }
    })

    res.json({ success: true })
  } catch (err) {
    console.error('recordPrice error:', err)
    res.status(500).json({ error: 'Failed to record price' })
  }
}

// Check if a price is anomalous compared to history
const checkPriceAnomaly = async (req, res) => {
  try {
    const { itemName, price, store } = req.body
    const familyId = req.user.familyId

    if (!itemName || !price || parseFloat(price) <= 0) {
      return res.json({ hasAnomaly: false })
    }

    const currentPrice = parseFloat(price)
    const normalizedName = itemName.toLowerCase().trim()

    // Get price history for this item
    const history = await prisma.priceHistory.findMany({
      where: {
        familyId,
        itemName: { contains: normalizedName.split(' ')[0], mode: 'insensitive' }
      },
      orderBy: { recordedAt: 'desc' },
      take: 20
    })

    if (history.length < 2) {
      return res.json({ hasAnomaly: false, message: 'Not enough price history yet' })
    }

    // Calculate average and standard deviation
    const prices = history.map(h => h.price)
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const percentChange = ((currentPrice - avg) / avg) * 100

    let anomaly = null

    if (percentChange > 20) {
      anomaly = {
        type: 'high',
        icon: '⚠️',
        message: `${itemName} is ${Math.round(percentChange)}% more expensive than usual`,
        detail: `Your average: $${avg.toFixed(2)} — Current: $${currentPrice.toFixed(2)}`,
        suggestion: `Last seen cheaper at $${min.toFixed(2)}. Consider waiting or checking another store.`,
        percentChange: Math.round(percentChange),
        avgPrice: avg.toFixed(2),
        currentPrice: currentPrice.toFixed(2)
      }
    } else if (percentChange < -20) {
      anomaly = {
        type: 'low',
        icon: '🎉',
        message: `${itemName} is ${Math.round(Math.abs(percentChange))}% cheaper than usual!`,
        detail: `Your average: $${avg.toFixed(2)} — Current: $${currentPrice.toFixed(2)}`,
        suggestion: `Great time to stock up! Highest you've paid: $${max.toFixed(2)}`,
        percentChange: Math.round(percentChange),
        avgPrice: avg.toFixed(2),
        currentPrice: currentPrice.toFixed(2)
      }
    }

    res.json({
      hasAnomaly: anomaly !== null,
      anomaly,
      history: {
        count: history.length,
        avg: avg.toFixed(2),
        min: min.toFixed(2),
        max: max.toFixed(2)
      }
    })
  } catch (err) {
    console.error('checkPriceAnomaly error:', err)
    res.status(500).json({ error: 'Failed to check price anomaly' })
  }
}

// Get all current price alerts for family
const getPriceAlerts = async (req, res) => {
  try {
    const familyId = req.user.familyId

    // Get recent grocery items with prices
    const recentItems = await prisma.groceryItem.findMany({
      where: {
        familyId,
        price: { not: null },
        purchased: false
      }
    })

    const alerts = []

    for (const item of recentItems) {
      const price = parseFloat(item.price)
      if (!price || price <= 0) continue

      const history = await prisma.priceHistory.findMany({
        where: {
          familyId,
          itemName: { contains: item.name.split(' ')[0].toLowerCase(), mode: 'insensitive' }
        },
        orderBy: { recordedAt: 'desc' },
        take: 10
      })

      if (history.length < 2) continue

      const prices = history.map(h => h.price)
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length
      const percentChange = ((price - avg) / avg) * 100

      if (Math.abs(percentChange) > 20) {
        alerts.push({
          itemName: item.name,
          currentPrice: price.toFixed(2),
          avgPrice: avg.toFixed(2),
          percentChange: Math.round(percentChange),
          type: percentChange > 0 ? 'high' : 'low',
          icon: percentChange > 0 ? '⚠️' : '🎉',
          store: item.store || null
        })
      }
    }

    res.json({ alerts })
  } catch (err) {
    console.error('getPriceAlerts error:', err)
    res.status(500).json({ error: 'Failed to get price alerts' })
  }
}

module.exports = { recordPrice, checkPriceAnomaly, getPriceAlerts }