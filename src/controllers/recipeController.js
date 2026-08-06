const Anthropic = require('@anthropic-ai/sdk')
const { handleAnthropicError, trackApiUsage } = require('../utils/anthropicError')
const prisma = require('../utils/prisma')
const { getMealPatternContext } = require('./mealPatternController')
const { getSeasonalContext } = require('../utils/seasons')
const { buildMemberTargets } = require('./healthTrackerController')
const { buildAnonymizedProfiles, substituteNames } = require('../utils/memberAnonymizer')

const PLAN_RANK = { free: 0, family: 1, premium: 2 }

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})
const { estimateRecipeCost } = require('../utils/recipeCost')
const { filterUsable } = require('../utils/pantryFilters')

const getWeekKey = () => {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${week}`
}


const callClaude = async (anthropic, params, endpoint) => {
  const message = await anthropic.messages.create(params)
  await trackApiUsage(endpoint, message.usage?.input_tokens || 0, message.usage?.output_tokens || 0, params.model)
  return message
}

// ─── Fuzzy pantry name matcher ────────────────────────────────────────────────
const nameMatchesPantry = (missingName, pantryItems) => {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const mNorm = norm(missingName)
  return pantryItems.some(p => {
    const pNorm = norm(p.name)
    return (
      pNorm === mNorm ||
      pNorm.includes(mNorm) ||
      mNorm.includes(pNorm) ||
      // handle common synonyms e.g. "scallion" vs "green onion"
      (mNorm.includes('onion') && pNorm.includes('onion')) ||
      (mNorm.includes('chicken') && pNorm.includes('chicken')) ||
      (mNorm.includes('tomato') && pNorm.includes('tomato')) ||
      (mNorm.includes('oil') && pNorm.includes('oil')) ||
      (mNorm.includes('flour') && pNorm.includes('flour')) ||
      (mNorm.includes('rice') && pNorm.includes('rice')) ||
      (mNorm.includes('milk') && pNorm.includes('milk')) ||
      (mNorm.includes('cheese') && pNorm.includes('cheese')) ||
      (mNorm.includes('pepper') && pNorm.includes('pepper')) ||
      (mNorm.includes('garlic') && pNorm.includes('garlic')) ||
      (mNorm.includes('ginger') && pNorm.includes('ginger')) ||
      (mNorm.includes('butter') && pNorm.includes('butter')) ||
      (mNorm.includes('cream') && pNorm.includes('cream')) ||
      (mNorm.includes('yogurt') && pNorm.includes('yogurt')) ||
      (mNorm.includes('lentil') && pNorm.includes('lentil')) ||
      (mNorm.includes('bean') && pNorm.includes('bean')) ||
      (mNorm.includes('pasta') && pNorm.includes('pasta')) ||
      (mNorm.includes('bread') && pNorm.includes('bread')) ||
      (mNorm.includes('egg') && pNorm.includes('egg'))
    )
  })
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

    // ── 1. Get pantry — exclude expired and zero/negative quantity ────────────
    const rawPantry = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId },
    })
    const pantryItems = filterUsable(rawPantry)

    // ── 2. Get items currently on grocery list (user knows they need more) ────
    const groceryItems = await prisma.groceryItem.findMany({
      where: { familyId: req.user.familyId, checked: false },
      select: { name: true },
    })
    const groceryNames = new Set(groceryItems.map(g => g.name.toLowerCase().trim()))

    // ── 3. Build pantry list — flag low stock, exclude grocery list items ─────
    const pantryList = pantryItems
      .filter(i => !groceryNames.has(i.name.toLowerCase().trim()))
      .map(i => {
        const lowStock = i.maxQuantity && i.quantity / i.maxQuantity < 0.2
        return `${i.name} (${i.quantity} ${i.unit}${lowStock ? ' — LOW STOCK' : ''})`
      })
      .join(', ')

    // ── 4. Get recent recipe history for variety ──────────────────────────────
    const recentMeals = await prisma.cookedMeal.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { cookedAt: 'desc' },
      take: 30,
      select: { recipeName: true, cookedAt: true },
    })
    const recentNames = recentMeals
      .filter(m => new Date() - new Date(m.cookedAt) <= 14 * 24 * 60 * 60 * 1000)
      .map(m => m.recipeName)

    // Also grab saved recipes to avoid repeating those too
    const savedRecipes = await prisma.savedRecipe.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { name: true },
    })
    const savedNames = savedRecipes.map(r => r.name)

    // All names to avoid (recent + saved)
    const avoidNames = [...new Set([...recentNames, ...savedNames])]

    // Get member health info
    const memberProfiles = await prisma.member.findMany({
      where: {
        familyId: req.user.familyId,
        name: { in: members },
      },
    })

    if (memberProfiles.length === 0) {
      return res.status(400).json({ error: 'No matching members found' })
    }

    const { profileText: memberDetails, nameMap } = buildAnonymizedProfiles(memberProfiles)

    // Goal-aware fitness injection (skipped silently on any error)
    let fitnessBlock = ''
    try {
      const goalMember = memberProfiles.find(m => m.fitnessGoal)
      if (goalMember) {
        const fitnessFlag = await prisma.featureFlag.findUnique({ where: { name: 'fitness_coach' } })
        const hasAccess = fitnessFlag && fitnessFlag.enabled &&
          (PLAN_RANK[family?.plan] ?? 0) >= (PLAN_RANK[fitnessFlag.requiredPlan] ?? 0)
        if (hasAccess) {
          const weightLogs = await prisma.weightLog.findMany({
            where: { memberId: goalMember.id },
            orderBy: { loggedAt: 'asc' },
          })
          const targets = buildMemberTargets(goalMember, weightLogs)
          if (targets?.calories && targets?.macros?.protein) {
            const todayStart = new Date()
            todayStart.setHours(0, 0, 0, 0)
            const todayLogs = await prisma.nutritionLog.findMany({
              where: {
                familyId: req.user.familyId,
                memberName: goalMember.name,
                loggedAt: { gte: todayStart },
              },
            })
            const todayCalories = todayLogs.reduce((s, l) => s + (l.calories || 0), 0)
            const todayProtein = todayLogs.reduce((s, l) => s + (l.protein || 0), 0)
            const mealsRemaining = Math.max(1, 3 - todayLogs.length)
            const remainingCalories = Math.max(0, targets.calories - todayCalories)
            const remainingProtein = Math.max(0, targets.macros.protein - todayProtein)
            fitnessBlock = `\nFITNESS GOAL: This meal should provide roughly ${Math.round(remainingCalories / mealsRemaining)} kcal and at least ${Math.round(remainingProtein / mealsRemaining)}g protein for a member on a ${goalMember.fitnessGoal} plan.\n`
          }
        }
      }
    } catch (fitnessErr) {
      console.error('fitnessBlock compute error (non-fatal):', fitnessErr?.message)
    }

const mealPatternContext = await getMealPatternContext(req.user.familyId)
const seasonal = getSeasonalContext()
const expiringContext = expiringItems && expiringItems.length > 0
  ? `\nURGENT - USE EXPIRING ITEMS: The following pantry items are expiring very soon and MUST be used in at least one recipe. Prioritise recipes that use these: ${expiringItems.join(', ')}.\n`
  : ''

const avoidContext = avoidNames.length > 0
  ? `\nSTRICTLY DO NOT suggest any of these recently cooked or saved recipes (user is bored of them): ${avoidNames.join(', ')}.\nIf the user has cooked many meals, be even more creative and explore lesser-known regional dishes.\n`
  : ''

// Inject randomness seed so Claude doesn't cache the same answer
const randomSeed = Math.random().toString(36).substring(2, 8)

const prompt = `You are a helpful family meal planning assistant. Session: ${randomSeed}

Number of people being cooked for: ${members.length}
Member health profiles: ${memberDetails || 'No specific health data'}
Meal type: ${mealType}
Cuisine preference: ${cuisine || 'Any cuisine'}
Items currently in pantry: ${pantryList || 'Pantry is empty'}
${expiringContext}
${avoidContext}
${cuisine && cuisine !== 'Any cuisine'
  ? `DISH/CUISINE DIRECTION: The user wants "${cuisine}". Interpret this creatively:
- If it's a cuisine (e.g. "Punjabi", "South Indian", "Bengali") → suggest authentic regional dishes, NOT the most famous export dish. Think home-cooked meals, regional staples, lesser-known dishes.
- If it's a dish type (e.g. "Burger", "Wrap / Burrito", "Salad", "Rice Bowl") → make that the format, and use pantry ingredients + cuisine context to fill it (e.g. a spiced chicken rice bowl, a paneer wrap, a daal-stuffed burrito).
- Avoid defaulting to the single most globally-known dish for any cuisine.`
  : 'Suggest recipes from any cuisine based on available ingredients. Be diverse — do not default to the most famous dish from any one cuisine.'}
${mealPatternContext}${fitnessBlock}
SEASONAL GUIDANCE:
${seasonal.context}

ALLERGEN RULES - MUST FOLLOW:
1. Member allergens are listed in their profile as "allergens=X,Y,Z"
2. For EACH recipe, scan EVERY ingredient for allergen conflicts
3. If an ingredient contains or may contain an allergen that any member has, add it to allergenWarnings
4. Example: if Member 1 has allergens=Milk and recipe uses "Homo Milk" → allergenWarnings should include: {"member": "Member 1", "allergen": "Milk", "ingredient": "Homo Milk"}
5. CRITICAL: ONLY emit allergenWarnings for allergens EXPLICITLY listed in a member's profile. If a member has allergens=none or no allergens are recorded, emit ZERO warnings for that member. If no member profiles are provided, allergenWarnings must be an empty array. Never consult the trigger lists below unless the member has that specific allergen explicitly recorded — the trigger lists describe what counts as that allergen, not a reason to scan all ingredients independently.
6. Milk allergen triggers on: milk, cream, butter, cheese, paneer, yogurt, whey, casein, lactose
7. Eggs allergen triggers on: eggs, egg white, egg yolk, mayonnaise
8. Wheat/Gluten allergen triggers on: wheat, flour, bread, pasta, oats, barley, rye, tortilla, wrap
9. Peanuts allergen triggers on: peanuts, peanut butter, peanut oil
10. Tree nuts allergen triggers on: almonds, cashews, walnuts, pecans, pistachios
11. Even if a recipe has allergen conflicts, still suggest it but populate allergenWarnings fully
VARIETY RULES - MUST FOLLOW:
1. The 3 recipes MUST use different cooking methods (e.g. one grilled/roasted, one curry/braised, one stir-fried/pan-seared)
2. Do NOT default to the most famous or obvious dish. If Indian cuisine, do NOT suggest Butter Chicken unless no other option exists
3. Prioritize pantry items heavily — if rice, lentils, or grains are in the pantry, at least one recipe should use them as the base
4. Vary the protein across recipes if multiple proteins are available in the pantry
5. Think beyond restaurant classics — include home-style, regional, or lesser-known dishes
MISSING INGREDIENT RULES - MUST FOLLOW:
1. Recipe 1: use ONLY pantry items — zero or at most 1 missing ingredient
2. Recipe 2: maximum 3 missing ingredients
3. Recipe 3: maximum 5 missing ingredients
4. NEVER list more than 5 missing ingredients for any recipe — adapt the recipe instead
5. Sort the 3 recipes by missing ingredient count ascending (fewest first)
6. If a pantry item is marked LOW STOCK, prefer not to use it as the main ingredient

UNIT RULES - MUST FOLLOW:
1. For pantry-sourced ingredients, output the quantity and unit in the EXACT same unit shown in the pantry list above (e.g. pantry shows "Turmeric (50 g)" → output unit "g", not "tsp")
2. EXCEPTION: if a pantry item is tracked in a container unit (pcs, bottle, can, jar, pack, bag, box) and the recipe only uses a small amount (an oil, sauce, or condiment), keep the natural cooking unit (tsp/tbsp/cup/ml/g) — those will not be auto-deducted, which is correct

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
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }, 'suggest_recipes')
    
    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    let recipes = JSON.parse(text)

    // ── Post-process: remove false positives from missing arrays ─────────────
    recipes = recipes.map(recipe => {
      const trulyMissing = (recipe.missing || []).filter(item => {
        const name = typeof item === 'string' ? item : item.name
        return !nameMatchesPantry(name, pantryItems)
      })
      // Hard cap at 5 missing items
      return { ...recipe, missing: trulyMissing.slice(0, 5) }
    })

    // Sort by missing count ascending so recipe 1 always has fewest
    recipes.sort((a, b) => (a.missing?.length || 0) - (b.missing?.length || 0))

    recipes = substituteNames(recipes, nameMap)

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
const { profileText: memberDetails, nameMap } = buildAnonymizedProfiles(allMembers)
const prompt = `You are a family meal planning expert.

Number of family members: ${allMembers.length}
Health profiles: ${memberDetails}
Meal type: ${mealType}
Cuisine preference: ${cuisine || 'Any cuisine'}
Items in pantry: ${pantryList || 'Pantry is empty'}

${cuisine && cuisine !== 'Any cuisine'
  ? `DISH/CUISINE DIRECTION: The user wants "${cuisine}". If it's a cuisine, pick an authentic regional dish — not the most famous export. If it's a dish type (Burger, Wrap, Salad, etc.), use that as the format and adapt ingredients from the pantry and family preferences.`
  : 'Choose the most suitable cuisine. Be creative — avoid defaulting to the single most famous dish from any cuisine.'}
${mealPatternContext}
SEASONAL GUIDANCE:
${seasonal.context}

ALLERGEN RULES - MUST FOLLOW:
1. Member allergens are listed in their profile as "allergens=X,Y,Z"
2. For EACH recipe, scan EVERY ingredient for allergen conflicts
3. If an ingredient contains or may contain an allergen that any member has, add it to allergenWarnings
4. CRITICAL: ONLY emit allergenWarnings for allergens EXPLICITLY listed in a member's profile. If a member has allergens=none or no allergens are recorded, emit ZERO warnings for that member. If no member profiles are provided, allergenWarnings must be an empty array. Never consult the trigger lists below unless the member has that specific allergen explicitly recorded — the trigger lists describe what counts as that allergen, not a reason to scan all ingredients independently.
5. Milk allergen triggers on: milk, cream, butter, cheese, paneer, yogurt, whey, casein, lactose
6. Eggs allergen triggers on: eggs, egg white, egg yolk, mayonnaise
7. Wheat/Gluten allergen triggers on: wheat, flour, bread, pasta, oats, barley, rye, tortilla, wrap
8. Peanuts allergen triggers on: peanuts, peanut butter, peanut oil
9. Tree nuts allergen triggers on: almonds, cashews, walnuts, pecans, pistachios
10. Even if a recipe has allergen conflicts, still suggest it but populate allergenWarnings fully

VARIETY RULE: Do NOT default to famous or overused dishes (e.g. Butter Chicken for Indian cuisine). Choose a recipe that creatively uses pantry staples like grains, legumes, or vegetables already available. Prefer regional home-style dishes over restaurant classics.

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
  "memberTips": [{"member": "Member 1", "tip": "specific tip for this member"}],
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
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'You are a JSON API. Respond ONLY with raw JSON. No markdown, no backticks, no explanation. Start with { and end with }.',
      messages: [{ role: 'user', content: prompt }],
    }, 'family_recipe')

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let recipe
    try {
      recipe = JSON.parse(text)
    } catch (parseErr) {
      console.error('familyRecipe JSON parse error — truncated response:', text.slice(-200))
      return res.status(500).json({ error: 'Failed to parse recipe response. Please try again.' })
    }

    if (family.plan === 'free') {
      await prisma.family.update({
        where: { id: family.id },
        data: {
          recipeCount: { increment: 1 },
          recipeWeek: currentWeek,
        }
      })
    }

    res.json({ recipe: substituteNames(recipe, nameMap) })

  } catch (err) {
    return handleAnthropicError(err, res)
  }
}
exports.suggestDrinks = async (req, res) => {
  try {
    const { condition } = req.body

    if (!condition) {
      return res.status(400).json({ error: 'Please select a condition' })
    }

    const family = await prisma.family.findUnique({
      where: { id: req.user.familyId }
    })

    // Free plan — no drinks
    if (family.plan === 'free') {
      return res.status(403).json({
        error: 'Paid feature',
        message: 'Drinks & remedies are available on the Family plan and above.',
        limitReached: true,
      })
    }

    // Family plan — 5 drinks/week separate from recipe count
    const currentWeek = getWeekKey()
    if (family.plan === 'family') {
      if (family.drinkWeek === currentWeek && family.drinkCount >= 5) {
        return res.status(403).json({
          error: 'Weekly limit reached',
          message: 'You have used all 5 drink suggestions this week. Upgrade to Premium for unlimited.',
          limitReached: true,
        })
      }
      if (family.drinkWeek !== currentWeek) {
        await prisma.family.update({
          where: { id: family.id },
          data: { drinkCount: 0, drinkWeek: currentWeek }
        })
      }
    }

    // Premium plan — unlimited, no checks needed

    const pantryItems = await prisma.pantryItem.findMany({
      where: { familyId: req.user.familyId },
    })

    const pantryList = pantryItems.map(i => i.name).join(', ')
    const seasonal = getSeasonalContext()

    const prompt = `You are a knowledgeable home wellness and drinks expert with deep knowledge of traditional beverages, home remedies, and seasonal drinks from cultures around the world.

