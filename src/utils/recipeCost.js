// Canadian average grocery prices (CAD) per common unit
// Used as fallback when no purchase history exists
const CA_PRICE_ESTIMATES = {
  // Proteins
  'chicken': { price: 0.015, unit: 'g' }, // ~$15/kg
  'chicken breast': { price: 0.018, unit: 'g' },
  'beef': { price: 0.025, unit: 'g' },
  'ground beef': { price: 0.018, unit: 'g' },
  'pork': { price: 0.014, unit: 'g' },
  'salmon': { price: 0.03, unit: 'g' },
  'fish': { price: 0.02, unit: 'g' },
  'eggs': { price: 0.35, unit: 'pcs' },
  'tofu': { price: 0.005, unit: 'g' },
  'lentils': { price: 0.004, unit: 'g' },
  'chickpeas': { price: 0.004, unit: 'g' },
  'beans': { price: 0.004, unit: 'g' },

  // Dairy
  'milk': { price: 0.003, unit: 'ml' },
  'cheese': { price: 0.02, unit: 'g' },
  'butter': { price: 0.015, unit: 'g' },
  'yogurt': { price: 0.006, unit: 'g' },
  'cream': { price: 0.005, unit: 'ml' },

  // Grains
  'rice': { price: 0.003, unit: 'g' },
  'pasta': { price: 0.004, unit: 'g' },
  'bread': { price: 0.007, unit: 'g' },
  'flour': { price: 0.002, unit: 'g' },
  'oats': { price: 0.003, unit: 'g' },
  'quinoa': { price: 0.008, unit: 'g' },

  // Vegetables
  'onion': { price: 0.5, unit: 'pcs' },
  'onions': { price: 0.5, unit: 'pcs' },
  'garlic': { price: 0.1, unit: 'pcs' },
  'tomato': { price: 0.5, unit: 'pcs' },
  'tomatoes': { price: 0.5, unit: 'pcs' },
  'potato': { price: 0.4, unit: 'pcs' },
  'potatoes': { price: 0.4, unit: 'pcs' },
  'carrot': { price: 0.3, unit: 'pcs' },
  'carrots': { price: 0.3, unit: 'pcs' },
  'spinach': { price: 0.004, unit: 'g' },
  'broccoli': { price: 0.005, unit: 'g' },
  'pepper': { price: 0.8, unit: 'pcs' },
  'bell pepper': { price: 0.8, unit: 'pcs' },

  // Pantry staples
  'olive oil': { price: 0.02, unit: 'ml' },
  'oil': { price: 0.01, unit: 'ml' },
  'salt': { price: 0.001, unit: 'g' },
  'sugar': { price: 0.002, unit: 'g' },
  'soy sauce': { price: 0.008, unit: 'ml' },
  'tomato paste': { price: 0.006, unit: 'g' },
  'coconut milk': { price: 0.005, unit: 'ml' },
}

// Convert any unit to the base unit for price lookup
const normalizeQuantity = (quantity, unit) => {
  const q = parseFloat(quantity) || 1
  const u = (unit || '').toLowerCase()

  // Convert to grams
  if (u === 'kg') return { quantity: q * 1000, unit: 'g' }
  if (u === 'lb') return { quantity: q * 453, unit: 'g' }
  if (u === 'oz') return { quantity: q * 28, unit: 'g' }
  if (u === 'mg') return { quantity: q / 1000, unit: 'g' }

  // Convert to ml
  if (u === 'l') return { quantity: q * 1000, unit: 'ml' }
  if (u === 'cup') return { quantity: q * 240, unit: 'ml' }
  if (u === 'tbsp') return { quantity: q * 15, unit: 'ml' }
  if (u === 'tsp') return { quantity: q * 5, unit: 'ml' }

  return { quantity: q, unit: u || 'pcs' }
}

const estimateIngredientCost = (ingredientName, quantity, unit, priceHistory) => {
  const name = ingredientName.toLowerCase().trim()
  const normalized = normalizeQuantity(quantity, unit)

  // 1. Try price history first (family's actual prices)
  const historyMatch = priceHistory.find(h =>
    h.itemName.toLowerCase().includes(name) ||
    name.includes(h.itemName.toLowerCase())
  )

  if (historyMatch) {
    // Price history stores total price for a purchase qty — use as per-unit estimate
    return parseFloat((historyMatch.price * (normalized.quantity / 100)).toFixed(2))
  }

  // 2. Try GroceryItem price history
  // Already merged into priceHistory param

  // 3. Fall back to Canadian averages
  let estimate = null
  for (const [key, data] of Object.entries(CA_PRICE_ESTIMATES)) {
    if (name.includes(key) || key.includes(name)) {
      const cost = data.price * normalized.quantity
      estimate = parseFloat(cost.toFixed(2))
      break
    }
  }

  return estimate // null if completely unknown
}

const estimateRecipeCost = (recipe, priceHistory) => {
  if (!recipe.ingredients || recipe.ingredients.length === 0) return null

  let totalCost = 0
  let estimatedCount = 0
  let unknownCount = 0

  const allIngredients = [
    ...(recipe.ingredients || []),
    ...(recipe.missing || [])
  ]

  allIngredients.forEach(ing => {
    const name = typeof ing === 'string' ? ing : ing.name
    const qty = typeof ing === 'string' ? 1 : ing.quantity
    const unit = typeof ing === 'string' ? 'pcs' : ing.unit

    const cost = estimateIngredientCost(name, qty, unit, priceHistory)
    if (cost !== null) {
      totalCost += cost
      estimatedCount++
    } else {
      unknownCount++
    }
  })

  if (estimatedCount === 0) return null

  const serves = recipe.serves || 1
  const costPerServing = parseFloat((totalCost / serves).toFixed(2))

  return {
    totalCost: parseFloat(totalCost.toFixed(2)),
    costPerServing,
    serves,
    isEstimate: unknownCount > 0,
    confidence: estimatedCount / (estimatedCount + unknownCount),
  }
}

module.exports = { estimateRecipeCost }