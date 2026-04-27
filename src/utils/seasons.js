const getCanadianSeason = () => {
  const month = new Date().getMonth() + 1 // 1-12

  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'fall'
  return 'winter'
}

const SEASONAL_PRODUCE = {
  spring: {
    items: ['asparagus', 'rhubarb', 'spinach', 'peas', 'radishes', 'green onions', 'fiddleheads', 'leeks', 'arugula', 'lettuce'],
    tip: 'Spring greens are at peak freshness and lowest price right now.'
  },
  summer: {
    items: ['strawberries', 'blueberries', 'raspberries', 'corn', 'tomatoes', 'zucchini', 'peaches', 'cucumbers', 'bell peppers', 'cherries', 'watermelon', 'green beans'],
    tip: 'Summer produce is abundant — great time to buy in bulk and freeze berries.'
  },
  fall: {
    items: ['squash', 'pumpkin', 'apples', 'pears', 'beets', 'Brussels sprouts', 'cauliflower', 'broccoli', 'sweet potatoes', 'cranberries', 'parsnips'],
    tip: 'Fall harvest means root vegetables and squash are cheap and fresh.'
  },
  winter: {
    items: ['citrus', 'oranges', 'grapefruit', 'cabbage', 'carrots', 'potatoes', 'onions', 'garlic', 'kale', 'turnips', 'lemons', 'stored apples'],
    tip: 'Winter is citrus season — stock up on oranges and lemons for immune support.'
  }
}

const getSeasonalContext = () => {
  const season = getCanadianSeason()
  const { items, tip } = SEASONAL_PRODUCE[season]
  const month = new Date().toLocaleString('en-CA', { month: 'long' })

  return {
    season,
    month,
    items,
    tip,
    context: `Current season in Canada: ${season} (${month}). 
Seasonal produce available and cheapest right now: ${items.join(', ')}.
PREFER using these seasonal ingredients in recipes when possible as they are fresher, cheaper and more nutritious.
${tip}`
  }
}

module.exports = { getCanadianSeason, getSeasonalContext, SEASONAL_PRODUCE }