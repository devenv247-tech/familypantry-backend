const prisma = require('../utils/prisma')

// Public endpoint — returns feature flags and announcements for logged in users
exports.getAppConfig = async (req, res) => {
  try {
    const [flags, announcements] = await Promise.all([
      prisma.featureFlag.findMany({
        select: { name: true, enabled: true, requiredPlan: true, comingSoon: true }
      }),
      prisma.announcement.findMany({
        where: { active: true },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ])

    // Convert flags to easy lookup object
    const flagMap = {}
    flags.forEach(f => {
      flagMap[f.name] = {
        enabled: f.enabled,
        requiredPlan: f.requiredPlan,
        comingSoon: f.comingSoon
      }
    })

    res.json({ flags: flagMap, announcements })
  } catch (err) {
    console.error('getAppConfig error:', err)
    res.status(500).json({ error: 'Failed to get app config' })
  }
}