Current season in Canada: ${seasonal.season} (${seasonal.month})
User's condition/mood: ${condition}
Items currently in pantry: ${pantryList || 'Pantry is empty'}

YOUR GOAL: Suggest 3 drinks that genuinely help with "${condition}".

CRITICAL VARIETY RULES - MUST FOLLOW:
1. Each drink MUST come from a DIFFERENT cultural tradition (e.g. South Asian, Middle Eastern, Latin American, East Asian, West African, Caribbean, European, Indigenous/Canadian, etc.)
2. Do NOT default to the most globally famous drink for any culture. Think regional, home-style, lesser-known traditions
3. At least ONE drink must be fully makeable from pantry items already available
4. At least ONE drink may require 1-2 simple affordable ingredients to buy — this is fine and adds value
5. Match the season: prefer warm/hot drinks in winter and fall, cooling drinks in summer and spring
6. Let the pantry DRIVE the cultural direction — if ginger and tulsi are present lean South Asian; if tamarind is there use it; if mint and lemon are there go Mediterranean or Middle Eastern; if nothing obvious, pick freely and creatively across cultures
7. NEVER suggest generic drinks like "lemon water" or "green tea" without a specific cultural twist or preparation method

WELLNESS RULE: Every drink must have a genuine specific reason why it helps with "${condition}". Be precise — name the active compound or mechanism (e.g. "ginger contains gingerols which reduce gut inflammation" not just "good for digestion").

