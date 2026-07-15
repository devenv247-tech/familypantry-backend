const prisma = require('../utils/prisma')
const Anthropic = require('@anthropic-ai/sdk')
const { normalizeUnit, detectIsSpice, getStockPercent, COUNT_UNITS } = require('../utils/normalizeUnit')
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const UNIT_CANONICAL = {
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'L', L: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  floz: 'floz', 'fl oz': 'floz',
  pint: 'pint', pints: 'pint',
  quart: 'quart', quarts: 'quart',
  gallon: 'gallon', gallons: 'gallon',
}

const getCanonicalUnit = (unit) => {
  const u = (unit || '').toLowerCase().trim()
  if (!u || COUNT_UNITS.includes(u)) return 'count'
  return UNIT_CANONICAL[u] || u
}

exports.getItems = async (req, res) => {
  try {
    const items = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch pantry items' })
  }
}

exports.addItem = async (req, res) => {
  try {
    const { name, quantity, unit, category, expiry, icon } = req.body
    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' })
    }
   const rawQty = parseFloat(quantity) || 0
    const normalized = normalizeUnit(rawQty, unit)
    const isSpice = detectIsSpice(name)

    const item = await prisma.pantryItem.create({
      data: {
        name,
        quantity: rawQty,
        unit: unit || 'pcs',
        category,
        expiry: expiry || null,
        icon: icon || '🛒',
        familyId: req.user.familyId,
        normalizedQty: normalized?.normalizedQty ?? null,
        normalizedUnit: normalized?.normalizedUnit ?? null,
        maxQuantity: normalized?.normalizedQty ?? null,
        isSpice,
        lastUsedAt: null,
      }
    })
    res.status(201).json(item)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add item' })
  }
}

exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.pantryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    const { name, quantity, unit, category, expiry, icon } = req.body
    const rawQty = parseFloat(quantity) || 0
    const normalized = normalizeUnit(rawQty, unit || existing.unit)
    const isSpice = detectIsSpice(name || existing.name)

    // Update maxQuantity if new normalized qty exceeds current max
    let newMax = existing.maxQuantity
    if (normalized?.normalizedQty != null) {
      if (!newMax || normalized.normalizedQty > newMax) {
        newMax = normalized.normalizedQty
      }
    }

    // If quantity decreased, item was consumed — update lastUsedAt
    const prevNormalized = normalizeUnit(existing.quantity, existing.unit)
    const wasConsumed = prevNormalized && normalized &&
      normalized.normalizedQty < prevNormalized.normalizedQty

    const item = await prisma.pantryItem.update({
      where: { id },
      data: {
        name,
        quantity: rawQty,
        unit: unit || 'pcs',
        category,
        expiry,
        icon,
        normalizedQty: normalized?.normalizedQty ?? existing.normalizedQty,
        normalizedUnit: normalized?.normalizedUnit ?? existing.normalizedUnit,
        maxQuantity: newMax,
        isSpice,
        lastUsedAt: wasConsumed ? new Date() : existing.lastUsedAt,
      }
    })
    res.json(item)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update item' })
  }
}

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.pantryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    await prisma.pantryItem.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete item' })
  }
}

