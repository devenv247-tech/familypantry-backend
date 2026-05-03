const Anthropic = require('@anthropic-ai/sdk')

exports.lookupNutrition = async (req, res) => {
  try {
    const { mealName, servings = 1 } = req.body
    if (!mealName) return res.status(400).json({ error: 'Meal name required' })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are a nutrition database for Canadian food. Look up the nutrition info for: "${mealName}"

If this is a restaurant item (McDonald's, Tim Hortons, Subway, A&W, Harvey's, Wendy's, Popeyes, KFC, Pizza Pizza, Boston Pizza, etc.) use their official Canadian nutrition data.

If it's a home-cooked meal, estimate based on standard recipe.

Respond ONLY with valid JSON, no markdown:
{
  "found": true,
  "mealName": "exact name with restaurant if applicable",
  "servingSize": "1 sandwich / 1 cup / etc",
  "calories": 450,
  "protein": 25,
  "carbs": 40,
  "fat": 18,
  "fiber": 2,
  "sugar": 8,
  "sodium": 890,
  "confidence": "high/medium/low",
  "source": "McDonald's Canada official / estimated"
}`
      }]
    })

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const nutrition = JSON.parse(text)

    // Scale by servings
    if (servings > 1 && nutrition.found) {
      nutrition.calories = Math.round(nutrition.calories * servings)
      nutrition.protein = Math.round(nutrition.protein * servings)
      nutrition.carbs = Math.round(nutrition.carbs * servings)
      nutrition.fat = Math.round(nutrition.fat * servings)
      nutrition.fiber = Math.round(nutrition.fiber * servings)
      nutrition.sugar = Math.round(nutrition.sugar * servings)
      nutrition.sodium = Math.round(nutrition.sodium * servings)
    }

    res.json(nutrition)
  } catch (err) {
    console.error('lookupNutrition error:', err)
    res.status(500).json({ error: 'Failed to look up nutrition' })
  }
}