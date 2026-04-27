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
exports.generateWeekPlan = async (req, res) => {
  try {
    const { weekStart } = req.body
    const familyId = req.user.familyId

    const Anthropic = require('@anthropic-ai/sdk')
    const { getMealPatternContext } = require('./mealPatternController')
    const { getSeasonalContext } = require('../utils/seasons')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Get pantry, members, patterns, seasonal context
    const [pantryItems, allMembers] = await Promise.all([
      prisma.pantryItem.findMany({ where: { familyId } }),
      prisma.member.findMany({ where: { familyId } })
    ])

    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')
    const memberDetails = allMembers.map((m, i) =>
      `Member ${i + 1}: age=${m.age || 'unknown'}, goals=${m.goals || 'healthy eating'}, dietary=${m.dietary || 'none'}, allergens=${m.allergens || 'none'}`
    ).join('; ')

    const mealPatternContext = await getMealPatternContext(familyId)
    const seasonal = getSeasonalContext()

    const prompt = `You are a family meal planning assistant. Generate a full week meal plan.

Family members: ${allMembers.length}
Health profiles: ${memberDetails || 'No specific data'}
Pantry items available: ${pantryList || 'Empty pantry'}

${mealPatternContext}
SEASONAL GUIDANCE: ${seasonal.context}

Generate exactly 28 meals — one for each slot:
- 7 days: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday  
- 4 meal types per day: Breakfast, Lunch, Dinner, Snack

Rules:
- Vary cuisines and styles across the week
- Consider health goals and allergens
- Prefer pantry ingredients where possible
- Keep breakfast and snacks simple
- Make dinners more substantial on weekends

Respond ONLY with valid JSON array, no markdown:
[
  {
    "day": "Monday",
    "mealType": "Breakfast",
    "recipeName": "Recipe name",
    "icon": "🍽️",
    "description": "One sentence description",
    "ingredients": [{"name": "item", "quantity": 1, "unit": "cup"}],
    "missing": [{"name": "item", "quantity": 1, "unit": "pcs"}],
    "time": "15 mins",
    "calories": 350
  }
]`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    })

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const generatedMeals = JSON.parse(text)

    // Delete existing meals for this week
    await prisma.mealPlan.deleteMany({
      where: { familyId, weekStart }
    })

    // Save all generated meals
    const saved = await Promise.all(
      generatedMeals.map(meal =>
        prisma.mealPlan.create({
          data: {
            weekStart,
            day: meal.day,
            mealType: meal.mealType,
            recipeName: meal.recipeName,
            recipeData: {
              icon: meal.icon,
              description: meal.description,
              ingredients: meal.ingredients || [],
              missing: meal.missing || [],
              time: meal.time,
              calories: meal.calories,
            },
            familyId
          }
        })
      )
    )

    res.json({ success: true, meals: saved, count: saved.length })
  } catch (err) {
    console.error('generateWeekPlan error:', err)
    res.status(500).json({ error: 'Failed to generate week plan' })
  }
}