Respond ONLY with a valid JSON array, no other text:
[
  {
    "name": "Full drink name (Local name in brackets if it exists, e.g. Fennel Seed Water (Saunf Pani))",
    "culture": "Specific cultural origin e.g. South Indian, Persian, Mexican, West African, Caribbean",
    "why": "1-2 sentences explaining specifically why this helps with ${condition} — name the mechanism",
    "temp": "hot or cold or either",
    "prepTime": "e.g. 5 mins",
    "icon": "single relevant emoji",
    "fullyFromPantry": true or false,
    "ingredients": [
      { "name": "ingredient name", "quantity": "amount", "unit": "unit", "inPantry": true or false }
    ],
    "steps": ["Step 1", "Step 2", "Step 3"],
    "tip": "one short serving or customization tip"
  }
]`

    const message = await callClaude(anthropic, {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }, 'suggest_drinks')

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const drinks = JSON.parse(text)

    // Increment count for family plan
    if (family.plan === 'family') {
      await prisma.family.update({
        where: { id: family.id },
        data: {
          drinkCount: { increment: 1 },
          drinkWeek: currentWeek,
        }
      })
    }

    res.json({
      drinks,
      usage: family.plan === 'family' ? {
        used: (family.drinkWeek === currentWeek ? family.drinkCount : 0) + 1,
        limit: 5,
        plan: 'family'
      } : { plan: family.plan }
    })

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
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: 'You are a JSON API. Respond ONLY with raw JSON. No markdown, no backticks, no explanation. Start with { and end with }.',
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

exports.describeRecipe = async (req, res) => {
  try {
    const { prompt: userPrompt, modifier } = req.body

    // 1. Validate
    const promptTrimmed = typeof userPrompt === 'string' ? userPrompt.trim() : ''
    if (promptTrimmed.length === 0) {
      return res.status(400).json({ error: 'Missing prompt', message: 'Please enter a food or cooking question.' })
    }
    if (promptTrimmed.length > 300) {
      return res.status(400).json({ error: 'Request too long', message: 'Keep it under 300 characters.' })
    }

    // 2. Feature flag + family (parallel)
    const [family, askNookaFlag] = await Promise.all([
      prisma.family.findUnique({ where: { id: req.user.familyId } }),
      prisma.featureFlag.findUnique({ where: { name: 'ask_nooka' } }),
    ])

    const flagAllowed = askNookaFlag && askNookaFlag.enabled &&
      (PLAN_RANK[family?.plan] ?? 0) >= (PLAN_RANK[askNookaFlag.requiredPlan] ?? 0)
    if (!flagAllowed) {
      return res.status(403).json({ error: 'unavailable', message: 'Ask Nooka is not available right now.' })
    }

    // 3. Free-plan weekly limit
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
          data: { recipeCount: 0, recipeWeek: currentWeek },
        })
      }
    }

    // 4. Food safety intercept — no AI call, no counter increment
    const FOOD_SAFETY_RE = /\b(still good|still safe|gone bad|go bad|expired|spoiled|off|smells? (bad|funny|weird)|food poisoning|safe to eat|been (in|out|sitting))\b/i
    if (FOOD_SAFETY_RE.test(promptTrimmed)) {
      return res.status(200).json({
        type: 'safety',
        title: 'Food safety',
        message: "When in doubt, throw it out. Nooka can't assess whether a specific food is safe to eat — that depends on temperature, handling and time in ways we can't see. For Canadian food safety guidance, check the Canadian Food Inspection Agency at inspection.canada.ca.",
      })
    }

    // 5. Domain guard — cheap haiku pre-check, max_tokens 5
    const guardMsg = await callClaude(anthropic, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      system: 'You are a topic classifier. Answer with a single word: YES or NO.',
      messages: [{
        role: 'user',
        content: `Is this a request about food, cooking, recipes, ingredients, kitchen technique, or kitchen equipment? Reply YES or NO.\n\n"${promptTrimmed}"`,
      }],
    }, 'ask_nooka_guard')

    const guardAnswer = guardMsg.content[0].text.trim().toUpperCase()
    if (!guardAnswer.startsWith('YES')) {
      return res.status(400).json({ error: 'off_topic', message: 'Ask Nooka only handles food and cooking questions.' })
    }

    // 6. Fetch context for main generation
    const [rawPantry, allMembers, mealPatternContext] = await Promise.all([
      prisma.pantryItem.findMany({ where: { familyId: req.user.familyId } }),
      prisma.member.findMany({ where: { familyId: req.user.familyId } }),
      getMealPatternContext(req.user.familyId),
    ])
    const pantryItems = filterUsable(rawPantry)

    const pantryList = pantryItems.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')
    const seasonal = getSeasonalContext()
    const { profileText: memberDetails, nameMap } = buildAnonymizedProfiles(allMembers)

    const finalRequest = modifier?.trim()
      ? `${promptTrimmed}\nAdjustment: ${modifier.trim()}`
      : promptTrimmed

    const mainPrompt = `You are a recipe assistant for a Canadian family cooking app.

