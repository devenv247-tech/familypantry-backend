const prisma = require('../utils/prisma')

const getWeekStart = (date = new Date()) => {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

exports.getMealPlan = async (req, res) => {
  try {
    const { weekStart } = req.query
    const week = weekStart || getWeekStart()

    const meals = await prisma.mealPlan.findMany({
      where: {
        familyId: req.user.familyId,
        weekStart: week,
      },
      orderBy: { createdAt: 'asc' }
    })

    res.json({ weekStart: week, meals })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch meal plan' })
  }
}

exports.saveMeal = async (req, res) => {
  try {
    const { weekStart, day, mealType, recipeName, recipeData } = req.body

    if (!weekStart || !day || !mealType || !recipeName) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Upsert — replace if exists for same slot
    const existing = await prisma.mealPlan.findFirst({
      where: {
        familyId: req.user.familyId,
        weekStart,
        day,
        mealType,
      }
    })

    let meal
    if (existing) {
      meal = await prisma.mealPlan.update({
        where: { id: existing.id },
        data: { recipeName, recipeData: recipeData || {} }
      })
    } else {
      meal = await prisma.mealPlan.create({
        data: {
          weekStart,
          day,
          mealType,
          recipeName,
          recipeData: recipeData || {},
          familyId: req.user.familyId,
        }
      })
    }

    res.json(meal)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save meal' })
  }
}

exports.deleteMeal = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.mealPlan.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Meal not found' })
    await prisma.mealPlan.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete meal' })
  }
}

exports.generateGroceryFromPlan = async (req, res) => {
  try {
    const { weekStart } = req.body

    const meals = await prisma.mealPlan.findMany({
      where: {
        familyId: req.user.familyId,
        weekStart,
      }
    })

    if (meals.length === 0) {
      return res.status(400).json({ error: 'No meals planned for this week' })
    }

    // Collect all missing ingredients from all planned meals
    const allMissing = []
    for (const meal of meals) {
      const recipeData = meal.recipeData
      if (recipeData?.missing?.length > 0) {
        recipeData.missing.forEach(item => {
          const name = typeof item === 'string' ? item : item.name
          const qty = typeof item === 'string' ? '' : `${item.quantity} ${item.unit}`
          allMissing.push({ name, qty })
        })
      }
    }

    // Deduplicate
    const seen = new Set()
    const unique = allMissing.filter(item => {
      if (seen.has(item.name.toLowerCase())) return false
      seen.add(item.name.toLowerCase())
      return true
    })

    // Add to grocery list
    const added = []
    for (const item of unique) {
      const existing = await prisma.groceryItem.findFirst({
        where: {
          familyId: req.user.familyId,
          name: { equals: item.name, mode: 'insensitive' }
        }
      })
      if (!existing) {
        const grocery = await prisma.groceryItem.create({
          data: {
            name: item.name,
            qty: item.qty,
            category: 'Meal plan ingredient',
            familyId: req.user.familyId,
          }
        })
        added.push(grocery)
      }
    }

    res.json({
      success: true,
      added: added.length,
      message: `Added ${added.length} items to your grocery list`
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to generate grocery list' })
  }
}