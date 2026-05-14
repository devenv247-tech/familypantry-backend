const prisma = require('../utils/prisma')
// CO2 calculations use fixed averages per meal — no item-level lookup needed

exports.getStats = async (req, res) => {
  try {
    const familyId = req.user.familyId

    const [pantryCount, memberCount, groceryItems, family] = await Promise.all([
      prisma.pantryItem.count({ where: { familyId } }),
      prisma.member.count({ where: { familyId } }),
      prisma.groceryItem.findMany({ where: { familyId } }),
      prisma.family.findUnique({ where: { id: familyId } }),
    ])

    const totalSpend = groceryItems
      .filter(i => i.price)
      .reduce((sum, i) => sum + parseFloat(i.price.replace('$', '') || 0), 0)

    const expiringItems = await prisma.pantryItem.findMany({
      where: {
        familyId,
        expiry: {
          not: null,
        }
      }
    })

    const today = new Date()
    const threeDaysFromNow = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000)

    const expiringSoon = expiringItems.filter(item => {
      if (!item.expiry) return false
      const expiryDate = new Date(item.expiry)
      return expiryDate <= threeDaysFromNow && expiryDate >= today
    })

    const expired = expiringItems.filter(item => {
      if (!item.expiry) return false
      return new Date(item.expiry) < today
    })

    res.json({
      pantryCount,
      memberCount,
      totalSpend: totalSpend.toFixed(2),
      groceryCount: groceryItems.length,
      expiringSoon: expiringSoon.length,
      expired: expired.length,
      plan: family.plan,
      recipeCount: family.recipeCount,
      recipeWeek: family.recipeWeek,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch dashboard stats' })
  }
}

exports.getRecentActivity = async (req, res) => {
  try {
    const familyId = req.user.familyId

    const [recentPantry, recentGrocery, recentMembers] = await Promise.all([
      prisma.pantryItem.findMany({
        where: { familyId },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      prisma.groceryItem.findMany({
        where: { familyId },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      prisma.member.findMany({
        where: { familyId },
        orderBy: { createdAt: 'desc' },
        take: 2,
      }),
    ])

    const activity = [
      ...recentPantry.map(i => ({
        text: `${i.name} added to pantry`,
        time: i.createdAt,
        icon: i.icon || '🧺',
        type: 'pantry'
      })),
      ...recentGrocery.map(i => ({
        text: `${i.name} added to grocery list`,
        time: i.createdAt,
        icon: '🛒',
        type: 'grocery'
      })),
      ...recentMembers.map(m => ({
        text: `${m.name} profile updated`,
        time: m.createdAt,
        icon: '👤',
        type: 'member'
      })),
    ]

    activity.sort((a, b) => new Date(b.time) - new Date(a.time))

    const formatted = activity.slice(0, 5).map(a => ({
      ...a,
      time: formatTimeAgo(a.time)
    }))

    res.json(formatted)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch activity' })
  }
}

function formatTimeAgo(date) {
  const now = new Date()
  const diff = now - new Date(date)
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  return `${days} day${days > 1 ? 's' : ''} ago`
}

exports.getWasteSavings = async (req, res) => {
  try {
    const familyId = req.user.familyId
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Meals cooked this month — from MealPlan (cooked via meal plan)
    // and CookedMeal (cooked via recipe suggestions)
    const [cookedFromPlan, cookedFromRecipes] = await Promise.all([
      prisma.mealPlan.findMany({
        where: { familyId, cooked: true, cookedAt: { gte: thirtyDaysAgo } }
      }),
      prisma.cookedMeal.findMany({
        where: { familyId, cookedAt: { gte: thirtyDaysAgo } }
      })
    ])

    const totalMealsCooked = cookedFromPlan.length + cookedFromRecipes.length

    // Food rescued — pantry items removed before expiry
    // ItemUsageHistory tracks items removed; if removedAt < actualExpiry = rescued
    const usageHistory = await prisma.itemUsageHistory.findMany({
      where: {
        familyId,
        removedAt: { gte: thirtyDaysAgo, not: null },
        actualExpiry: { not: null }
      }
    })

    const rescuedItems = usageHistory.filter(item => {
      if (!item.removedAt || !item.actualExpiry) return false
      const daysBeforeExpiry = Math.round(
        (new Date(item.actualExpiry) - new Date(item.removedAt)) / (1000 * 60 * 60 * 24)
      )
      return daysBeforeExpiry >= 0 && daysBeforeExpiry <= 5
    })

    const foodRescued = rescuedItems.length
    const foodRescuedValue = foodRescued * 3 // avg $3 per rescued item
    const wasteAvoided = parseFloat((foodRescued * 0.3).toFixed(1)) // avg 300g per item

    // Money saved: each home-cooked meal saves ~$10 vs eating out (Canadian avg)
    const moneySaved = (totalMealsCooked * 10) + foodRescuedValue

    // CO2 saved: each home meal saves ~1.2kg vs restaurant supply chain
    const co2Saved = parseFloat((totalMealsCooked * 1.2).toFixed(1))

    res.json({
      moneySaved,
      co2Saved,
      mealsCooked: totalMealsCooked,
      foodRescued,
      wasteAvoided,
      period: 'this month',
    })
  } catch (err) {
    console.error('getWasteSavings error:', err)
    res.status(500).json({ error: 'Failed to fetch waste savings' })
  }
}

exports.getNudges = async (req, res) => {
  try {
    const familyId = req.user.familyId
    const now = new Date()
    const nudges = []

    // Expiry nudges handled separately by the expiring soon widget on dashboard

    // 2. Meal variety — same protein cooked too often
    const recentMeals = await prisma.cookedMeal.findMany({
      where: { familyId, cookedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { cookedAt: 'desc' }
    })

    if (recentMeals.length >= 3) {
      const keywords = ['chicken', 'beef', 'pork', 'fish', 'eggs', 'tofu', 'lamb']
      keywords.forEach(keyword => {
        const count = recentMeals.filter(m => m.recipeName.toLowerCase().includes(keyword)).length
        if (count >= 3) {
          nudges.push({
            type: 'variety',
            icon: '🔁',
            message: `Your family has had ${keyword} ${count} times this week — time to mix it up?`,
            action: { label: 'Get recipes', url: '/app/recipes' },
            priority: 3,
          })
        }
      })
    }

    // 3. Favourite meal not cooked in a while
    const allMeals = await prisma.cookedMeal.findMany({
      where: { familyId },
      orderBy: { cookedAt: 'desc' },
      take: 50
    })

    const mealCounts = {}
    allMeals.forEach(m => {
      mealCounts[m.recipeName] = (mealCounts[m.recipeName] || 0) + 1
    })

    const favourites = Object.entries(mealCounts)
      .filter(([_, count]) => count >= 3)
      .map(([name]) => name)

    favourites.forEach(favName => {
      const lastCooked = allMeals.find(m => m.recipeName === favName)
      if (!lastCooked) return
      const daysSince = Math.round((now - new Date(lastCooked.cookedAt)) / (1000 * 60 * 60 * 24))
      if (daysSince >= 14) {
        nudges.push({
          type: 'favourite',
          icon: '⭐',
          message: `You haven't made ${favName} in ${daysSince} days — it's a family favourite!`,
          action: { label: 'Get recipes', url: '/app/recipes' },
          priority: 4,
        })
      }
    })

    // 4. Missing meal type in this week's plan
    const weekStart = new Date(now)
    const dayOfWeek = now.getDay()
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)
    const weekStartStr = weekStart.toISOString().split('T')[0]

    const weekMeals = await prisma.mealPlan.findMany({
      where: { familyId, weekStart: weekStartStr }
    })

    const mealTypes = ['Breakfast', 'Lunch', 'Dinner']
    mealTypes.forEach(type => {
      const count = weekMeals.filter(m => m.mealType === type).length
      if (count === 0) {
        nudges.push({
          type: 'planning',
          icon: '📅',
          message: `No ${type.toLowerCase()}s planned this week — want AI to suggest some?`,
          action: { label: 'Plan meals', url: '/app/mealplan' },
          priority: 5,
        })
      }
    })

    // Sort by priority and return top 3
    nudges.sort((a, b) => a.priority - b.priority)

    res.json({ nudges: nudges.slice(0, 3) })
  } catch (err) {
    console.error('getNudges error:', err)
    res.status(500).json({ error: 'Failed to get nudges' })
  }
}