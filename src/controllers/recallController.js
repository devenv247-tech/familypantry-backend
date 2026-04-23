const prisma = require('../utils/prisma')

const HEALTH_CANADA_URL = 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json'

exports.getRecalls = async (req, res) => {
  try {
    const response = await fetch(HEALTH_CANADA_URL)
    const data = await response.json()

    // Filter food recalls only from last 90 days
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const foodRecalls = data
      .filter(r => r.category?.toLowerCase().includes('food') || r.product_type?.toLowerCase().includes('food'))
      .filter(r => new Date(r.date_published) >= ninetyDaysAgo)
      .slice(0, 20)
      .map(r => ({
        id: r.recall_id || r.id,
        title: r.title || r.product_name,
        date: r.date_published,
        reason: r.reason || r.hazard,
        brand: r.brand || '',
        distribution: r.distribution || 'National',
        url: r.url || '',
        risk: r.risk_level || 'Unknown',
      }))

    res.json(foodRecalls)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch recalls' })
  }
}

exports.checkPantryMatches = async (req, res) => {
  try {
    const familyId = req.user.familyId

    // Get family pantry items
    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId }
    })

    if (pantryItems.length === 0) {
      return res.json({ matches: [], checked: 0 })
    }

    // Fetch recalls
    const response = await fetch(HEALTH_CANADA_URL)
    const data = await response.json()

    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const foodRecalls = data
      .filter(r => r.category?.toLowerCase().includes('food') || r.product_type?.toLowerCase().includes('food'))
      .filter(r => new Date(r.date_published) >= ninetyDaysAgo)

    // Match recalls against pantry items
    const matches = []
    for (const recall of foodRecalls) {
      const recallTitle = (recall.title || recall.product_name || '').toLowerCase()
      const recallBrand = (recall.brand || '').toLowerCase()

      for (const item of pantryItems) {
        const itemName = item.name.toLowerCase()
        if (
          recallTitle.includes(itemName) ||
          itemName.includes(recallTitle.split(' ')[0]) ||
          (recallBrand && itemName.includes(recallBrand))
        ) {
          matches.push({
            pantryItem: item.name,
            recallTitle: recall.title || recall.product_name,
            date: recall.date_published,
            reason: recall.reason || recall.hazard,
            risk: recall.risk_level || 'Unknown',
            url: recall.url || '',
          })
        }
      }
    }

    res.json({
      matches,
      checked: pantryItems.length,
      recallsScanned: foodRecalls.length,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to check pantry matches' })
  }
}