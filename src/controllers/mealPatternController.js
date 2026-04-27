const prisma = require('../utils/prisma')

// Log a cooked meal
const logCookedMeal = async (req, res) => {
  try {
    const { recipeName, mealType, cuisine, members, rating } = req.body
    const familyId = req.user.familyId

    const meal = await prisma.cookedMeal.create({
      data: {
        recipeName,
        mealType,
        cuisine: cuisine || null,
        members,
        rating: rating || null,
        familyId
      }
    })

    res.status(201).json({ success: true, meal })
  } catch (err) {
    console.error('logCookedMeal error:', err)
    res.status(500).json({ error: 'Failed to log cooked meal' })
  }
}

// Get cooking history for a family
const getCookingHistory = async (req, res) => {
  try {
    const familyId = req.user.familyId
    const limit = parseInt(req.query.limit) || 20

    const meals = await prisma.cookedMeal.findMany({
      where: { familyId },
      orderBy: { cookedAt: 'desc' },
      take: limit
    })

    res.json(meals)
  } catch (err) {
    console.error('getCookingHistory error:', err)
    res.status(500).json({ error: 'Failed to get cooking history' })
  }
}

// Get meal pattern context for Claude (used internally by recipe controller)
const getMealPatternContext = async (familyId) => {
  try {
    const meals = await prisma.cookedMeal.findMany({
      where: { familyId },
      orderBy: { cookedAt: 'desc' },
      take: 30
    })

    if (meals.length === 0) return ''

    const mealList = meals.map(m => {
      const daysAgo = Math.floor((new Date() - new Date(m.cookedAt)) / (1000 * 60 * 60 * 24))
      const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
      const stars = m.rating ? '⭐'.repeat(m.rating) : 'not rated'
      return `- ${m.recipeName} (${m.mealType}, ${when}, ${stars})`
    }).join('\n')

    // Find favourites (cooked 2+ times)
    const counts = {}
    meals.forEach(m => { counts[m.recipeName] = (counts[m.recipeName] || 0) + 1 })
    const favourites = Object.entries(counts)
      .filter(([_, count]) => count >= 2)
      .map(([name]) => name)

    // Find recent (last 7 days) to avoid repeating
    const recentNames = meals
      .filter(m => new Date() - new Date(m.cookedAt) <= 7 * 24 * 60 * 60 * 1000)
      .map(m => m.recipeName)

    let context = `\nFAMILY MEAL HISTORY (last ${meals.length} meals):\n${mealList}\n`

    if (recentNames.length > 0) {
      context += `\nAVOID repeating these meals cooked in the last 7 days: ${recentNames.join(', ')}\n`
    }

    if (favourites.length > 0) {
      context += `\nFAMILY FAVOURITES (cooked multiple times): ${favourites.join(', ')} — similar styles welcome\n`
    }

    return context
  } catch (err) {
    console.error('getMealPatternContext error:', err)
    return ''
  }
}

module.exports = { logCookedMeal, getCookingHistory, getMealPatternContext }