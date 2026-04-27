const prisma = require('../utils/prisma')
const { calculatePantryCO2, getCO2Score, getCO2Label } = require('../utils/co2')
const { analyzeBulkBuying } = require('../utils/costco')

// Get CO2 footprint for pantry
const getPantryCO2 = async (req, res) => {
  try {
    const familyId = req.user.familyId

    const items = await prisma.pantryItem.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' }
    })

    const result = calculatePantryCO2(items)

    res.json(result)
  } catch (err) {
    console.error('getPantryCO2 error:', err)
    res.status(500).json({ error: 'Failed to calculate CO2 footprint' })
  }
}

// Get Costco bulk buying recommendations
const getCostcoRecommendations = async (req, res) => {
  try {
    const familyId = req.user.familyId

    // Get pantry items
    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId }
    })

    // Get purchase history for usage rate calculation
    const purchaseHistory = await prisma.groceryItem.findMany({
      where: {
        familyId,
        purchased: true,
        purchasedAt: { not: null }
      },
      orderBy: { purchasedAt: 'desc' },
      take: 100
    })

    const recommendations = analyzeBulkBuying(pantryItems, purchaseHistory)

    res.json({
      recommendations,
      hasData: recommendations.length > 0,
      pantryCount: pantryItems.length
    })
  } catch (err) {
    console.error('getCostcoRecommendations error:', err)
    res.status(500).json({ error: 'Failed to get Costco recommendations' })
  }
}

// Get CO2 score for a single item (used inline)
const getItemCO2 = async (req, res) => {
  try {
    const { itemName } = req.params
    const co2PerKg = getCO2Score(itemName)
    const label = getCO2Label(co2PerKg)

    res.json({ itemName, co2PerKg, label })
  } catch (err) {
    console.error('getItemCO2 error:', err)
    res.status(500).json({ error: 'Failed to get CO2 score' })
  }
}

module.exports = { getPantryCO2, getCostcoRecommendations, getItemCO2 }