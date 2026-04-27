const Anthropic = require('@anthropic-ai/sdk')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Local lookup table (days until expiry) ───────────────────────────────────
const EXPIRY_TABLE = {
  // Dairy
  'milk': 7, 'homo milk': 7, '2% milk': 7, 'skim milk': 7, 'whole milk': 7,
  'butter': 30, 'cream': 7, 'heavy cream': 7, 'whipping cream': 7,
  'sour cream': 14, 'cream cheese': 14, 'cottage cheese': 7,
  'yogurt': 14, 'greek yogurt': 14, 'cheese': 21, 'cheddar': 21,
  'mozzarella': 14, 'parmesan': 30, 'brie': 7, 'feta': 14,

  // Eggs
  'eggs': 35, 'egg': 35,

  // Meat & Poultry
  'chicken': 3, 'chicken breast': 3, 'chicken thighs': 3, 'whole chicken': 3,
  'ground beef': 2, 'beef': 4, 'steak': 4, 'pork': 3, 'pork chops': 3,
  'bacon': 7, 'ham': 5, 'sausage': 3, 'ground turkey': 2, 'turkey': 3,
  'lamb': 3, 'veal': 3,

  // Fish & Seafood
  'salmon': 2, 'tuna': 2, 'shrimp': 2, 'fish': 2, 'cod': 2,
  'tilapia': 2, 'halibut': 2, 'crab': 2, 'lobster': 2, 'scallops': 2,

  // Produce — Vegetables
  'spinach': 5, 'lettuce': 5, 'kale': 5, 'arugula': 4,
  'broccoli': 5, 'cauliflower': 7, 'cabbage': 14, 'brussels sprouts': 5,
  'carrots': 21, 'celery': 14, 'cucumber': 7, 'zucchini': 7,
  'bell pepper': 7, 'pepper': 7, 'tomato': 5, 'tomatoes': 5,
  'onion': 30, 'onions': 30, 'garlic': 30, 'ginger': 21,
  'potato': 30, 'potatoes': 30, 'sweet potato': 21, 'sweet potatoes': 21,
  'corn': 3, 'peas': 5, 'green beans': 5, 'asparagus': 4,
  'mushrooms': 5, 'mushroom': 5, 'eggplant': 7, 'squash': 30,
  'beets': 14, 'radish': 7, 'leek': 7, 'artichoke': 7,

  // Produce — Fruits
  'banana': 5, 'bananas': 5, 'apple': 21, 'apples': 21,
  'orange': 14, 'oranges': 14, 'lemon': 14, 'lemons': 14,
  'lime': 14, 'limes': 14, 'grapes': 7, 'strawberries': 4,
  'blueberries': 7, 'raspberries': 3, 'blackberries': 4,
  'mango': 5, 'pineapple': 5, 'watermelon': 7, 'cantaloupe': 5,
  'peach': 5, 'pear': 7, 'plum': 5, 'cherry': 5, 'cherries': 5,
  'kiwi': 7, 'avocado': 4, 'avocados': 4, 'grapefruit': 14,

  // Bread & Bakery
  'bread': 7, 'white bread': 7, 'whole wheat bread': 7, 'sourdough': 5,
  'bagel': 5, 'bagels': 5, 'muffin': 5, 'muffins': 5,
  'croissant': 3, 'tortilla': 7, 'tortillas': 7, 'pita': 5,
  'bun': 5, 'buns': 5, 'roll': 5, 'rolls': 5,

  // Beverages
  'orange juice': 7, 'apple juice': 10, 'juice': 10,
  'almond milk': 10, 'oat milk': 10, 'soy milk': 10,

  // Deli & Prepared
  'deli meat': 5, 'lunch meat': 5, 'cold cuts': 5,
  'hummus': 7, 'salsa': 10, 'guacamole': 3,
  'tofu': 5, 'tempeh': 7,

  // Leftovers & Cooked
  'leftovers': 4, 'cooked chicken': 4, 'cooked rice': 4,
  'cooked pasta': 4, 'soup': 4, 'stew': 4,

  // Long shelf life (pantry)
  'pasta': 730, 'rice': 730, 'flour': 365, 'sugar': 730,
  'salt': 1825, 'oil': 365, 'olive oil': 365, 'vinegar': 730,
  'honey': 1825, 'oats': 365, 'cereal': 180, 'granola': 90,
  'canned beans': 730, 'canned tomatoes': 730, 'canned corn': 730,
  'peanut butter': 180, 'jam': 180, 'jelly': 180,
  'protein powder': 365, 'protein oats': 365,
  'nuts': 180, 'almonds': 180, 'walnuts': 180, 'cashews': 180,
  'chocolate': 180, 'cocoa': 365, 'baking powder': 365,
  'baking soda': 365, 'yeast': 120, 'cornstarch': 730,
}

// ─── Match item name to lookup table ─────────────────────────────────────────
const lookupLocalExpiry = (itemName) => {
  const name = itemName.toLowerCase().trim()

  // Exact match first
  if (EXPIRY_TABLE[name]) return EXPIRY_TABLE[name]

  // Partial match — check if any key is contained in the item name
  for (const [key, days] of Object.entries(EXPIRY_TABLE)) {
    if (name.includes(key) || key.includes(name)) return days
  }

  return null
}

