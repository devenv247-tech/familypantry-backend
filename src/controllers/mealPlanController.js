const prisma = require('../utils/prisma')
const Anthropic = require('@anthropic-ai/sdk')
const { handleAnthropicError, trackApiUsage } = require('../utils/anthropicError')
const { getMealPatternContext } = require('./mealPatternController')
const { getSeasonalContext } = require('../utils/seasons')

const callClaude = async (anthropic, params, endpoint) => {
  const message = await anthropic.messages.create(params)
  await trackApiUsage(endpoint, message.usage?.input_tokens || 0, message.usage?.output_tokens || 0, params.model)
  return message
}

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

    const family = await prisma.family.findUnique({ where: { id: req.user.familyId } })
    if (family.plan !== 'premium') {
      return res.status(403).json({
        error: 'Premium feature',
        message: 'Adding meal plan to grocery list is available on the Premium plan ($15/mo).',
        limitReached: true
      })
    }

    const meals = await prisma.mealPlan.findMany({
      where: {
        familyId: req.user.familyId,
        weekStart,
      }
    })

    if (meals.length === 0) {
      return res.status(400).json({ error: 'No meals planned for this week' })
    }

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

    const seen = new Set()
    const unique = allMissing.filter(item => {
      if (seen.has(item.name.toLowerCase())) return false
      seen.add(item.name.toLowerCase())
      return true
    })

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

    const family = await prisma.family.findUnique({ where: { id: familyId } })
    if (family.plan !== 'premium') {
      return res.status(403).json({
        error: 'Premium feature',
        message: 'AI auto meal planning is available on the Premium plan ($15/mo). Upgrade to generate a full week of personalized meals.',
        limitReached: true
      })
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const [pantryItems, allMembers] = await Promise.all([
      prisma.pantryItem.findMany({ where: { familyId } }),
      prisma.member.findMany({ where: { familyId } })
    ])

    const targetMembers = selectedMembers && selectedMembers.length > 0
      ? allMembers.filter(m => selectedMembers.includes(m.name))
      : allMembers

    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')

    const memberLabels = ['Person A', 'Person B', 'Person C', 'Person D', 'Person E', 'Person F']
    const memberMap = {}
    const memberDetails = targetMembers.map((m, i) => {
      const label = memberLabels[i] || `Person ${i + 1}`
      memberMap[label] = m.name
    const weight = m.weight ? `${m.weight}${m.weightUnit || 'kg'}` : 'unknown'
      return `${label}: age=${m.age || 'unknown'}, weight=${weight}, height=${m.height || 'unknown'}, health goals=${m.goals || 'healthy eating'}, dietary restrictions=${m.dietary || 'none'}, allergens=${m.allergens || 'none'}`
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
- Steps must be clear and detailed — minimum 4 steps per meal, maximum 6 steps
- Each step should be one complete instruction sentence
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
    "steps": ["Step 1", "Step 2", "Step 3", "Step 4"],
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

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 24000,
      system: 'You are a meal planning API. Respond with only valid raw JSON. No markdown, no backticks, no explanation. Start with [ and end with ].',
      messages: [{ role: 'user', content: prompt }]
    })
    const message = await stream.finalMessage()
    await trackApiUsage('meal_plan_generate', message.usage?.input_tokens || 0, message.usage?.output_tokens || 0, 'claude-sonnet-4-6')

    if (message.stop_reason === 'max_tokens') {
      console.warn(`[generateWeekPlan] Response truncated at max_tokens. Response length: ${message.content[0].text.length} chars`)
    }

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let generatedMeals
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        generatedMeals = parsed
      } else if (parsed && typeof parsed === 'object') {
        const inner = Object.values(parsed).find(v => Array.isArray(v))
        if (inner) {
          generatedMeals = inner
        } else {
          console.error('[generateWeekPlan] parsed object has no array value:', Object.keys(parsed))
          return res.status(502).json({ error: 'Meal plan generation returned an invalid response, please try again' })
        }
      } else {
        console.error('[generateWeekPlan] unexpected parsed type:', typeof parsed)
        return res.status(502).json({ error: 'Meal plan generation returned an invalid response, please try again' })
      }
    } catch (parseErr) {
      console.error('[generateWeekPlan] JSON.parse failed:', parseErr.message)
      return res.status(502).json({ error: 'Meal plan generation returned an invalid response, please try again' })
    }

    const allSlots = []
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const mealTypes = ['Breakfast', 'Lunch', 'Dinner', 'Snack']
    days.forEach(day => mealTypes.forEach(mealType => allSlots.push({ day, mealType })))

    const missingSlots = allSlots.filter(slot =>
      !generatedMeals.find(m => m.day === slot.day && m.mealType === slot.mealType)
    )

    const fallbackMeals = {
      Breakfast: { recipeName: 'Simple Oat Bowl', icon: '🥣', description: 'A quick nutritious breakfast.', steps: ['Cook oats with water for 3 minutes.', 'Add your favourite toppings.', 'Serve warm.'], time: '5 mins', nutrition: { calories: 300, protein: 10, carbs: 50, fat: 5, fiber: 5 } },
      Lunch: { recipeName: 'Mixed Veggie Salad', icon: '🥗', description: 'A light and refreshing lunch.', steps: ['Chop vegetables of your choice.', 'Mix in a bowl with olive oil.', 'Season with salt and pepper.', 'Serve fresh.'], time: '10 mins', nutrition: { calories: 250, protein: 8, carbs: 30, fat: 8, fiber: 6 } },
      Dinner: { recipeName: 'Simple Rice and Dal', icon: '🍛', description: 'A comforting wholesome dinner.', steps: ['Rinse rice and dal thoroughly.', 'Cook rice in 2 cups water until fluffy.', 'Boil dal with turmeric and salt.', 'Temper with cumin and garlic.', 'Serve hot together.'], time: '30 mins', nutrition: { calories: 450, protein: 18, carbs: 75, fat: 6, fiber: 8 } },
      Snack: { recipeName: 'Fresh Fruit Bowl', icon: '🍎', description: 'A light healthy snack.', steps: ['Wash and cut fresh fruits.', 'Arrange in a bowl.', 'Serve immediately.'], time: '5 mins', nutrition: { calories: 120, protein: 2, carbs: 28, fat: 1, fiber: 4 } },
    }

    missingSlots.forEach(slot => {
      const fallback = fallbackMeals[slot.mealType]
      generatedMeals.push({
        day: slot.day,
        mealType: slot.mealType,
        ...fallback,
        ingredients: [],
        missing: [],
        allergenWarnings: [],
      })
    })

    await prisma.mealPlan.deleteMany({
      where: { familyId, weekStart }
    })

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
              plannedFor: targetMembers.map(m => m.name),
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
    console.error('[generateWeekPlan] name=%s status=%s message=%s', err?.name, err?.status, err?.message)
    console.error('[generateWeekPlan] stack:', err?.stack?.split('\n')[0])
    return handleAnthropicError(err, res, String(err && err.message || err).slice(0, 300))
  }
}

