const prisma = require('../utils/prisma')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [
      totalFamilies,
      familiesByPlan,
      newFamiliesThisMonth,
      newFamiliesThisWeek,
      totalUsers,
      totalMembers,
      totalPantryItems,
      totalGroceryItems,
      totalMealPlans,
      totalRecipes,
      totalCookedMeals,
    ] = await Promise.all([
      prisma.family.count(),
      prisma.family.groupBy({ by: ['plan'], _count: true }),
      prisma.family.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.family.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.user.count(),
      prisma.member.count(),
      prisma.pantryItem.count(),
      prisma.groceryItem.count(),
      prisma.mealPlan.count(),
      prisma.savedRecipe.count(),
      prisma.cookedMeal.count(),
    ])

    // Get Stripe revenue
    let stripeStats = { mrr: 0, totalRevenue: 0, activeSubscriptions: 0 }
    try {
      const subscriptions = await stripe.subscriptions.list({ status: 'active', limit: 100 })
      stripeStats.activeSubscriptions = subscriptions.data.length
      stripeStats.mrr = subscriptions.data.reduce((sum, sub) => {
        return sum + (sub.items.data[0]?.price?.unit_amount || 0) / 100
      }, 0)

      const charges = await stripe.charges.list({ limit: 100, created: { gte: Math.floor(startOfMonth.getTime() / 1000) } })
      stripeStats.totalRevenue = charges.data
        .filter(c => c.paid && !c.refunded)
        .reduce((sum, c) => sum + c.amount / 100, 0)
    } catch (err) {
      console.error('Stripe stats error:', err)
    }

    const planCounts = { free: 0, family: 0, premium: 0 }
    familiesByPlan.forEach(p => {
      planCounts[p.plan] = p._count
    })

    res.json({
      families: {
        total: totalFamilies,
        newThisMonth: newFamiliesThisMonth,
        newThisWeek: newFamiliesThisWeek,
        byPlan: planCounts,
      },
      users: { total: totalUsers },
      members: { total: totalMembers },
      content: {
        pantryItems: totalPantryItems,
        groceryItems: totalGroceryItems,
        mealPlans: totalMealPlans,
        savedRecipes: totalRecipes,
        cookedMeals: totalCookedMeals,
      },
      revenue: {
        mrr: stripeStats.mrr.toFixed(2),
        thisMonth: stripeStats.totalRevenue.toFixed(2),
        activeSubscriptions: stripeStats.activeSubscriptions,
      },
      costs: {
        digitalOcean: 12.00,
        supabase: 0,
        note: 'Anthropic API costs tracked separately per usage'
      }
    })
  } catch (err) {
    console.error('getDashboardStats error:', err)
    res.status(500).json({ error: 'Failed to get dashboard stats' })
  }
}