exports.subtractIngredients = async (req, res) => {
  try {
    const { ingredients } = req.body
    const results = []

    // Fetch all family pantry items once — matching done in memory below
    const allPantryItems = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { name: 'asc' },
    })

    for (const ing of ingredients) {
      const ingName = (ing.name || '').trim()
      if (!ingName) continue

      // Strip parenthetical suffixes: "Besan (chickpea flour)" → "Besan"
      const strippedName = ingName.replace(/\s*\(.*\)\s*$/, '').trim() || ingName

      // 1. Exact match — try original, then stripped
      let item = allPantryItems.find(i => i.name.toLowerCase() === ingName.toLowerCase())
      if (!item && strippedName !== ingName) {
        item = allPantryItems.find(i => i.name.toLowerCase() === strippedName.toLowerCase())
      }

      // 2. Both-direction contains — shortest match wins
      // Guard: pantry name must be ≥3 chars for either direction;
      // reverse direction (recipe contains pantry) additionally requires ≥4 chars or a space
      if (!item) {
        const nameLower = strippedName.toLowerCase()
        const candidates = allPantryItems.filter(i => {
          const pLower = i.name.toLowerCase()
          if (pLower.length < 3) return false
          if (pLower.includes(nameLower)) return true
          if (nameLower.includes(pLower)) return pLower.length >= 4 || pLower.includes(' ')
          return false
        })
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.name.length - b.name.length)
          item = candidates[0]
        }
      }

      if (!item) {
        results.push({ name: ingName, updated: false, reason: 'not_found' })
        continue
      }

      // Skip if units don't share the same canonical — avoids wrong cross-unit math (e.g. tbsp vs ml)
      const ingCanon = getCanonicalUnit(ing.unit)
      const itemCanon = getCanonicalUnit(item.unit)
      if (ingCanon !== itemCanon) {
        results.push({ name: ingName, updated: false, reason: 'unit_mismatch', recipeUnit: ing.unit || '', pantryUnit: item.unit })
        continue
      }

      const subtractAmt = parseFloat(ing.quantity) || 0
      const newQty = Math.max(0, item.quantity - subtractAmt)
      const normalized = normalizeUnit(newQty, item.unit)

      let newMax = item.maxQuantity
      if (!newMax) {
        const prevNorm = normalizeUnit(item.quantity, item.unit)
        if (prevNorm?.normalizedQty) newMax = prevNorm.normalizedQty
      }

      const updated = await prisma.pantryItem.update({
        where: { id: item.id },
        data: {
          quantity: newQty,
          normalizedQty: normalized?.normalizedQty ?? item.normalizedQty,
          maxQuantity: newMax,
          lastUsedAt: new Date(),
        },
      })

      // Record in usage history so cooking counts toward waste-savings stats
      try {
        await prisma.itemUsageHistory.create({
          data: {
            itemName: item.name,
            category: item.category,
            predictedExpiry: null,
            actualExpiry: item.expiry || null,
            removalReason: 'cooked',
            removedAt: new Date(),
            familyId: req.user.familyId,
          },
        })
      } catch (histErr) {
        console.error('ItemUsageHistory write failed (non-fatal):', histErr.message)
      }

      results.push({ name: ingName, updated: true, remaining: newQty, unit: updated.unit, matchedItem: item.name })
    }

    res.json({ success: true, results })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to subtract ingredients' })
  }
}
exports.restockItem = async (req, res) => {
  try {
    const { id } = req.params
    const { quantity } = req.body

    const existing = await prisma.pantryItem.findFirst({
      where: { id, familyId: req.user.familyId }
    })

    if (!existing) return res.status(404).json({ error: 'Item not found' })

    const newQty = existing.quantity + parseFloat(quantity)
    const normalized = normalizeUnit(newQty, existing.unit)

    let newMax = existing.maxQuantity
    if (normalized?.normalizedQty != null && (!newMax || normalized.normalizedQty > newMax)) {
      newMax = normalized.normalizedQty
    }

    const updated = await prisma.pantryItem.update({
      where: { id },
      data: {
        quantity: newQty,
        normalizedQty: normalized?.normalizedQty ?? existing.normalizedQty,
        maxQuantity: newMax,
      }
    })

    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to restock item' })
  }
}
exports.parseVoiceItem = async (req, res) => {
  try {
    const { transcript, mode } = req.body
    if (!transcript) return res.status(400).json({ error: 'No transcript provided' })

    const isGrocery = mode === 'grocery'

    const prompt = `Parse this voice input into a structured ${isGrocery ? 'grocery' : 'pantry'} item.

Voice input: "${transcript}"

Extract:
- name: the item name (include brand if mentioned)
- quantity: numeric amount (default 1)
- unit: one of: pcs, dozen, kg, g, mg, L, ml, lb, oz, cup, tbsp, tsp, gallon (pick best fit, default "pcs")
${isGrocery ? '' : '- category: one of: Fridge, Freezer, Dry goods, Spices, Snacks (pick best fit, default "Fridge")'}
- icon: a single relevant emoji

Examples:
"2 litres of milk" → {"name":"Milk","quantity":2,"unit":"L","category":"Fridge","icon":"🥛"}
"add chicken breast to freezer" → {"name":"Chicken breast","quantity":1,"unit":"pcs","category":"Freezer","icon":"🍗"}
"500 grams of rice" → {"name":"Rice","quantity":500,"unit":"g","category":"Dry goods","icon":"🍚"}
"a dozen eggs" → {"name":"Eggs","quantity":12,"unit":"pcs","category":"Fridge","icon":"🥚"}
"olive oil" → {"name":"Olive oil","quantity":1,"unit":"pcs","category":"Dry goods","icon":"🫙"}

Respond ONLY with a valid JSON object, no other text.`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: 'You are a JSON API. Respond ONLY with raw JSON. No markdown, no backticks, no explanation. Start with { and end with }.',
      messages: [{ role: 'user', content: prompt }],
    })

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(text)

    res.json(parsed)
  } catch (err) {
    console.error('Voice parse error:', err)
    res.status(500).json({ error: 'Failed to parse voice input' })
  }
}