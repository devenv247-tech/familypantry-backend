const prisma = require('../utils/prisma')
const Anthropic = require('@anthropic-ai/sdk')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const getRDA = (age) => {
  if (age <= 3)  return { calcium: 700,  iron: 7,   vitaminD: 600 }
  if (age <= 8)  return { calcium: 1000, iron: 10,  vitaminD: 600 }
  if (age <= 13) return { calcium: 1300, iron: 8,   vitaminD: 600 }
  if (age <= 18) return { calcium: 1300, iron: age >= 14 ? 15 : 11, vitaminD: 600 }
  return               { calcium: 1000, iron: 18,  vitaminD: 600 }
}

const getKidsSummary = async (req, res) => {
  try {
    const { memberId } = req.params
    const familyId = req.user.familyId

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId },
    })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    const age = member.age || 8
    const rda = getRDA(age)

    const since = new Date()
    since.setDate(since.getDate() - 7)

    const logs = await prisma.nutritionLog.findMany({
      where: { familyId, memberId, loggedAt: { gte: since } },
      orderBy: { loggedAt: 'desc' },
    })

    let totalCalcium = 0
    let totalIron = 0
    let totalVitaminD = 0
    let mealsWithMicrodata = 0

    for (const log of logs) {
      const calcium  = parseFloat(log.calcium  || 0)
      const iron     = parseFloat(log.iron     || 0)
      const vitaminD = parseFloat(log.vitaminD || 0)
      totalCalcium  += calcium
      totalIron     += iron
      totalVitaminD += vitaminD
      if (calcium > 0 || iron > 0 || vitaminD > 0) mealsWithMicrodata++
    }

    const weeklyRDA = {
      calcium:  rda.calcium  * 7,
      iron:     rda.iron     * 7,
      vitaminD: rda.vitaminD * 7,
    }

    const pct = (val, target) => Math.min(Math.round((val / target) * 100), 100)

    const nutrients = [
      {
        key: 'calcium',
        label: 'Calcium',
        emoji: '🦴',
        consumed: Math.round(totalCalcium),
        target: weeklyRDA.calcium,
        unit: 'mg',
        pct: pct(totalCalcium, weeklyRDA.calcium),
        dailyTarget: rda.calcium,
        why: 'Builds strong bones and teeth',
        foods: ['Milk', 'Yogurt', 'Paneer', 'Cheese', 'Broccoli', 'Almonds'],
      },
      {
        key: 'iron',
        label: 'Iron',
        emoji: '💪',
        consumed: Math.round(totalIron * 10) / 10,
        target: weeklyRDA.iron,
        unit: 'mg',
        pct: pct(totalIron, weeklyRDA.iron),
        dailyTarget: rda.iron,
        why: 'Supports brain development and energy',
        foods: ['Lentils', 'Dal', 'Spinach', 'Chickpeas', 'Eggs', 'Beef'],
      },
      {
        key: 'vitaminD',
        label: 'Vitamin D',
        emoji: '☀️',
        consumed: Math.round(totalVitaminD * 10) / 10,
        target: weeklyRDA.vitaminD,
        unit: 'IU',
        pct: pct(totalVitaminD, weeklyRDA.vitaminD),
        dailyTarget: rda.vitaminD,
        why: 'Essential for bone growth and immune health',
        foods: ['Salmon', 'Fortified milk', 'Eggs', 'Fortified OJ', 'Tuna'],
      },
    ]

    let aiTip = null
    if (logs.length > 0) {
      try {
        const lowNutrients  = nutrients.filter(n => n.pct < 60).map(n => n.label)
        const goodNutrients = nutrients.filter(n => n.pct >= 80).map(n => n.label)

        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 120,
          messages: [{
            role: 'user',
            content: `You are a warm, encouraging children's nutritionist helping a Canadian parent track their ${age}-year-old child's nutrition.

This week the child logged ${logs.length} meals.
${lowNutrients.length  > 0 ? `Nutrients below 60% of weekly target: ${lowNutrients.join(', ')}.`  : ''}
${goodNutrients.length > 0 ? `Nutrients going well (80%+): ${goodNutrients.join(', ')}.` : ''}

Write 2 sentences maximum. Be warm, specific, and practical. Suggest 1-2 simple foods to add this week. Never use scary language. If everything looks good, celebrate it!`,
          }],
        })
        aiTip = message.content[0]?.text || null
      } catch (e) {
        console.error('Kids AI tip error:', e.message)
      }
    }

    const overallPct = Math.round(
      nutrients.reduce((sum, n) => sum + n.pct, 0) / nutrients.length
    )

    res.json({
      member:            { id: member.id, name: member.name, age },
      nutrients,
      overallPct,
      mealsLogged:       logs.length,
      mealsWithMicrodata,
      aiTip,
      hasData:           logs.length > 0,
    })
  } catch (err) {
    console.error('Kids summary error:', err)
    res.status(500).json({ error: 'Failed to load kids nutrition summary' })
  }
}

module.exports = { getKidsSummary }