exports.markCooked = async (req, res) => {
  try {
    const { id } = req.params
    const familyId = req.user.familyId
    const existing = await prisma.mealPlan.findFirst({
      where: { id, familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Meal not found' })

    const meal = await prisma.mealPlan.update({
      where: { id },
      data: { cooked: true, cookedAt: new Date() }
    })

    // Auto-log per-serving nutrition for all family members (skip silently if data missing)
    const nutritionPerServing = existing.recipeData?.nutritionPerServing
    if (nutritionPerServing) {
      try {
        const plannedFor = existing.recipeData?.plannedFor
        const allMembers = plannedFor && Array.isArray(plannedFor) && plannedFor.length > 0
          ? (await prisma.member.findMany({ where: { familyId, name: { in: plannedFor } } })).filter(m => !m.isBaby)
          : (await prisma.member.findMany({ where: { familyId } })).filter(m => !m.isBaby)
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const tomorrowStart = new Date(todayStart)
        tomorrowStart.setDate(tomorrowStart.getDate() + 1)

        await Promise.all(allMembers.map(async (member) => {
          const dupCheck = await prisma.nutritionLog.findFirst({
            where: {
              familyId,
              memberName: member.name,
              recipeName: existing.recipeName,
              loggedAt: { gte: todayStart, lt: tomorrowStart },
            },
          })
          if (dupCheck) return

          await prisma.nutritionLog.create({
            data: {
              familyId,
              memberName: member.name,
              memberId: member.id,
              recipeName: existing.recipeName,
              mealType: existing.mealType,
              calories: nutritionPerServing.calories ?? null,
              protein: nutritionPerServing.protein ?? null,
              carbs: nutritionPerServing.carbs ?? null,
              fat: nutritionPerServing.fat ?? null,
              fiber: nutritionPerServing.fiber ?? null,
              sugar: nutritionPerServing.sugar ?? null,
              sodium: nutritionPerServing.sodium ?? null,
            },
          })
        }))
      } catch (logErr) {
        console.error('markCooked auto-log error (non-fatal):', logErr?.message)
      }
    }

    res.json(meal)
  } catch (err) {
    console.error('markCooked error:', err)
    res.status(500).json({ error: 'Failed to mark meal as cooked' })
  }
}