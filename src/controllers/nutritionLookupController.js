const prisma = require('../utils/prisma')
const { handleAnthropicError } = require('../utils/anthropicError')
const nutritionService = require('../services/nutritionService')

exports.lookupNutrition = async (req, res) => {
  try {
    const { mealName, servings = 1 } = req.body
    const result = await nutritionService.lookupNutrition({ mealName, servings })
    res.json(result)
  } catch (err) {
    if (err.validation) return res.status(400).json({ error: err.message })
    return handleAnthropicError(err, res)
  }
}

exports.calculateIngredients = async (req, res) => {
  try {
    const { ingredients, description } = req.body
    const result = await nutritionService.calculateFromDescription({ ingredients, description })
    res.json(result)
  } catch (err) {
    if (err.validation) return res.status(400).json({ error: err.message })
    return handleAnthropicError(err, res)
  }
}
// Get cache stats for admin
exports.getCacheStats = async (req, res) => {
  try {
    const now = new Date()

    const [total, expired, topItems] = await Promise.all([
      prisma.nutritionCache.count(),
      prisma.nutritionCache.count({ where: { expiresAt: { lt: now } } }),
      prisma.nutritionCache.findMany({
        orderBy: { hitCount: 'desc' },
        take: 20,
        select: {
          id: true,
          mealName: true,
          source: true,
          confidence: true,
          hitCount: true,
          createdAt: true,
          expiresAt: true,
          calories: true,
        }
      })
    ])

    res.json({
      total,
      active: total - expired,
      expired,
      topItems,
    })
  } catch (err) {
    console.error('getCacheStats error:', err)
    res.status(500).json({ error: 'Failed to get cache stats' })
  }
}

// Delete a cache item
exports.deleteCacheItem = async (req, res) => {
  try {
    const { id } = req.params
    await prisma.nutritionCache.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error('deleteCacheItem error:', err)
    res.status(500).json({ error: 'Failed to delete cache item' })
  }
}

// Clear expired cache
exports.clearExpiredCache = async (req, res) => {
  try {
    const result = await prisma.nutritionCache.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    })
    res.json({ success: true, deleted: result.count })
  } catch (err) {
    console.error('clearExpiredCache error:', err)
    res.status(500).json({ error: 'Failed to clear cache' })
  }
}

// Clear all cache
exports.clearAllCache = async (req, res) => {
  try {
    const result = await prisma.nutritionCache.deleteMany({})
    res.json({ success: true, deleted: result.count })
  } catch (err) {
    console.error('clearAllCache error:', err)
    res.status(500).json({ error: 'Failed to clear cache' })
  }
}