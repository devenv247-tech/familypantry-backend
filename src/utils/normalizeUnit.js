// Unit normalization utility
// Converts any quantity + unit to a base unit (g, ml, or count)
// Used by prediction engine for percentage-based stock tracking

const WEIGHT_TO_GRAMS = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.59, lbs: 453.59, pound: 453.59, pounds: 453.59,
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
}

const VOLUME_TO_ML = {
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
  tsp: 4.93, teaspoon: 4.93, teaspoons: 4.93,
  tbsp: 14.79, tablespoon: 14.79, tablespoons: 14.79,
  cup: 236.59, cups: 236.59,
  floz: 29.57, 'fl oz': 29.57,
  pint: 473.18, pints: 473.18,
  quart: 946.35, quarts: 946.35,
  gallon: 3785.41, gallons: 3785.41,
}

const COUNT_UNITS = [
  'pcs', 'pc', 'piece', 'pieces',
  'item', 'items', 'unit', 'units',
  'each', 'ea',
  'pack', 'packs', 'package', 'packages',
  'bag', 'bags', 'box', 'boxes',
  'can', 'cans', 'bottle', 'bottles',
  'bunch', 'bunches', 'head', 'heads',
  'clove', 'cloves', 'slice', 'slices',
  'sheet', 'sheets', 'roll', 'rolls',
  'dozen', 'loaf', 'loaves',
]

// Spice detection — items with these units or names get isSpice = true
const SPICE_KEYWORDS = [
  'saffron', 'cardamom', 'clove', 'cloves', 'nutmeg', 'turmeric',
  'cumin', 'coriander', 'paprika', 'cayenne', 'chili powder', 'chilli',
  'cinnamon', 'bay leaf', 'bay leaves', 'star anise', 'fennel seed',
  'mustard seed', 'fenugreek', 'asafoetida', 'hing', 'mace',
  'allspice', 'caraway', 'celery seed', 'dill seed', 'poppy seed',
]

/**
 * Normalize a quantity + unit into a base unit
 * @param {number} quantity
 * @param {string} unit
 * @returns {{ normalizedQty: number, normalizedUnit: 'g' | 'ml' | 'count' } | null}
 */
const normalizeUnit = (quantity, unit) => {
  if (!quantity || isNaN(quantity)) return null

  const q = parseFloat(quantity)
  const u = (unit || '').toLowerCase().trim()

  if (!u || COUNT_UNITS.includes(u)) {
    return { normalizedQty: q, normalizedUnit: 'count' }
  }

  if (WEIGHT_TO_GRAMS[u]) {
    return { normalizedQty: parseFloat((q * WEIGHT_TO_GRAMS[u]).toFixed(4)), normalizedUnit: 'g' }
  }

  if (VOLUME_TO_ML[u]) {
    return { normalizedQty: parseFloat((q * VOLUME_TO_ML[u]).toFixed(4)), normalizedUnit: 'ml' }
  }

  // Unknown unit — treat as count
  return { normalizedQty: q, normalizedUnit: 'count' }
}

/**
 * Detect if an item is a spice based on its name
 * @param {string} itemName
 * @returns {boolean}
 */
const detectIsSpice = (itemName) => {
  if (!itemName) return false
  const name = itemName.toLowerCase().trim()
  return SPICE_KEYWORDS.some(keyword => name.includes(keyword))
}

/**
 * Calculate stock percentage
 * @param {number} normalizedQty
 * @param {number} maxQuantity
 * @returns {number | null} percentage 0-100, or null if maxQuantity unknown
 */
const getStockPercent = (normalizedQty, maxQuantity) => {
  if (!maxQuantity || maxQuantity <= 0) return null
  return parseFloat(((normalizedQty / maxQuantity) * 100).toFixed(1))
}

module.exports = { normalizeUnit, detectIsSpice, getStockPercent, COUNT_UNITS }