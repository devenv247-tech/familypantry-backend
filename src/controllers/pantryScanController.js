const Anthropic = require('@anthropic-ai/sdk')
const prisma = require('../utils/prisma')
const { handleAnthropicError, trackApiUsage } = require('../utils/anthropicError')
const rateLimit = require('express-rate-limit')

// Max 10 scan attempts per user per 10 minutes
// Blocks hammering while allowing normal usage (family plan = 5/month anyway)
exports.scanRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  keyGenerator: (req) => req.user?.familyId || req.ip, // per family, not per IP
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many scan attempts',
      message: 'You\'ve made too many scan requests. Please wait 10 minutes before trying again.',
      retryAfter: 10,
    })
  },
  standardHeaders: true,
  legacyHeaders: false,
})

const callClaude = async (anthropic, params, endpoint) => {
  const message = await anthropic.messages.create(params)
  await trackApiUsage(endpoint, message.usage?.input_tokens || 0, message.usage?.output_tokens || 0)
  return message
}

const SCAN_LIMITS = {
  free: 0,
  family: 5,
  premium: 999,
}

exports.scanPantryPhoto = async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body
    const familyId = req.user.familyId

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided' })
    }
    // Get existing pantry for context
    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId },
      select: { name: true },
      take: 50,
    })
    const pantryList = pantryItems.length > 0
      ? pantryItems.map(i => i.name).join(', ')
      : 'No existing items yet'
    // Get family and check plan
    const family = await prisma.family.findUnique({ where: { id: familyId } })
    const plan = family.plan || 'free'
    const limit = SCAN_LIMITS[plan] || 0

    if (limit === 0) {
      return res.status(403).json({
        error: 'Family plan feature',
        message: 'AI photo scan is available on the Family plan ($7/mo).',
        limitReached: true
      })
    }

    // Check monthly scan count
    const currentMonth = new Date().toISOString().slice(0, 7) // "2026-04"
    const scanCount = family.photoScanMonth === currentMonth ? family.photoScanCount : 0

    if (plan !== 'premium' && scanCount >= limit) {
      return res.status(403).json({
        error: 'Scan limit reached',
        message: `You've used all ${limit} photo scans for this month. Upgrade to Premium for unlimited scans.`,
        limitReached: true,
        scansUsed: scanCount,
        scansLimit: limit,
      })
    }

    // Call Claude Vision
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Pre-check: is this image food/pantry related? (cheap Haiku call)
    const preCheck = await callClaude(anthropic, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 }
            },
            {
              type: 'text',
              text: 'Does this image contain food, drinks, groceries, or pantry/fridge/kitchen items? Reply with only YES or NO.'
            }
          ]
        }
      ]
    }, 'pantry_photo_scan')

    const preCheckAnswer = preCheck.content[0].text.trim().toUpperCase()
    if (!preCheckAnswer.startsWith('YES')) {
      return res.status(400).json({
        error: 'No food items detected',
        message: 'This photo doesn\'t appear to contain food or pantry items. Please take a photo of your fridge, pantry, or groceries.',
        notFood: true,
      })
    }

    const message = await callClaude(anthropic, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType || 'image/jpeg',
                data: imageBase64,
              }
            },
            {
              type: 'text',
              text: `You are a pantry inventory assistant. Analyze this image of a fridge, pantry, or kitchen and identify all visible food items.
                     This family's existing pantry items for context (use these to help identify brands and products you see): ${pantryList}

For each item you can see, provide:
- name: common name of the item
- quantity: estimated quantity (number)
- unit: appropriate unit (pcs, kg, g, L, ml, lb, oz, cup)
- category: one of (Fridge, Freezer, Dry goods, Spices, Snacks, Drinks, Condiments, Produce)
- icon: single relevant emoji

Be practical — estimate quantities based on what you see (e.g. if you see a bag of rice that looks half full, say 0.5 kg).

Respond ONLY with valid JSON array, no markdown:
[
  {
    "name": "Basmati Rice",
    "quantity": 1,
    "unit": "kg",
    "category": "Dry goods",
    "icon": "🍚"
  }
]`
            }
          ]
        }
     ]
    }, 'pantry_photo_scan')

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const detectedItems = JSON.parse(text)

    // Update scan count
    await prisma.family.update({
      where: { id: familyId },
      data: {
        photoScanCount: family.photoScanMonth === currentMonth ? family.photoScanCount + 1 : 1,
        photoScanMonth: currentMonth,
      }
    })

    const newScanCount = family.photoScanMonth === currentMonth ? family.photoScanCount + 1 : 1

    res.json({
      success: true,
      items: detectedItems,
      scansUsed: newScanCount,
      scansLimit: plan === 'premium' ? null : limit,
      scansRemaining: plan === 'premium' ? null : limit - newScanCount,
    })
 } catch (err) {
    return handleAnthropicError(err, res)
  }
}

exports.getScanStatus = async (req, res) => {
  try {
    const family = await prisma.family.findUnique({ where: { id: req.user.familyId } })
    const plan = family.plan || 'free'
    const limit = SCAN_LIMITS[plan] || 0
    const currentMonth = new Date().toISOString().slice(0, 7)
    const scanCount = family.photoScanMonth === currentMonth ? family.photoScanCount : 0

    res.json({
      plan,
      scansUsed: scanCount,
      scansLimit: plan === 'premium' ? null : limit,
      scansRemaining: plan === 'premium' ? null : Math.max(0, limit - scanCount),
    })
  } catch (err) {
    console.error('getScanStatus error:', err)
    res.status(500).json({ error: 'Failed to get scan status' })
  }
}