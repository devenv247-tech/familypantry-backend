// CO2 emissions in kg per kg of food product
const CO2_TABLE = {
  // Beef & Lamb
  'beef': 27, 'ground beef': 27, 'steak': 27, 'lamb': 24, 'veal': 24,

  // Pork
  'pork': 7, 'bacon': 7, 'ham': 7, 'pork chops': 7, 'sausage': 7,

  // Poultry
  'chicken': 6, 'chicken breast': 6, 'chicken thighs': 6, 'whole chicken': 6,
  'turkey': 6, 'ground turkey': 6,

  // Fish & Seafood
  'salmon': 6, 'tuna': 6, 'shrimp': 12, 'fish': 5, 'cod': 5,
  'tilapia': 5, 'halibut': 5, 'crab': 7, 'lobster': 7,

  // Dairy
  'cheese': 11, 'cheddar': 11, 'mozzarella': 11, 'parmesan': 11,
  'butter': 9, 'cream': 4, 'heavy cream': 4, 'whipping cream': 4,
  'milk': 3, 'homo milk': 3, '2% milk': 3, 'skim milk': 3,
  'yogurt': 3, 'greek yogurt': 3, 'sour cream': 3, 'cream cheese': 5,

  // Eggs
  'eggs': 4, 'egg': 4,

  // Legumes (very low)
  'lentils': 0.9, 'chickpeas': 0.9, 'beans': 0.9, 'black beans': 0.9,
  'kidney beans': 0.9, 'peas': 0.9, 'tofu': 2, 'tempeh': 2,

  // Grains
  'rice': 3, 'basmati rice': 3, 'pasta': 1.5, 'bread': 1.5,
  'flour': 0.9, 'oats': 1.5, 'cereal': 2, 'granola': 2,
  'protein oats': 1.5,

  // Vegetables (very low)
  'spinach': 0.5, 'lettuce': 0.5, 'kale': 0.5, 'broccoli': 0.5,
  'cauliflower': 0.5, 'cabbage': 0.5, 'carrots': 0.5, 'celery': 0.5,
  'cucumber': 0.5, 'zucchini': 0.5, 'bell pepper': 0.5, 'pepper': 0.5,
  'tomato': 0.7, 'tomatoes': 0.7, 'onion': 0.5, 'onions': 0.5,
  'garlic': 0.5, 'ginger': 0.5, 'potato': 0.5, 'potatoes': 0.5,
  'sweet potato': 0.5, 'corn': 0.5, 'mushrooms': 0.5, 'mushroom': 0.5,
  'asparagus': 0.5, 'beets': 0.5, 'squash': 0.5, 'pumpkin': 0.5,

  // Fruits
  'banana': 0.7, 'bananas': 0.7, 'apple': 0.4, 'apples': 0.4,
  'orange': 0.4, 'oranges': 0.4, 'lemon': 0.4, 'lemons': 0.4,
  'grapes': 0.9, 'strawberries': 0.5, 'blueberries': 0.7,
  'raspberries': 0.5, 'mango': 0.9, 'pineapple': 0.9,
  'watermelon': 0.3, 'avocado': 1.2, 'avocados': 1.2,

  // Oils & Condiments
  'olive oil': 3.5, 'oil': 3, 'butter': 9, 'peanut butter': 2.5,

  // Nuts
  'almonds': 2.5, 'cashews': 2.5, 'walnuts': 2.5, 'nuts': 2.5,

  // Beverages
  'orange juice': 0.9, 'apple juice': 0.9, 'almond milk': 0.7,
  'oat milk': 0.9, 'soy milk': 0.9,
}

const getCO2Score = (itemName) => {
  const name = itemName.toLowerCase().trim()

  // Exact match
  if (CO2_TABLE[name]) return CO2_TABLE[name]

  // Partial match
  for (const [key, co2] of Object.entries(CO2_TABLE)) {
    if (name.includes(key) || key.includes(name)) return co2
  }

  return null
}

const getCO2Label = (co2) => {
  if (co2 === null) return null
  if (co2 <= 1) return { label: 'Very low', color: 'green', icon: '🌱' }
  if (co2 <= 3) return { label: 'Low', color: 'green', icon: '🌿' }
  if (co2 <= 7) return { label: 'Medium', color: 'yellow', icon: '🟡' }
  if (co2 <= 15) return { label: 'High', color: 'orange', icon: '🔴' }
  return { label: 'Very high', color: 'red', icon: '💨' }
}

const calculatePantryCO2 = (items) => {
  let total = 0
  const itemsWithCO2 = items.map(item => {
    const co2PerKg = getCO2Score(item.name)
    if (!co2PerKg) return { ...item, co2: null, co2Label: null }

    // Convert quantity to kg for calculation
    let qtyInKg = item.quantity || 1
    const unit = (item.unit || '').toLowerCase()
    if (unit === 'g' || unit === 'mg') qtyInKg = qtyInKg / 1000
    if (unit === 'lb') qtyInKg = qtyInKg * 0.453
    if (unit === 'oz') qtyInKg = qtyInKg * 0.0283
    if (['pcs', 'cup', 'tbsp', 'tsp', 'l', 'ml'].includes(unit)) qtyInKg = 0.3 // estimate

    const itemCO2 = co2PerKg * qtyInKg
    total += itemCO2

    return {
      ...item,
      co2PerKg,
      co2Total: parseFloat(itemCO2.toFixed(2)),
      co2Label: getCO2Label(co2PerKg)
    }
  })

  return {
    items: itemsWithCO2,
    totalCO2: parseFloat(total.toFixed(2)),
    canadianAvgMonthly: 60, // kg CO2 per month average Canadian food footprint
    comparison: total > 0 ? Math.round(((total - 60) / 60) * 100) : null
  }
}

module.exports = { getCO2Score, getCO2Label, calculatePantryCO2 }