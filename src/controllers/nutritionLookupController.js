const Anthropic = require('@anthropic-ai/sdk')
const prisma = require('../utils/prisma')
const { handleAnthropicError, trackApiUsage } = require('../utils/anthropicError')

const callClaude = async (anthropic, params, endpoint) => {
  const message = await anthropic.messages.create(params)
  await trackApiUsage(endpoint, message.usage?.input_tokens || 0, message.usage?.output_tokens || 0)
  return message
}

// Normalize search key — removes duplicates from different spellings
const normalizeKey = (mealName) => {
  return mealName
    .toLowerCase()
    .replace(/[''`]/g, '')           // remove apostrophes
    .replace(/[^a-z0-9\s]/g, ' ')   // remove punctuation
    .replace(/\s+/g, ' ')            // collapse spaces
    .trim()
    .split(' ')
    .filter(w => w.length > 0)
    .sort()                          // sort words so order doesn't matter
    .join(' ')
}

exports.lookupNutrition = async (req, res) => {
  try {
    const { mealName, servings = 1 } = req.body
    if (!mealName) return res.status(400).json({ error: 'Meal name required' })

    const searchKey = normalizeKey(mealName)
    const now = new Date()

    // Check cache first
    const cached = await prisma.nutritionCache.findUnique({
      where: { searchKey }
    })

    if (cached && cached.expiresAt > now) {
      // Cache hit — increment counter and return
      await prisma.nutritionCache.update({
        where: { searchKey },
        data: { hitCount: { increment: 1 } }
      })

      const result = {
        found: true,
        mealName: cached.mealName,
        servingSize: cached.servingSize,
        calories: Math.round((cached.calories || 0) * servings),
        protein: Math.round((cached.protein || 0) * servings),
        carbs: Math.round((cached.carbs || 0) * servings),
        fat: Math.round((cached.fat || 0) * servings),
        fiber: Math.round((cached.fiber || 0) * servings),
        sugar: Math.round((cached.sugar || 0) * servings),
        sodium: Math.round((cached.sodium || 0) * servings),
        confidence: cached.confidence,
        source: cached.source,
        fromCache: true,
      }

      return res.json(result)
    }

    // Not in cache or expired — call Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await callClaude(anthropic, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are a nutrition database for Canadian food. Look up the nutrition info for: "${mealName}"

If this is a restaurant item (McDonald's, Tim Hortons, Subway, A&W, Harvey's, Wendy's, Popeyes, KFC, Pizza Pizza, Boston Pizza, Swiss Chalet, Dairy Queen, Burger King, Five Guys, Chipotle, etc.) use their official Canadian nutrition data.

If it's a home-cooked meal or generic food, estimate based on standard recipe for 1 serving.

Respond ONLY with valid JSON, no markdown:
{
  "found": true,
  "mealName": "exact name with restaurant if applicable",
  "servingSize": "1 sandwich / 1 cup / 1 slice etc",
  "calories": 450,
  "protein": 25,
  "carbs": 40,
  "fat": 18,
  "fiber": 2,
  "sugar": 8,
  "sodium": 890,
  "confidence": "high/medium/low",
  "source": "McDonald's Canada official / estimated"
}`
      }]
    }, 'nutrition_lookup')

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const nutrition = JSON.parse(text)

    if (nutrition.found) {
      // Store in cache — 90 day expiry
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 90)

      await prisma.nutritionCache.upsert({
        where: { searchKey },
        create: {
          searchKey,
          mealName: nutrition.mealName,
          calories: nutrition.calories,
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fat: nutrition.fat,
          fiber: nutrition.fiber,
          sugar: nutrition.sugar,
          sodium: nutrition.sodium,
          servingSize: nutrition.servingSize,
          source: nutrition.source,
          confidence: nutrition.confidence,
          hitCount: 1,
          expiresAt,
        },
        update: {
          mealName: nutrition.mealName,
          calories: nutrition.calories,
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fat: nutrition.fat,
          fiber: nutrition.fiber,
          sugar: nutrition.sugar,
          sodium: nutrition.sodium,
          servingSize: nutrition.servingSize,
          source: nutrition.source,
          confidence: nutrition.confidence,
          hitCount: { increment: 1 },
          expiresAt,
        }
      })
    }

    // Scale by servings
    if (servings > 1 && nutrition.found) {
      nutrition.calories = Math.round(nutrition.calories * servings)
      nutrition.protein = Math.round(nutrition.protein * servings)
      nutrition.carbs = Math.round(nutrition.carbs * servings)
      nutrition.fat = Math.round(nutrition.fat * servings)
      nutrition.fiber = Math.round(nutrition.fiber * servings)
      nutrition.sugar = Math.round(nutrition.sugar * servings)
      nutrition.sodium = Math.round(nutrition.sodium * servings)
    }

    nutrition.fromCache = false
    res.json(nutrition)
  } catch (err) {
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