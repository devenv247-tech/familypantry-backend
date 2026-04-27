// Costco Canada reference prices per unit
const COSTCO_PRICES = {
  'chicken breast': { price: 28.99, size: '2.5kg', pricePerKg: 11.60 },
  'chicken': { price: 28.99, size: '2.5kg', pricePerKg: 11.60 },
  'ground beef': { price: 32.99, size: '2.7kg', pricePerKg: 12.22 },
  'beef': { price: 32.99, size: '2.7kg', pricePerKg: 12.22 },
  'salmon': { price: 29.99, size: '1.8kg', pricePerKg: 16.66 },
  'shrimp': { price: 24.99, size: '1kg', pricePerKg: 24.99 },
  'eggs': { price: 12.99, size: '60 pcs', pricePerKg: null, pricePerUnit: 0.22 },
  'milk': { price: 9.99, size: '4L', pricePerKg: 2.50 },
  'homo milk': { price: 9.99, size: '4L', pricePerKg: 2.50 },
  'butter': { price: 17.99, size: '2kg', pricePerKg: 9.00 },
  'cheese': { price: 19.99, size: '2kg', pricePerKg: 10.00 },
  'cheddar': { price: 19.99, size: '2kg', pricePerKg: 10.00 },
  'greek yogurt': { price: 11.99, size: '2kg', pricePerKg: 6.00 },
  'yogurt': { price: 11.99, size: '2kg', pricePerKg: 6.00 },
  'olive oil': { price: 19.99, size: '3L', pricePerKg: 6.66 },
  'oil': { price: 14.99, size: '3L', pricePerKg: 5.00 },
  'rice': { price: 16.99, size: '10kg', pricePerKg: 1.70 },
  'basmati rice': { price: 16.99, size: '10kg', pricePerKg: 1.70 },
  'pasta': { price: 11.99, size: '4.5kg', pricePerKg: 2.66 },
  'flour': { price: 14.99, size: '10kg', pricePerKg: 1.50 },
  'oats': { price: 12.99, size: '4kg', pricePerKg: 3.25 },
  'protein oats': { price: 24.99, size: '2.27kg', pricePerKg: 11.00 },
  'almonds': { price: 18.99, size: '1.13kg', pricePerKg: 16.80 },
  'cashews': { price: 17.99, size: '1kg', pricePerKg: 17.99 },
  'peanut butter': { price: 11.99, size: '2kg', pricePerKg: 6.00 },
  'olive oil': { price: 19.99, size: '3L', pricePerKg: 6.66 },
  'sugar': { price: 11.99, size: '10kg', pricePerKg: 1.20 },
  'toilet paper': { price: 24.99, size: '30 rolls', pricePerKg: null },
  'paper towels': { price: 22.99, size: '12 rolls', pricePerKg: null },
  'dish soap': { price: 12.99, size: '2.4L', pricePerKg: 5.41 },
  'laundry detergent': { price: 19.99, size: '5.1kg', pricePerKg: 3.92 },
  'garbage bags': { price: 19.99, size: '150 bags', pricePerKg: null },
  'orange juice': { price: 12.99, size: '2.63L', pricePerKg: 4.94 },
  'coffee': { price: 24.99, size: '1.36kg', pricePerKg: 18.38 },
  'frozen vegetables': { price: 9.99, size: '2kg', pricePerKg: 5.00 },
  'frozen fruit': { price: 12.99, size: '2kg', pricePerKg: 6.50 },
  'bread': { price: 8.99, size: '2 loaves', pricePerKg: null },
  'tortilla': { price: 8.99, size: '40 pcs', pricePerKg: null },
  'tortillas': { price: 8.99, size: '40 pcs', pricePerKg: null },
}