// ─── All Families ─────────────────────────────────────────────────────────────
exports.getFamilies = async (req, res) => {
  try {
    const { search, plan, page = 1 } = req.query
    const limit = 20
    const skip = (page - 1) * limit

    const where = {}
    if (plan && plan !== 'all') where.plan = plan
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { users: { some: { email: { contains: search, mode: 'insensitive' } } } }
      ]
    }

    const [families, total] = await Promise.all([
      prisma.family.findMany({
        where,
        include: {
          users: { select: { id: true, name: true, email: true, isAdmin: true, createdAt: true } },
          members: { select: { id: true, name: true } },
          _count: { select: { pantryItems: true, groceryItems: true, mealPlans: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.family.count({ where })
    ])

    res.json({ families, total, pages: Math.ceil(total / limit), page: parseInt(page) })
  } catch (err) {
    console.error('getFamilies error:', err)
    res.status(500).json({ error: 'Failed to get families' })
  }
}

// ─── Update Family Plan ───────────────────────────────────────────────────────
exports.updateFamilyPlan = async (req, res) => {
  try {
    const { id } = req.params
    const { plan } = req.body

    if (!['free', 'family', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    const family = await prisma.family.update({
      where: { id },
      data: { plan }
    })

    res.json({ success: true, family })
  } catch (err) {
    console.error('updateFamilyPlan error:', err)
    res.status(500).json({ error: 'Failed to update plan' })
  }
}

// ─── Delete Family ────────────────────────────────────────────────────────────
exports.deleteFamily = async (req, res) => {
  try {
    const { id } = req.params

    await prisma.groceryItem.deleteMany({ where: { familyId: id } })
    await prisma.pantryItem.deleteMany({ where: { familyId: id } })
    await prisma.mealPlan.deleteMany({ where: { familyId: id } })
    await prisma.savedRecipe.deleteMany({ where: { familyId: id } })
    await prisma.cookedMeal.deleteMany({ where: { familyId: id } })
    await prisma.nutritionLog.deleteMany({ where: { familyId: id } })
    await prisma.priceHistory.deleteMany({ where: { familyId: id } })
    await prisma.itemUsageHistory.deleteMany({ where: { familyId: id } })
    await prisma.member.deleteMany({ where: { familyId: id } })
    await prisma.user.deleteMany({ where: { familyId: id } })
    await prisma.family.delete({ where: { id } })

    res.json({ success: true })
  } catch (err) {
    console.error('deleteFamily error:', err)
    res.status(500).json({ error: 'Failed to delete family' })
  }
}

// ─── Feature Flags ────────────────────────────────────────────────────────────
exports.getFeatureFlags = async (req, res) => {
  try {
    const flags = await prisma.featureFlag.findMany({
      orderBy: { name: 'asc' }
    })
    res.json(flags)
  } catch (err) {
    console.error('getFeatureFlags error:', err)
    res.status(500).json({ error: 'Failed to get feature flags' })
  }
}

exports.updateFeatureFlag = async (req, res) => {
  try {
    const { id } = req.params
    const { enabled, requiredPlan } = req.body

    const flag = await prisma.featureFlag.update({
      where: { id },
      data: {
        ...(enabled !== undefined && { enabled }),
        ...(requiredPlan && { requiredPlan }),
      }
    })

    res.json({ success: true, flag })
  } catch (err) {
    console.error('updateFeatureFlag error:', err)
    res.status(500).json({ error: 'Failed to update feature flag' })
  }
}

// ─── Usage Stats ──────────────────────────────────────────────────────────────
exports.getUsageStats = async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [
      recipesLast7Days,
      recipesLast30Days,
      mealsCooked7Days,
      mealsCooked30Days,
      topCuisines,
      topMealTypes,
    ] = await Promise.all([
      prisma.cookedMeal.count({ where: { cookedAt: { gte: sevenDaysAgo } } }),
      prisma.cookedMeal.count({ where: { cookedAt: { gte: thirtyDaysAgo } } }),
      prisma.cookedMeal.count({ where: { cookedAt: { gte: sevenDaysAgo } } }),
      prisma.cookedMeal.count({ where: { cookedAt: { gte: thirtyDaysAgo } } }),
      prisma.cookedMeal.groupBy({
        by: ['cuisine'],
        _count: true,
        orderBy: { _count: { cuisine: 'desc' } },
        take: 5,
        where: { cuisine: { not: null } }
      }),
      prisma.cookedMeal.groupBy({
        by: ['mealType'],
        _count: true,
        orderBy: { _count: { mealType: 'desc' } },
        take: 5,
      }),
    ])

    res.json({
      recipes: { last7Days: recipesLast7Days, last30Days: recipesLast30Days },
      meals: { cooked7Days: mealsCooked7Days, cooked30Days: mealsCooked30Days },
      topCuisines: topCuisines.map(c => ({ cuisine: c.cuisine || 'Unknown', count: c._count })),
      topMealTypes: topMealTypes.map(m => ({ type: m.mealType, count: m._count })),
    })
  } catch (err) {
    console.error('getUsageStats error:', err)
    res.status(500).json({ error: 'Failed to get usage stats' })
  }
}
// ─── Announcements ────────────────────────────────────────────────────────────
exports.getAnnouncements = async (req, res) => {
  try {
    const announcements = await prisma.announcement.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' }
    })
    res.json(announcements)
  } catch (err) {
    console.error('getAnnouncements error:', err)
    res.status(500).json({ error: 'Failed to get announcements' })
  }
}

exports.createAnnouncement = async (req, res) => {
  try {
    const { title, message, icon } = req.body
    if (!title || !message) return res.status(400).json({ error: 'Title and message required' })

    const announcement = await prisma.announcement.create({
      data: { title, message, icon: icon || '🎉' }
    })
    res.status(201).json(announcement)
  } catch (err) {
    console.error('createAnnouncement error:', err)
    res.status(500).json({ error: 'Failed to create announcement' })
  }
}

exports.deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params
    await prisma.announcement.update({
      where: { id },
      data: { active: false }
    })
    res.json({ success: true })
  } catch (err) {
    console.error('deleteAnnouncement error:', err)
    res.status(500).json({ error: 'Failed to delete announcement' })
  }
}