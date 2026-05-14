const prisma = require('../utils/prisma')
const { getCO2Score } = require('../utils/co2')

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

    // Meals cooked this month from meal plan
    const cookedMeals = await prisma.mealPlan.findMany({
      where: {
        familyId,
        cooked: true,
        cookedAt: { gte: thirtyDaysAgo }
      }
    })

    // Pantry items used (quantity went down) — approximate by items deleted/updated this month
    const usageHistory = await prisma.itemUsageHistory.findMany({
      where: {
        familyId,
        usedAt: { gte: thirtyDaysAgo },
        action: 'cooked'
      }
    })

    // Items that were expiring soon but got used (rescued food)
    const rescuedItems = await prisma.itemUsageHistory.findMany({
      where: {
        familyId,
        usedAt: { gte: thirtyDaysAgo },
        action: 'cooked',
        daysBeforeExpiry: { lte: 5, gte: 0 }
      }
    })

    // Estimate money saved: avg Canadian meal costs ~$8 at home vs ~$18 eating out
    // Each cooked meal = ~$10 saved vs eating out
    const moneySaved = cookedMeals.length * 10

    // CO2 saved from cooked meals vs eating out (restaurant supply chain ~3x higher)
    // Each home meal saves ~1.2kg CO2 on average
    const co2Saved = parseFloat((cookedMeals.length * 1.2).toFixed(1))

    // Food waste value: EPA estimates $2,913/family/year = ~$8/day
    // Each rescued item ≈ $3 avg value
    const foodRescued = rescuedItems.length
    const foodRescuedValue = foodRescued * 3

    // Total food waste avoided this month
    const wasteAvoided = parseFloat((foodRescued * 0.3).toFixed(1)) // avg 300g per item

    res.json({
      moneySaved: moneySaved + foodRescuedValue,
      co2Saved,
      mealsCooked: cookedMeals.length,
      foodRescued,
      wasteAvoided,
      period: 'this month',
    })
  } catch (err) {
    console.error('getWasteSavings error:', err)
    res.status(500).json({ error: 'Failed to fetch waste savings' })
  }
}