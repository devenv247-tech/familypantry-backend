const prisma = require('../utils/prisma')
const Anthropic = require('@anthropic-ai/sdk')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

exports.getReports = async (req, res) => {
  try {
    const familyId = req.user.familyId

    // Get all purchased items
    const purchasedItems = await prisma.groceryItem.findMany({
  where: {
    familyId,
    OR: [
      { purchased: true },
      { checked: true }
    ],
    price: { not: null },
  },
  orderBy: { createdAt: 'desc' }
})

    // Helper to parse price
    const parsePrice = (price) => {
      if (!price) return 0
      return parseFloat(price.replace('$', '').replace(',', '')) || 0
    }

    // Monthly spend for last 6 months
    const monthlySpend = {}
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = d.toLocaleString('en-CA', { month: 'short', year: '2-digit' })
      monthlySpend[key] = 0
    }

    purchasedItems.forEach(item => {
      if (!item.purchasedAt) return
      const d = new Date(item.purchasedAt)
      const key = d.toLocaleString('en-CA', { month: 'short', year: '2-digit' })
      if (monthlySpend[key] !== undefined) {
        monthlySpend[key] += parsePrice(item.price)
      }
    })

    // Category breakdown
    const categorySpend = {}
    purchasedItems.forEach(item => {
      const cat = item.category || 'Uncategorized'
      categorySpend[cat] = (categorySpend[cat] || 0) + parsePrice(item.price)
    })

    const totalSpend = Object.values(categorySpend).reduce((a, b) => a + b, 0)
    const categories = Object.entries(categorySpend)
      .map(([name, amount]) => ({
        name,
        amount: amount.toFixed(2),
        percent: totalSpend > 0 ? Math.round((amount / totalSpend) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6)

    // Store breakdown
    const storeSpend = {}
    purchasedItems.forEach(item => {
      if (!item.store) return
      storeSpend[item.store] = (storeSpend[item.store] || 0) + parsePrice(item.price)
    })

    const stores = Object.entries(storeSpend)
      .map(([name, amount]) => ({ name, amount: amount.toFixed(2) }))
      .sort((a, b) => b.amount - a.amount)

    // Recent shopping trips — group by store + date
    const trips = {}
    purchasedItems.forEach(item => {
      if (!item.purchasedAt || !item.store) return
      const date = new Date(item.purchasedAt).toLocaleDateString('en-CA')
      const key = `${item.store}-${date}`
      if (!trips[key]) {
        trips[key] = { store: item.store, date, total: 0, items: 0 }
      }
      trips[key].total += parsePrice(item.price)
      trips[key].items++
    })

    const recentTrips = Object.values(trips)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
      .map(t => ({ ...t, total: `$${t.total.toFixed(2)}` }))

    // This month vs last month
    const thisMonth = Object.values(monthlySpend).slice(-1)[0] || 0
    const lastMonth = Object.values(monthlySpend).slice(-2)[0] || 0
    const avg = Object.values(monthlySpend).filter(v => v > 0).reduce((a, b) => a + b, 0) /
      (Object.values(monthlySpend).filter(v => v > 0).length || 1)

    res.json({
      monthlySpend: Object.entries(monthlySpend).map(([month, amount]) => ({ month, amount: parseFloat(amount.toFixed(2)) })),
      categories,
      stores,
      recentTrips,
      summary: {
        thisMonth: thisMonth.toFixed(2),
        lastMonth: lastMonth.toFixed(2),
        avg: avg.toFixed(2),
        totalItems: purchasedItems.length,
      }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch reports' })
  }
}

exports.getAISavingsTips = async (req, res) => {
  try {
    const familyId = req.user.familyId

    const purchasedItems = await prisma.groceryItem.findMany({
  where: {
    familyId,
    OR: [
      { purchased: true },
      { checked: true }
    ],
    price: { not: null },
  },
  orderBy: { createdAt: 'desc' },
  take: 50
})

    if (purchasedItems.length < 5) {
      return res.json({
        tips: [
          { tip: 'Start checking off grocery items when you buy them to get personalized savings tips!', icon: '💡' }
        ]
      })
    }

    const parsePrice = (price) => parseFloat(price?.replace('$', '') || 0)

    const summary = purchasedItems.reduce((acc, item) => {
      const cat = item.category || 'Uncategorized'
      const store = item.store || 'Unknown'
      acc.categories[cat] = (acc.categories[cat] || 0) + parsePrice(item.price)
      acc.stores[store] = (acc.stores[store] || 0) + parsePrice(item.price)
      acc.total += parsePrice(item.price)
      return acc
    }, { categories: {}, stores: {}, total: 0 })

    const prompt = `You are a grocery budget advisor for a Canadian family.

Here is their recent grocery spending data:
Total spent: $${summary.total.toFixed(2)}
Spending by category: ${JSON.stringify(summary.categories)}
Spending by store: ${JSON.stringify(summary.stores)}
Number of purchases: ${purchasedItems.length}

Give exactly 3 practical, specific money-saving tips based on this data.
Focus on Canadian stores and realistic suggestions.

Respond ONLY with a valid JSON array:
[
  { "tip": "specific actionable tip", "icon": "💡" },
  { "tip": "specific actionable tip", "icon": "💰" },
  { "tip": "specific actionable tip", "icon": "🛒" }
]`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const tips = JSON.parse(text)

    res.json({ tips })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to generate tips' })
  }
}