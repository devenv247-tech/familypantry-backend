const Anthropic = require('@anthropic-ai/sdk')
const prisma = require('../utils/prisma')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const getBudgetForecast = async (req, res) => {
  try {
    const familyId = req.user.familyId

    const family = await prisma.family.findUnique({ where: { id: familyId } })
    if (family.plan === 'free') {
      return res.status(403).json({
        error: 'Family plan feature',
        message: 'Budget forecasting is available on the Family plan ($7/mo).',
        limitReached: true
      })
    }

    // Get last 6 months of purchased grocery items
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const purchasedItems = await prisma.groceryItem.findMany({
      where: {
        familyId,
        purchased: true,
        purchasedAt: { gte: sixMonthsAgo }
      },
      orderBy: { purchasedAt: 'asc' }
    })

    if (purchasedItems.length === 0) {
      return res.json({
        hasData: false,
        message: 'No spending history yet. Start checking off grocery items to enable budget forecasting.'
      })
    }

    // Group spending by month
    const monthlySpend = {}
    purchasedItems.forEach(item => {
      const price = parseFloat(item.price) || 0
      if (price === 0) return
      const month = new Date(item.purchasedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short' })
      monthlySpend[month] = (monthlySpend[month] || 0) + price
    })

    const monthlyData = Object.entries(monthlySpend).map(([month, amount]) => ({
      month,
      amount: parseFloat(amount.toFixed(2))
    }))

    // Group by category
    const categorySpend = {}
    purchasedItems.forEach(item => {
      const price = parseFloat(item.price) || 0
      if (price === 0) return
      const cat = item.category || 'Other'
      categorySpend[cat] = (categorySpend[cat] || 0) + price
    })

    const totalSpend = Object.values(categorySpend).reduce((a, b) => a + b, 0)
    const categoryData = Object.entries(categorySpend)
      .map(([name, amount]) => ({
        name,
        amount: parseFloat(amount.toFixed(2)),
        percent: totalSpend > 0 ? Math.round((amount / totalSpend) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount)

    // Ask Claude for forecast
    const prompt = `You are a family budget analyst. Based on this grocery spending history, provide a forecast.

Monthly spending data: ${JSON.stringify(monthlyData)}
Category breakdown: ${JSON.stringify(categoryData)}
Total items tracked: ${purchasedItems.length}

Analyze the spending patterns and provide:
1. nextMonthForecast: predicted spend for next month (number, no $ sign)
2. trend: "increasing", "decreasing", or "stable"
3. trendPercent: percentage change from last month (number, can be negative)
4. topCategory: the category with highest spend (string)
5. savingsOpportunity: estimated monthly savings possible (number)
6. insights: array of exactly 3 short insight strings (each under 15 words)
7. alert: null or a short warning string if overspending detected

Respond ONLY with valid JSON, no markdown:
{
  "nextMonthForecast": 450,
  "trend": "increasing",
  "trendPercent": 12,
  "topCategory": "Produce",
  "savingsOpportunity": 45,
  "insights": ["insight 1", "insight 2", "insight 3"],
  "alert": null
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })

    const forecast = JSON.parse(response.content[0].text)

    res.json({
      hasData: true,
      forecast,
      monthlyData,
      categoryData,
      totalSpend: parseFloat(totalSpend.toFixed(2)),
      itemCount: purchasedItems.length
    })
  } catch (err) {
    console.error('getBudgetForecast error:', err)
    res.status(500).json({ error: 'Failed to generate budget forecast' })
  }
}

module.exports = { getBudgetForecast }