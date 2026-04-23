const Anthropic = require('@anthropic-ai/sdk')
const prisma = require('../utils/prisma')

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const getWeekKey = () => {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${week}`
}

exports.suggestRecipes = async (req, res) => {
  try {
    const { members, mealType, cuisine } = req.body
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
    const memberDetails = memberProfiles.map(m =>
      `${m.name}: goal=${m.goals || 'healthy eating'}, dietary=${m.dietary || 'none'}`
    ).join('; ')

const prompt = `You are a helpful family meal planning assistant.

Family members being cooked for: ${members.join(', ')}
Member health profiles: ${memberDetails || 'No specific health data'}
Meal type: ${mealType}
Cuisine preference: ${cuisine || 'Any cuisine'}
Items currently in pantry: ${pantryList || 'Pantry is empty'}

${cuisine && cuisine !== 'Any cuisine' 
  ? `IMPORTANT: Suggest recipes specifically from ${cuisine} cuisine.` 
  : 'Suggest recipes from any cuisine based on available ingredients.'}

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

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

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
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to generate recipes' })
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
    const memberDetails = allMembers.map(m =>
      `${m.name}: goal=${m.goals || 'healthy eating'}, dietary=${m.dietary || 'none'}, age=${m.age || 'unknown'}`
    ).join('; ')

const prompt = `You are a family meal planning expert.

All family members and their health profiles: ${memberDetails}
Meal type: ${mealType}
Cuisine preference: ${cuisine || 'Any cuisine'}
Items in pantry: ${pantryList || 'Pantry is empty'}

${cuisine && cuisine !== 'Any cuisine'
  ? `IMPORTANT: The recipe must be from ${cuisine} cuisine.`
  : 'Choose the most suitable cuisine based on the family preferences and pantry items.'}

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
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

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
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to generate family recipe' })
  }
}