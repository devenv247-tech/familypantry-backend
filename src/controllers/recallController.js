const prisma = require('../utils/prisma')

const HEALTH_CANADA_URL = 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json'

const fetchRecallData = async () => {
  const response = await fetch(HEALTH_CANADA_URL)
  const data = await response.json()

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  return data.filter(r => {
    const isFood = (r.Category || '').toLowerCase().includes('food') ||
                   (r.Category || '').toLowerCase().includes('multiple')
    const date = new Date(r['Last updated'])
    const isRecent = date >= ninetyDaysAgo
    const isActive = r.Archived === '0'
    return isFood && isRecent && isActive
  })
}

exports.getRecalls = async (req, res) => {
  try {
    const family = await prisma.family.findUnique({ where: { id: req.user.familyId } })
    if (family.plan === 'free') {
      return res.status(403).json({
        error: 'Family plan feature',
        message: 'Health Canada recall alerts are available on the Family plan ($7/mo).',
        limitReached: true
      })
    }

    const foodRecalls = await fetchRecallData()

    const formatted = foodRecalls.slice(0, 30).map(r => ({
      id: r.NID,
      title: r.Title,
      date: r['Last updated'],
      reason: r.Issue,
      product: r.Product,
      distribution: r.Organization,
      url: r.URL,
      risk: r['Recall class'],
    }))

    res.json(formatted)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch recalls' })
  }
}

exports.checkPantryMatches = async (req, res) => {
  try {
    const familyId = req.user.familyId
    const family = await prisma.family.findUnique({ where: { id: familyId } })
    if (family.plan === 'free') {
      return res.status(403).json({
        error: 'Family plan feature',
        message: 'Pantry recall matching is available on the Family plan ($7/mo).',
        limitReached: true
      })
    }

    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId }
    })

    if (pantryItems.length === 0) {
      return res.json({ matches: [], checked: 0 })
    }

    const foodRecalls = await fetchRecallData()
    const matches = []

    for (const recall of foodRecalls) {
      const recallTitle = (recall.Title || '').toLowerCase()
      const recallProduct = (recall.Product || '').toLowerCase()

      for (const item of pantryItems) {
        const itemName = item.name.toLowerCase()
        const itemWords = itemName.split(' ').filter(w => w.length > 3)

       const titleMatch = recallTitle.includes(itemName) || itemName.includes(recallTitle)
const productMatch = recallProduct.includes(itemName) || itemName.includes(recallProduct)

// Only do word match if item name is specific enough (more than one word)
const itemWordCount = itemWords.length
const wordMatch = itemWordCount >= 2 && itemWords.every(word => 
  recallTitle.includes(word) || recallProduct.includes(word)
)

// Avoid duplicate matches for same item + recall combo
const alreadyMatched = matches.some(m => 
  m.pantryItem === item.name && m.recallTitle === recall.Title
)

if ((titleMatch || productMatch || wordMatch) && !alreadyMatched) {
          matches.push({
            pantryItem: item.name,
            recallTitle: recall.Title,
            product: recall.Product,
            date: recall['Last updated'],
            reason: recall.Issue,
            risk: recall['Recall class'],
            url: recall.URL,
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
exports.getTodaysRecalls = async (req, res) => {
  try {
    const family = await prisma.family.findUnique({ where: { id: req.user.familyId } })
    if (family.plan === 'free') {
      return res.status(403).json({
        error: 'Family plan feature',
        message: 'Recall alerts are available on the Family plan ($7/mo).',
        limitReached: true
      })
    }

    const response = await fetch(HEALTH_CANADA_URL)
    const data = await response.json()

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Also get last 7 days since not every day has recalls
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const recentRecalls = data.filter(r => {
      const date = new Date(r['Last updated'])
      const isRecent = date >= sevenDaysAgo
      const isActive = r.Archived === '0'
      return isRecent && isActive
    })

    const formatted = recentRecalls.map(r => ({
      id: r.NID,
      title: r.Title,
      date: r['Last updated'],
      reason: r.Issue,
      product: r.Product,
      category: r.Category,
      distribution: r.Organization,
      url: r.URL,
      risk: r['Recall class'],
      isFood: (r.Category || '').toLowerCase().includes('food') ||
              (r.Category || '').toLowerCase().includes('multiple'),
    }))

    res.json(formatted)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch recent recalls' })
  }
}