// Regular store average prices per kg for comparison
const REGULAR_PRICES = {
  'chicken breast': 14.99, 'chicken': 14.99, 'ground beef': 15.99,
  'beef': 15.99, 'salmon': 22.99, 'shrimp': 29.99,
  'eggs': 0.40, // per unit
  'milk': 3.50, 'homo milk': 3.50, 'butter': 12.99, 'cheese': 13.99,
  'cheddar': 13.99, 'greek yogurt': 8.99, 'yogurt': 8.99,
  'olive oil': 10.99, 'oil': 7.99, 'rice': 3.49, 'basmati rice': 3.49,
  'pasta': 3.99, 'flour': 2.49, 'oats': 4.99, 'protein oats': 15.99,
  'almonds': 22.99, 'cashews': 24.99, 'peanut butter': 8.99,
  'sugar': 1.99, 'orange juice': 6.99, 'coffee': 29.99,
  'frozen vegetables': 7.99, 'frozen fruit': 9.99,
}

const analyzeBulkBuying = (pantryItems, purchaseHistory) => {
  const recommendations = []

  // Get unique item names from pantry
  const pantryNames = [...new Set(pantryItems.map(i => i.name.toLowerCase().trim()))]

  for (const itemName of pantryNames) {
    // Check if Costco carries this item
    let costcoData = null
    let regularPrice = null

    for (const [key, data] of Object.entries(COSTCO_PRICES)) {
      if (itemName.includes(key) || key.includes(itemName.split(' ')[0])) {
        costcoData = { ...data, matchedKey: key }
        break
      }
    }

    if (!costcoData) continue

    // Get regular price
    for (const [key, price] of Object.entries(REGULAR_PRICES)) {
      if (itemName.includes(key) || key.includes(itemName.split(' ')[0])) {
        regularPrice = price
        break
      }
    }

    if (!regularPrice || !costcoData.pricePerKg) continue

    // Calculate savings
    const savingsPerKg = regularPrice - costcoData.pricePerKg
    const savingsPercent = Math.round((savingsPerKg / regularPrice) * 100)

    // Calculate usage rate from purchase history
    const itemHistory = purchaseHistory.filter(h =>
      h.name.toLowerCase().includes(itemName.split(' ')[0])
    )

    let usageRate = null
    let usageText = 'Unknown usage rate'
    let bulkRecommended = false
    let reason = ''

    if (itemHistory.length >= 2) {
      // Calculate average days between purchases
      const dates = itemHistory
        .map(h => new Date(h.purchasedAt))
        .sort((a, b) => a - b)

      const totalDays = (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24)
      const avgDaysBetween = totalDays / (dates.length - 1)
      usageRate = Math.round(avgDaysBetween)
      usageText = `You buy this every ~${usageRate} days`
    }

    // Determine recommendation
    if (savingsPercent >= 20) {
      if (usageRate && usageRate <= 14) {
        bulkRecommended = true
        reason = `High usage + ${savingsPercent}% cheaper at Costco`
      } else if (usageRate && usageRate <= 30) {
        bulkRecommended = true
        reason = `${savingsPercent}% cheaper — good if you have storage space`
      } else if (!usageRate) {
        bulkRecommended = null // unknown
        reason = `${savingsPercent}% cheaper but usage rate unknown`
      } else {
        bulkRecommended = false
        reason = `Good price but you use it slowly — may expire`
      }
    } else if (savingsPercent > 0) {
      bulkRecommended = null
      reason = `Only ${savingsPercent}% cheaper — marginal savings`
    } else {
      bulkRecommended = false
      reason = 'Not cheaper at Costco for this item'
    }

    recommendations.push({
      itemName: itemName.charAt(0).toUpperCase() + itemName.slice(1),
      costcoPrice: costcoData.price,
      costcoSize: costcoData.size,
      costcoPricePerKg: costcoData.pricePerKg,
      regularPricePerKg: regularPrice,
      savingsPercent,
      savingsPerKg: parseFloat(savingsPerKg.toFixed(2)),
      usageText,
      usageRate,
      bulkRecommended,
      reason,
      icon: bulkRecommended === true ? '🟢' : bulkRecommended === false ? '🔴' : '🟡'
    })
  }

  // Sort: recommended first, then maybe, then not recommended
  return recommendations.sort((a, b) => {
    const order = { true: 0, null: 1, false: 2 }
    return order[a.bulkRecommended] - order[b.bulkRecommended]
  })
}

module.exports = { analyzeBulkBuying, COSTCO_PRICES }