User's request: ${finalRequest}

Family members: ${memberDetails || 'No specific member data'}
Items currently in pantry: ${pantryList || 'Pantry is empty'}
${mealPatternContext}
SEASONAL GUIDANCE:
${seasonal.context}

ALLERGEN RULES - MUST FOLLOW:
1. Member allergens are in their profile as "allergens=X,Y,Z"
2. Scan every ingredient for allergen conflicts
3. If an ingredient may trigger a member's allergen, add it to allergenWarnings
4. CRITICAL: ONLY emit allergenWarnings for allergens EXPLICITLY listed in a member's profile. If a member has allergens=none or no allergens are recorded, emit ZERO warnings for that member. If no member profiles are provided, allergenWarnings must be an empty array. Never consult the trigger lists below unless the member has that specific allergen explicitly recorded — the trigger lists describe what counts as that allergen, not a reason to scan all ingredients independently.
5. Milk: milk, cream, butter, cheese, paneer, yogurt, whey, casein, lactose
6. Eggs: eggs, egg white, egg yolk, mayonnaise
7. Wheat/Gluten: wheat, flour, bread, pasta, oats, barley, rye, tortilla, wrap
8. Peanuts: peanuts, peanut butter, peanut oil
9. Tree nuts: almonds, cashews, walnuts, pecans, pistachios
10. Include allergen-conflicting recipes but populate allergenWarnings fully

