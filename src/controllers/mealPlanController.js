const prisma = require('../utils/prisma')
const Anthropic = require('@anthropic-ai/sdk')
const { getMealPatternContext } = require('./mealPatternController')
const { getSeasonalContext } = require('../utils/seasons')

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
    const { weekStart, selectedMembers, selectedCuisines } = req.body
    const familyId = req.user.familyId
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Get pantry, members, patterns, seasonal context
    const [pantryItems, allMembers] = await Promise.all([
      prisma.pantryItem.findMany({ where: { familyId } }),
      prisma.member.findMany({ where: { familyId } })
    ])

    // Filter to selected members if provided, otherwise use all
    const targetMembers = selectedMembers && selectedMembers.length > 0
      ? allMembers.filter(m => selectedMembers.includes(m.name))
      : allMembers

    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')
   // Privacy — use anonymous labels, never send real names to Claude
    const memberLabels = ['Person A', 'Person B', 'Person C', 'Person D', 'Person E', 'Person F']
    const memberMap = {} // maps label back to real name for internal use only
    const memberDetails = targetMembers.map((m, i) => {
      const label = memberLabels[i] || `Person ${i + 1}`
      memberMap[label] = m.name
      return `${label}: age=${m.age || 'unknown'}, goals=${m.goals || 'healthy eating'}, dietary=${m.dietary || 'none'}, allergens=${m.allergens || 'none'}`
    }).join('; ')

    const mealPatternContext = await getMealPatternContext(familyId)
    const seasonal = getSeasonalContext()

    const cuisineInstruction = selectedCuisines && selectedCuisines.length > 0
      ? `CUISINE REQUIREMENT: Rotate meals across these cuisines only: ${selectedCuisines.join(', ')}`
      : 'CUISINE REQUIREMENT: Vary cuisines across the week — mix Punjabi, South Asian, Italian, Mexican, Canadian, Chinese, Middle Eastern'

    const prompt = `You are a professional family meal planning assistant. Generate a detailed full week meal plan.

Family members: ${targetMembers.length} (${Object.keys(memberMap).join(', ')})
Health profiles: ${memberDetails || 'No specific data'}
Pantry items available: ${pantryList || 'Empty pantry'}

${mealPatternContext}
SEASONAL GUIDANCE: ${seasonal.context}
${cuisineInstruction}

Generate exactly 28 meals — one for each slot:
- 7 days: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
- 4 meal types per day: Breakfast, Lunch, Dinner, Snack

ALLERGEN RULES - STRICTLY FOLLOW:
1. Check EVERY ingredient against EVERY person's allergens
2. Milk allergen: no milk, cream, butter, cheese, paneer, yogurt, whey, casein, lactose
3. Eggs allergen: no eggs, egg white, egg yolk, mayonnaise
4. Wheat/Gluten: no wheat, flour, bread, pasta, oats, barley, rye, tortilla, wrap
5. Peanuts: no peanuts, peanut butter, peanut oil
6. Tree nuts: no almonds, cashews, walnuts, pecans, pistachios
7. Even if recipe has allergen conflict, still include it but populate allergenWarnings fully

QUALITY RULES - VERY IMPORTANT:
- Every meal MUST have recipeName — never leave it blank or use "Leftover X"
- Steps must be detailed and clear — minimum 5 steps for breakfast/snack, minimum 7 steps for lunch/dinner
- Each step should be a complete instruction sentence, not just 2-3 words
- Ingredients must list realistic quantities from pantry and what needs to be bought
- Nutrition must be realistic and accurate for the meal
- Descriptions must mention which persons health goals this serves using Person A/B/C labels
- Breakfast: simple, 10-20 mins
- Snack: very simple, under 10 mins, light calories
- Lunch: medium complexity, 20-30 mins
- Dinner weekdays: medium, 25-40 mins
- Dinner weekends: more elaborate, 40-60 mins

Respond ONLY with valid JSON array, no markdown, no extra text:
[
  {
    "day": "Monday",
    "mealType": "Breakfast",
    "recipeName": "Full descriptive recipe name",
    "icon": "🍽️",
    "description": "Two sentence description mentioning Person A/B/C health goals and why this meal suits them",
    "ingredients": [
      {"name": "ingredient name", "quantity": 1, "unit": "cup"}
    ],
    "missing": [
      {"name": "ingredient name", "quantity": 1, "unit": "pcs"}
    ],
    "allergenWarnings": [
      {"member": "Person A", "allergen": "Milk", "ingredient": "Homo Milk"}
    ],
    "steps": [
      "Detailed step 1 with specific instructions",
      "Detailed step 2 with specific instructions",
      "Detailed step 3 with specific instructions",
      "Detailed step 4 with specific instructions",
      "Detailed step 5 with specific instructions"
    ],
    "time": "20 mins",
    "nutrition": {
      "calories": 350,
      "protein": 25,
      "carbs": 40,
      "fat": 10,
      "fiber": 5
    }
  }
]`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
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
    // Save all generated meals — filter out any without required fields
    const validMeals = generatedMeals.filter(meal => meal.day && meal.mealType && meal.recipeName)
    const saved = await Promise.all(
      validMeals.map(meal =>
        prisma.mealPlan.create({
          data: {
            weekStart,
            day: meal.day,
            mealType: meal.mealType,
            recipeName: meal.recipeName || 'Unnamed meal',
         recipeData: {
              icon: meal.icon,
              description: meal.description,
              ingredients: meal.ingredients || [],
              missing: meal.missing || [],
              allergenWarnings: (meal.allergenWarnings || []).map(w => ({
                ...w,
                member: memberMap[w.member] || w.member
              })),
              steps: meal.steps || [],
              time: meal.time,
              calories: meal.nutrition?.calories || meal.calories || null,
              nutrition: meal.nutrition || null,
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