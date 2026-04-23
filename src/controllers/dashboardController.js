const prisma = require('../utils/prisma')

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