INGREDIENT RULES - MUST FOLLOW:
1. Composite packed ingredients must be ONE entry. Never split them (e.g. "Chipotle peppers in adobo" is one ingredient — never add a second entry for "Adobo sauce from the can").
2. Ingredient name must be a clean noun phrase. No parenthetical prep notes — no "(from pantry)", "(sliced into rounds)", "(to thin if needed)", "(ground or lightly toasted)". Prep belongs in steps.
3. Use generic ingredient names even when the pantry lists a specific brand. Write "Mayonnaise" not "Hellmann's Real Mayonnaise", "Olive oil" not "Bertolli Olive Oil".
4. Steps must never reference family members by placeholder. Never write "set aside for Member 1 (age 1)". Describe dietary modifications generically: "set aside a mild unseasoned portion for young children".

YIELD AND NUTRITION BASIS - MUST FOLLOW:
- "yield" describes the natural output: "serves 4", "about 2 cups", "12 cookies", "1 loaf"
- "nutritionBasis" must agree with yield: "per serving", "per tbsp", "per cookie"
- A sauce or condiment must NOT claim "serves 4" — use a volume or piece unit instead
- Scale ingredient quantities to match what the user asked for (e.g. "for 15 people" → yield "serves 15")

Respond ONLY with valid raw JSON. No markdown, no backticks. Start with { end with }:
{
  "type": "recipe",
  "name": "Recipe name",
  "description": "One or two sentences",
  "icon": "🍽️",
  "time": "25 min",
  "difficulty": "Easy",
  "yield": "serves 4",
  "nutritionBasis": "per serving",
  "tags": ["High Protein", "Quick"],
  "ingredients": [{"name": "Chicken breast", "quantity": 500, "unit": "g"}],
  "steps": ["Step 1", "Step 2", "Step 3", "Step 4"],
  "nutrition": {"calories": 450, "protein": 35, "carbs": 30, "fat": 12, "fiber": 4},
  "allergenWarnings": [{"member": "Member 1", "allergen": "Milk", "ingredient": "Butter"}]
}`

    const message = await callClaude(anthropic, {
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'You are a JSON API. Respond ONLY with raw JSON. No markdown, no backticks, no explanation. Start with { and end with }.',
      messages: [{ role: 'user', content: mainPrompt }],
    }, 'ask_nooka')

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let recipe
    try {
      recipe = JSON.parse(text)
    } catch (parseErr) {
      console.error('describeRecipe JSON parse error:', text.slice(-200))
      return res.status(500).json({ error: 'Failed to parse recipe response. Please try again.' })
    }

    // Shopping list — ingredients not in pantry, excluding staples nobody shops for
    const SHOPPING_EXCLUDE = /^(water|ice|salt)$/i
    const shoppingList = (recipe.ingredients || [])
      .filter(ing => !nameMatchesPantry(ing.name, pantryItems))
      .filter(ing => !SHOPPING_EXCLUDE.test(ing.name.trim()))
      .slice(0, 8)
      .map(ing => ing.name)

    if (family.plan === 'free') {
      await prisma.family.update({
        where: { id: family.id },
        data: {
          recipeCount: { increment: 1 },
          recipeWeek: currentWeek,
        },
      })
    }

    const safeRecipe = substituteNames(recipe, nameMap)
    res.json({
      ...safeRecipe,
      shoppingList,
      usage: family.plan === 'free' ? {
        used: (family.recipeWeek === currentWeek ? family.recipeCount : 0) + 1,
        limit: 5,
        plan: 'free',
      } : { plan: family.plan },
    })

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