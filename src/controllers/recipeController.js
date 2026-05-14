const Anthropic = require('@anthropic-ai/sdk')
const { handleAnthropicError, trackApiUsage } = require('../utils/anthropicError')
const prisma = require('../utils/prisma')
const { getMealPatternContext } = require('./mealPatternController')
const { getSeasonalContext } = require('../utils/seasons')

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})
const { estimateRecipeCost } = require('../utils/recipeCost')

const getWeekKey = () => {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${week}`
}


const callClaude = async (anthropic, params, endpoint) => {
  const message = await anthropic.messages.create(params)
  await trackApiUsage(endpoint, message.usage?.input_tokens || 0, message.usage?.output_tokens || 0)
  return message
}

exports.suggestRecipes = async (req, res) => {
  try {
    const { members, mealType, cuisine, expiringItems } = req.body
    if (!members || members.length === 0) {
      return res.status(400).json({ error: 'Please select at least one member' })
    }

    // Get family and check plan
    const family = await prisma.family.findUnique({
      where: { id: req.user.familyId }
    })

    // Check free plan limit
    const currentWeek = getWeekKey()
    if (family.plan === 'free') {
      if (family.recipeWeek === currentWeek && family.recipeCount >= 5) {
        return res.status(403).json({
          error: 'Weekly limit reached',
          message: 'You have used all 5 free recipe suggestions this week. Upgrade to Family plan for unlimited recipes.',
          limitReached: true,
        })
      }
      // Reset count if new week
      if (family.recipeWeek !== currentWeek) {
        await prisma.family.update({
          where: { id: family.id },
          data: { recipeCount: 0, recipeWeek: currentWeek }
        })
      }
    }

    // Get pantry items
    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId },
    })

    // Get member health info
    const memberProfiles = await prisma.member.findMany({
      where: {
        familyId: req.user.familyId,
        name: { in: members },
      },
    })

    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')
    const memberDetails = members.map(m => {
      const goals = m.goals || 'healthy eating'
      const dietary = m.dietary || 'none'
      const allergens = m.allergens || 'none'
      const weight = m.weight ? `${m.weight}${m.weightUnit || 'kg'}` : 'unknown'
      const height = m.height || 'unknown'
      return `${m.name}: age=${m.age || 'unknown'}, weight=${weight}, height=${height}, health goals=${goals}, dietary restrictions=${dietary}, allergens=${allergens}`
    }).join('; ')
const mealPatternContext = await getMealPatternContext(req.user.familyId)
const seasonal = getSeasonalContext()
const expiringContext = expiringItems && expiringItems.length > 0
  ? `\nURGENT - USE EXPIRING ITEMS: The following pantry items are expiring very soon and MUST be used in at least one recipe. Prioritise recipes that use these: ${expiringItems.join(', ')}.\n`
  : ''

const prompt = `You are a helpful family meal planning assistant.

Number of people being cooked for: ${members.length}
Member health profiles: ${memberDetails || 'No specific health data'}
Meal type: ${mealType}
Cuisine preference: ${cuisine || 'Any cuisine'}
Items currently in pantry: ${pantryList || 'Pantry is empty'}
${expiringContext}
${cuisine && cuisine !== 'Any cuisine' 
  ? `IMPORTANT: Suggest recipes specifically from ${cuisine} cuisine.` 
  : 'Suggest recipes from any cuisine based on available ingredients.'}
${mealPatternContext}
SEASONAL GUIDANCE:
${seasonal.context}

ALLERGEN RULES - MUST FOLLOW:
1. Member allergens are listed in their profile as "allergens=X,Y,Z"
2. For EACH recipe, scan EVERY ingredient for allergen conflicts
3. If an ingredient contains or may contain an allergen that any member has, add it to allergenWarnings
4. Example: if Member 1 has allergens=Milk and recipe uses "Homo Milk" → allergenWarnings should include: {"member": "Member 1", "allergen": "Milk", "ingredient": "Homo Milk"}
5. Milk allergen triggers on: milk, cream, butter, cheese, paneer, yogurt, whey, casein, lactose
6. Eggs allergen triggers on: eggs, egg white, egg yolk, mayonnaise
7. Wheat/Gluten allergen triggers on: wheat, flour, bread, pasta, oats, barley, rye, tortilla, wrap
8. Peanuts allergen triggers on: peanuts, peanut butter, peanut oil
9. Tree nuts allergen triggers on: almonds, cashews, walnuts, pecans, pistachios
10. Even if a recipe has allergen conflicts, still suggest it but populate allergenWarnings fully
Please suggest exactly 3 recipes. For each recipe provide:
- Name
- Description (1-2 sentences)
- Difficulty (Easy or Medium)
- Cooking time
- Serves (number)
- Tags (array of 2-3 health/diet tags)
- Ingredients from pantry with exact quantities needed (array of objects with name, quantity, unit)
- Missing ingredients with quantities needed to buy (array of objects with name, quantity, unit)
- Steps (array of clear cooking steps, minimum 4 steps)

Respond ONLY with a valid JSON array, no other text:
[
  {
    "name": "Recipe name",
    "description": "Brief description",
    "difficulty": "Easy",
    "time": "30 mins",
    "serves": 4,
    "icon": "🍽️",
    "tags": ["tag1", "tag2"],
    "ingredients": [{"name": "Chicken", "quantity": 500, "unit": "g"}],
    "missing": [{"name": "Onion", "quantity": 2, "unit": "pcs"}],
    "steps": ["Step 1", "Step 2", "Step 3", "Step 4"],
    "allergenWarnings": [{"member": "Member 1", "allergen": "peanuts", "ingredient": "peanut oil"}],
    "nutrition": {
      "calories": 450,
      "protein": 35,
      "carbs": 42,
      "fat": 12,
      "fiber": 4,
      "sugar": 6,
      "sodium": 820
    },
    "nutritionPerServing": {
      "calories": 113,
      "protein": 9,
      "carbs": 11,
      "fat": 3,
      "fiber": 1,
      "sugar": 2,
      "sodium": 205
    }
  }
]`

    const message = await callClaude(anthropic, {
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }, 'suggest_recipes')
    
    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const recipes = JSON.parse(text)

    // Increment recipe count for free plan
    if (family.plan === 'free') {
      await prisma.family.update({
        where: { id: family.id },
        data: {
          recipeCount: { increment: 1 },
          recipeWeek: currentWeek,
        }
      })
    }

    res.json({
      recipes,
      usage: family.plan === 'free' ? {
        used: (family.recipeWeek === currentWeek ? family.recipeCount : 0) + 1,
        limit: 5,
        plan: 'free'
      } : { plan: family.plan }
    })

  } catch (err) {
    return handleAnthropicError(err, res)
  }
}
exports.familyRecipe = async (req, res) => {
  try {
    const { mealType, cuisine } = req.body

    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId },
    })

    const allMembers = await prisma.member.findMany({
      where: { familyId: req.user.familyId },
    })

    const family = await prisma.family.findUnique({
      where: { id: req.user.familyId }
    })

    // Check free plan limit
    const currentWeek = getWeekKey()
    if (family.plan === 'free') {
      if (family.recipeWeek === currentWeek && family.recipeCount >= 5) {
        return res.status(403).json({
          error: 'Weekly limit reached',
          message: 'Upgrade to Family plan for unlimited recipes.',
          limitReached: true,
        })
      }
      if (family.recipeWeek !== currentWeek) {
        await prisma.family.update({
          where: { id: family.id },
          data: { recipeCount: 0, recipeWeek: currentWeek }
        })
      }
    }

    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')
    
const mealPatternContext = await getMealPatternContext(req.user.familyId)
const seasonal = getSeasonalContext()
const memberDetails = allMembers.map((m, i) =>
  `Member ${i + 1}: age=${m.age || 'unknown'}, goal=${m.goals || 'healthy eating'}, dietary=${m.dietary || 'none'}, allergens=${m.allergens || 'none'}, weight=${m.weight || 'unknown'}`
).join('; ')
const prompt = `You are a family meal planning expert.

Number of family members: ${allMembers.length}
Health profiles: ${memberDetails}
Meal type: ${mealType}
Cuisine preference: ${cuisine || 'Any cuisine'}
Items in pantry: ${pantryList || 'Pantry is empty'}

${cuisine && cuisine !== 'Any cuisine'
  ? `IMPORTANT: The recipe must be from ${cuisine} cuisine.`
  : 'Choose the most suitable cuisine based on the family preferences and pantry items.'}
${mealPatternContext}
SEASONAL GUIDANCE:
${seasonal.context}

ALLERGEN RULES - MUST FOLLOW:
1. Member allergens are listed in their profile as "allergens=X,Y,Z"
2. For EACH recipe, scan EVERY ingredient for allergen conflicts
3. If an ingredient contains or may contain an allergen that any member has, add it to allergenWarnings
4. Milk allergen triggers on: milk, cream, butter, cheese, paneer, yogurt, whey, casein, lactose
5. Eggs allergen triggers on: eggs, egg white, egg yolk, mayonnaise
6. Wheat/Gluten allergen triggers on: wheat, flour, bread, pasta, oats, barley, rye, tortilla, wrap
7. Peanuts allergen triggers on: peanuts, peanut butter, peanut oil
8. Tree nuts allergen triggers on: almonds, cashews, walnuts, pecans, pistachios
9. Even if a recipe has allergen conflicts, still suggest it but populate allergenWarnings fully

Create ONE perfect recipe that balances the nutritional needs and dietary restrictions of ALL family members.
Consider everyone's health goals and dietary preferences.
If there are conflicts (e.g. one vegetarian, one needs high protein) find a creative solution that works for everyone.
Include modification tips for specific members if needed.

Respond ONLY with a valid JSON object, no other text:
{
  "name": "Recipe name",
  "description": "Brief description mentioning how it works for the whole family",
  "difficulty": "Easy",
  "time": "30 mins",
  "serves": ${allMembers.length},
  "icon": "🍽️",
  "tags": ["tag1", "tag2"],
  "balanceNote": "Brief note on how this recipe balances everyone's needs",
  "memberTips": [{"member": "name", "tip": "specific tip for this member"}],
  "ingredients": [{"name": "Chicken", "quantity": 500, "unit": "g"}],
  "missing": [{"name": "Onion", "quantity": 2, "unit": "pcs"}],
 "steps": ["Step 1", "Step 2", "Step 3", "Step 4"],
  "allergenWarnings": [{"member": "Member 1", "allergen": "Milk", "ingredient": "Homo Milk"}],
  "nutrition": {
  "calories": 450,
  "protein": 35,
  "carbs": 42,
  "fat": 12,
  "fiber": 4,
  "sugar": 6,
  "sodium": 820
},
"nutritionPerServing": {
  "calories": 113,
  "protein": 9,
  "carbs": 11,
  "fat": 3,
  "fiber": 1,
  "sugar": 2,
  "sodium": 205
}
}`
    const message = await callClaude(anthropic, {
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }, 'suggest_recipes')

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const recipe = JSON.parse(text)

    if (family.plan === 'free') {
      await prisma.family.update({
        where: { id: family.id },
        data: {
          recipeCount: { increment: 1 },
          recipeWeek: currentWeek,
        }
      })
    }

    res.json({ recipe })

  } catch (err) {
    return handleAnthropicError(err, res)
  }
}
exports.getSubstitutions = async (req, res) => {
  try {
    const { ingredientName, ingredientUnit, recipeContext } = req.body
    const familyId = req.user.familyId

    const family = await prisma.family.findUnique({ where: { id: familyId } })
    if (family.plan === 'free') {
      return res.status(403).json({
        error: 'Family plan feature',
        message: 'Smart substitutions are available on the Family plan ($7/mo).',
        limitReached: true
      })
    }

    // Get current pantry
    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId }
    })

    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')

    const prompt = `You are a smart cooking assistant helping find ingredient substitutions.

Missing ingredient: ${ingredientName} (${ingredientUnit || 'some amount'})
Recipe context: ${recipeContext || 'general cooking'}
Items currently in pantry: ${pantryList || 'Pantry is empty'}

Find the best substitutions for the missing ingredient.
PRIORITY: Suggest pantry items first if they can work as substitutes.
Then suggest easy-to-buy alternatives.

Respond ONLY with valid JSON, no markdown:
{
  "substitutions": [
    {
      "name": "substitute ingredient name",
      "ratio": "how much to use e.g. 1:1 or 3/4 cup per 1 cup",
      "note": "one short tip about using this substitute",
      "inPantry": true or false,
      "quality": "perfect" or "good" or "works"
    }
  ],
  "tip": "one overall cooking tip about substituting ${ingredientName}"
}`

    const response = await callClaude(anthropic, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    }, 'suggest_recipes')

    let text = response.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const result = JSON.parse(text)

    // Mark which ones are actually in pantry
    result.substitutions = result.substitutions.map(sub => ({
      ...sub,
      inPantry: pantryItems.some(p =>
        p.name.toLowerCase().includes(sub.name.toLowerCase()) ||
        sub.name.toLowerCase().includes(p.name.toLowerCase())
      )
    }))

    res.json(result)
  } catch (err) {
    return handleAnthropicError(err, res)
  }
}

exports.estimateCosts = async (req, res) => {
  try {
    const { recipes } = req.body
    const familyId = req.user.familyId

    if (!recipes || !Array.isArray(recipes)) {
      return res.status(400).json({ error: 'recipes array required' })
    }

    const family = await prisma.family.findUnique({ where: { id: familyId } })
    if (family.plan === 'free') {
      return res.status(403).json({ error: 'Budget mode is available on Family plan and above.' })
    }

    // Get price history from both PriceHistory and GroceryItem
    const [priceHistory, groceryHistory] = await Promise.all([
      prisma.priceHistory.findMany({ where: { familyId } }),
      prisma.groceryItem.findMany({
        where: { familyId, price: { not: null }, purchased: true }
      })
    ])

    // Merge into unified price lookup
    const combinedHistory = [
      ...priceHistory.map(h => ({ itemName: h.itemName, price: h.price })),
      ...groceryHistory
        .filter(g => g.price)
        .map(g => ({
          itemName: g.name,
          price: parseFloat(g.price.replace('$', '').replace(',', '') || 0)
        }))
        .filter(g => g.price > 0)
    ]

    const costs = recipes.map(recipe => ({
      name: recipe.name,
      cost: estimateRecipeCost(recipe, combinedHistory)
    }))

    res.json({ costs })
  } catch (err) {
    console.error('estimateCosts error:', err)
    res.status(500).json({ error: 'Failed to estimate costs' })
  }
}