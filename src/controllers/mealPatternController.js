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

    // Auto-log per-serving nutrition from SavedRecipe if available (skip silently otherwise)
    try {
      const savedRecipe = await prisma.savedRecipe.findFirst({
        where: { familyId, name: { equals: recipeName, mode: 'insensitive' } },
        select: { nutritionPerServing: true },
      })

      if (savedRecipe?.nutritionPerServing) {
        const nutrition = savedRecipe.nutritionPerServing

        // members is a comma-separated string e.g. "Alice, Bob" or "Family"
        const memberNames = typeof members === 'string'
          ? members.split(',').map(s => s.trim()).filter(Boolean)
          : Array.isArray(members) ? members.map(String) : []

        const allFamilyMembers = await prisma.member.findMany({
          where: { familyId },
          select: { id: true, name: true },
        })

        const isFamily = memberNames.length === 1 && memberNames[0].toLowerCase() === 'family'
        const targetMembers = isFamily
          ? allFamilyMembers.filter(m => !m.isBaby)
          : allFamilyMembers.filter(m =>
              memberNames.some(n => n.toLowerCase() === m.name.toLowerCase())
            )

        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const tomorrowStart = new Date(todayStart)
        tomorrowStart.setDate(tomorrowStart.getDate() + 1)

        await Promise.all(targetMembers.map(async (member) => {
          const dupCheck = await prisma.nutritionLog.findFirst({
            where: {
              familyId,
              memberName: member.name,
              recipeName,
              loggedAt: { gte: todayStart, lt: tomorrowStart },
            },
          })
          if (dupCheck) return

          await prisma.nutritionLog.create({
            data: {
              familyId,
              memberName: member.name,
              memberId: member.id,
              recipeName,
              mealType,
              calories: nutrition.calories ?? null,
              protein: nutrition.protein ?? null,
              carbs: nutrition.carbs ?? null,
              fat: nutrition.fat ?? null,
              fiber: nutrition.fiber ?? null,
              sugar: nutrition.sugar ?? null,
              sodium: nutrition.sodium ?? null,
            },
          })
        }))
      }
    } catch (logErr) {
      console.error('logCookedMeal auto-log error (non-fatal):', logErr?.message)
    }

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