// ─── Learn from pantry history for this family ───────────────────────────────
const learnFromHistory = async (itemName, familyId) => {
  const history = await prisma.itemUsageHistory.findMany({
    where: {
      familyId,
      itemName: { contains: itemName.split(' ')[0], mode: 'insensitive' },
      removedAt: { not: null }
    },
    orderBy: { addedAt: 'desc' },
    take: 5
  })

  if (history.length === 0) return null

  // Calculate average days this item lasted in this family's pantry
  const durations = history
    .filter(h => h.removedAt)
    .map(h => Math.ceil((new Date(h.removedAt) - new Date(h.addedAt)) / (1000 * 60 * 60 * 24)))
    .filter(d => d > 0 && d < 365)

  if (durations.length === 0) return null

  const avgDays = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  return { days: avgDays, source: 'pattern_learned', confidence: durations.length >= 3 ? 'high' : 'medium' }
}

// ─── Claude as last resort ───────────────────────────────────────────────────
const askClaude = async (itemName, category) => {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `How many days does "${itemName}" (category: ${category}) typically last after purchase? Respond ONLY with JSON: {"days":NUMBER,"confidence":"high"|"medium"|"low","reasoning":"one short sentence"}`
    }]
  })

  return JSON.parse(response.content[0].text)
}

// ─── Main predict endpoint ────────────────────────────────────────────────────
const predictExpiry = async (req, res) => {
  try {
    const { itemName, category, itemId } = req.body
    const familyId = req.user.familyId

    const today = new Date()
    let days, confidence, source, reasoning

    // 1. Try local lookup table first (free, instant)
    const localDays = lookupLocalExpiry(itemName)
    if (localDays) {
      days = localDays
      confidence = 'high'
      source = 'local_table'
      reasoning = `Standard shelf life for ${category} items`
    }

    // 2. Override with family's own learned patterns if available (more accurate)
    const learned = await learnFromHistory(itemName, familyId)
    if (learned) {
      days = learned.days
      confidence = learned.confidence
      source = learned.source
      reasoning = `Based on your family's actual usage history`
    }

    // 3. Only call Claude if nothing else worked
    if (!days) {
      const claudeResult = await askClaude(itemName, category)
      days = claudeResult.days
      confidence = claudeResult.confidence
      source = 'ai_predicted'
      reasoning = claudeResult.reasoning
    }

    const predictedExpiry = new Date(today.getTime() + days * 24 * 60 * 60 * 1000)

    // Save to pantry item
    if (itemId) {
      await prisma.pantryItem.update({
        where: { id: itemId },
        data: {
          predictedExpiry,
          expiryConfidence: confidence,
          expirySource: source
        }
      })
    }

    res.json({
      success: true,
      predictedExpiry: predictedExpiry.toISOString().split('T')[0],
      daysUntilExpiry: days,
      confidence,
      source,
      reasoning
    })
  } catch (err) {
    console.error('predictExpiry error:', err)
    res.status(500).json({ error: 'Failed to predict expiry' })
  }
}

// ─── Get expiring soon items ──────────────────────────────────────────────────
const getExpiringSoon = async (req, res) => {
  try {
    const familyId = req.user.familyId
    const now = new Date()
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const items = await prisma.pantryItem.findMany({ where: { familyId } })

    const expiringSoon = items
      .map(item => {
        const expiryDate = item.expiry
          ? new Date(item.expiry)
          : item.predictedExpiry
            ? new Date(item.predictedExpiry)
            : null

        if (!expiryDate) return null

        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))

        return {
          ...item,
          expiryDate: expiryDate.toISOString().split('T')[0],
          daysLeft,
          isExpired: daysLeft < 0,
          urgency: daysLeft < 0 ? 'expired' : daysLeft <= 2 ? 'critical' : daysLeft <= 5 ? 'warning' : 'soon'
        }
      })
      .filter(item => item && item.daysLeft <= 7)
      .sort((a, b) => a.daysLeft - b.daysLeft)

    res.json(expiringSoon)
  } catch (err) {
    console.error('getExpiringSoon error:', err)
    res.status(500).json({ error: 'Failed to get expiring items' })
  }
}

// ─── Log item removal (self-learning) ────────────────────────────────────────
const logItemRemoval = async (req, res) => {
  try {
    const { itemName, category, predictedExpiry, actualExpiry, removalReason } = req.body
    const familyId = req.user.familyId

    await prisma.itemUsageHistory.create({
      data: {
        itemName,
        category,
        predictedExpiry: predictedExpiry ? new Date(predictedExpiry) : null,
        actualExpiry: actualExpiry ? new Date(actualExpiry) : null,
        removalReason: removalReason || 'used',
        removedAt: new Date(),
        familyId
      }
    })

    res.json({ success: true })
  } catch (err) {
    console.error('logItemRemoval error:', err)
    res.status(500).json({ error: 'Failed to log removal' })
  }
}

module.exports = { predictExpiry, getExpiringSoon, logItemRemoval }