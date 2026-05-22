const Anthropic = require('@anthropic-ai/sdk')
const prisma = require('../utils/prisma')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Local lookup table (days until expiry) ───────────────────────────────────
// REPLACE WITH:
const EXPIRY_TABLE = {
  // ── Dairy ──────────────────────────────────────────────────────────────────
  // Opened fridge life. Source: Health Canada / USDA FoodKeeper
  'milk': 7, 'homo milk': 7, '2% milk': 7, 'skim milk': 7, 'whole milk': 7,
  'buttermilk': 14,
  'butter': 30, 'unsalted butter': 30, 'salted butter': 60,  // salt preserves
  'cream': 7, 'heavy cream': 7, 'whipping cream': 7, 'half and half': 10,
  'sour cream': 21,          // was 14 — sealed sour cream lasts 3 weeks fridge
  'cream cheese': 14,
  'cottage cheese': 10,      // was 7 — Health Canada says 10–14 days
  'ricotta': 7,
  'yogurt': 21,              // was 14 — unopened yogurt is 2–3 weeks past sell-by
  'greek yogurt': 21,
  'cheese': 21, 'cheddar': 30,   // hard cheeses last longer than soft
  'mozzarella': 7,           // was 14 — fresh mozzarella is 7 days
  'parmesan': 60,            // was 30 — hard parmesan is 1–2 months open
  'brie': 14,                // was 7 — whole brie lasts 2 weeks
  'camembert': 14,
  'feta': 28,                // was 14 — feta in brine lasts 4 weeks
  'gouda': 28, 'swiss cheese': 28, 'provolone': 21,
  'string cheese': 28,
  'condensed milk': 14,      // once opened
  'evaporated milk': 5,      // once opened

  // ── Eggs ───────────────────────────────────────────────────────────────────
  // Health Canada: 3–5 weeks from purchase date in fridge
  'eggs': 35, 'egg': 35,
  'hard boiled eggs': 7, 'hard boiled egg': 7,

  // ── Meat & Poultry (raw, fridge) ───────────────────────────────────────────
  // Source: Health Canada safe food storage chart
  'chicken': 3, 'chicken breast': 3, 'chicken thighs': 3,
  'chicken wings': 3, 'whole chicken': 3, 'chicken drumsticks': 3,
  'ground beef': 2, 'ground pork': 2, 'ground turkey': 2, 'ground lamb': 2,
  'beef': 4, 'steak': 4, 'roast beef': 4,
  'pork': 3, 'pork chops': 3, 'pork loin': 4, 'pork tenderloin': 4,
  'bacon': 7,                // unopened; opened is 7 days
  'ham': 7,                  // was 5 — cooked whole ham is 7 days
  'prosciutto': 3,
  'sausage': 2,              // was 3 — raw sausage is 1–2 days
  'hot dogs': 7,             // opened package
  'turkey': 3, 'whole turkey': 3,
  'lamb': 3, 'veal': 3,
  'duck': 3, 'rabbit': 3,
  'liver': 2, 'organ meat': 2,

  // ── Fish & Seafood (raw, fridge) ────────────────────────────────────────────
  // Source: Health Canada — all fresh fish is 1–2 days
  'salmon': 2, 'tuna': 2, 'shrimp': 2, 'fish': 2, 'cod': 2,
  'tilapia': 2, 'halibut': 2, 'crab': 2, 'lobster': 2, 'scallops': 2,
  'oysters': 2, 'mussels': 2, 'clams': 2,
  'sardines': 2, 'anchovy': 2, 'trout': 2, 'bass': 2, 'snapper': 2,
  'smoked salmon': 14,       // vacuum-packed smoked salmon is 2 weeks
  'canned tuna': 730,        // pantry; once opened: 3 days fridge
  'canned salmon': 730,
  'canned sardines': 730,

  // ── Produce — Vegetables (fridge unless noted) ──────────────────────────────
  // Source: Health Canada / Ontario Ministry of Agriculture
  'spinach': 7,              // was 5 — bagged spinach is up to 7 days
  'lettuce': 7,              // was 5
  'romaine': 10, 'iceberg lettuce': 14,
  'kale': 7,                 // was 5 — kale is hardier than spinach
  'arugula': 5,
  'swiss chard': 5, 'bok choy': 5, 'collard greens': 7,
  'broccoli': 7,             // was 5
  'cauliflower': 10,         // was 7
  'cabbage': 21,             // was 14 — whole cabbage lasts 3 weeks
  'brussels sprouts': 7,     // was 5
  'carrots': 28,             // was 21 — whole carrots last 4 weeks in fridge
  'baby carrots': 21,
  'celery': 14,
  'cucumber': 7,
  'zucchini': 7, 'summer squash': 5,
  'bell pepper': 10, 'red pepper': 10, 'green pepper': 10, 'yellow pepper': 10,
  'tomato': 7,               // was 5 — counter-ripened tomato lasts a week
  'tomatoes': 7, 'cherry tomatoes': 7, 'grape tomatoes': 7,
  'onion': 60,               // was 30 — whole onions in cool dark place last 2 months
  'onions': 60, 'red onion': 30, 'green onion': 7, 'scallion': 7,
  'shallot': 30, 'shallots': 30,
  'garlic': 90,              // was 30 — whole garlic bulb is 3 months
  'garlic cloves': 10,       // peeled cloves in fridge
  'ginger': 21,
  'potato': 60,              // was 30 — cool dark pantry, 2 months
  'potatoes': 60,
  'sweet potato': 30,        // was 21
  'sweet potatoes': 30,
  'yam': 30,
  'corn': 3,                 // ears of corn, on the cob
  'peas': 5,
  'green beans': 7,          // was 5
  'asparagus': 4,
  'mushrooms': 7,            // was 5 — whole mushrooms last a week
  'mushroom': 7,
  'eggplant': 7,
  'squash': 90,              // was 30 — whole winter squash (butternut etc) is 3 months pantry
  'butternut squash': 90, 'acorn squash': 90,
  'beets': 21,               // was 14 — beets last 3 weeks fridge
  'radish': 14,              // was 7
  'leek': 14,                // was 7
  'artichoke': 7,
  'fennel': 7,
  'turnip': 14, 'parsnip': 14,
  'okra': 3,
  'snap peas': 5, 'snow peas': 5,
  'bean sprouts': 4,
  'corn on the cob': 3,

  // ── Produce — Fruits ────────────────────────────────────────────────────────
  'banana': 5, 'bananas': 5,
  'apple': 30,               // was 21 — apples in fridge last up to a month
  'apples': 30,
  'orange': 21,              // was 14 — oranges last 3 weeks in fridge
  'oranges': 21,
  'lemon': 21,               // was 14
  'lemons': 21,
  'lime': 14, 'limes': 14,
  'grapes': 14,              // was 7 — grapes in fridge last 2 weeks
  'strawberries': 5,         // was 4 — can last up to a week if dry
  'blueberries': 10,         // was 7
  'raspberries': 3,
  'blackberries': 5,         // was 4
  'mango': 7,                // was 5 — ripe mango in fridge is 5–7 days
  'pineapple': 5,            // cut; whole is 2–3 days counter
  'watermelon': 14,          // was 7 — whole watermelon in fridge is 2 weeks
  'cantaloupe': 7,           // was 5
  'honeydew': 7,
  'peach': 5, 'nectarine': 5,
  'pear': 5,                 // was 7 — ripe pear is 3–5 days
  'plum': 5,
  'cherry': 7,               // was 5 — cherries in fridge last a week
  'cherries': 7,
  'kiwi': 14,                // was 7 — ripe kiwi in fridge is 2 weeks
  'avocado': 5,              // was 4 — ripe avocado is 3–5 days fridge
  'avocados': 5,
  'grapefruit': 21,          // was 14
  'pomegranate': 14,
  'fig': 3, 'figs': 3,
  'date': 365, 'dates': 365, // dried dates
  'coconut': 7,              // fresh opened coconut
  'passion fruit': 7,
  'papaya': 5,
  'dragon fruit': 5,
  'lychee': 5,
  'clementine': 14, 'mandarin': 14, 'tangerine': 14,

  // ── Bread & Bakery ──────────────────────────────────────────────────────────
  // Counter storage; fridge dries bread out faster
  'bread': 7, 'white bread': 7, 'whole wheat bread': 7,
  'sourdough': 5,
  'bagel': 5, 'bagels': 5,
  'muffin': 4, 'muffins': 4,  // was 5 — homemade muffins are 3–4 days
  'croissant': 3,
  'tortilla': 10,             // was 7 — flour tortillas last up to 10 days
  'tortillas': 10,
  'corn tortilla': 7, 'corn tortillas': 7,
  'pita': 7,                  // was 5
  'bun': 7, 'buns': 7,        // was 5
  'roll': 5, 'rolls': 5,
  'naan': 4,
  'flatbread': 5,
  'english muffin': 7, 'english muffins': 7,
  'pita bread': 7,
  'roti': 3,

  // ── Beverages ───────────────────────────────────────────────────────────────
  'orange juice': 10,         // was 7 — store-bought OJ is 7–10 days opened
  'apple juice': 10,
  'juice': 10,
  'almond milk': 10,
  'oat milk': 10,
  'soy milk': 10,
  'coconut milk': 7,          // opened carton
  'rice milk': 10,
  'kefir': 14,
  'kombucha': 30,             // sealed; opened is 7 days
  'lemonade': 7,
  'cold brew': 14,
  'sparkling water': 3,       // opened bottle loses fizz

  // ── Deli & Prepared ─────────────────────────────────────────────────────────
  // Source: Health Canada — cooked meats 3–4 days, cured meats up to a week
  'deli meat': 5, 'lunch meat': 5, 'cold cuts': 5,
  'salami': 5, 'pepperoni': 14,   // cured; unopened pepperoni 2 weeks
  'prosciutto': 5,
  'hummus': 7,
  'salsa': 10,                // was correct — opened jar 10 days
  'guacamole': 3,
  'tofu': 5,
  'tempeh': 7,
  'pesto': 7,                 // refrigerated, opened
  'tzatziki': 7,
  'tahini': 30,               // opened tahini fridge
  'miso paste': 180,          // miso keeps months in fridge
  'kimchi': 90,               // fermented; gets more sour but safe for months
  'sauerkraut': 90,

  // ── Cooked / Leftovers ──────────────────────────────────────────────────────
  // Source: Health Canada — all cooked food is 3–4 days fridge
  'leftovers': 4,
  'cooked chicken': 4, 'cooked turkey': 4, 'cooked beef': 4, 'cooked pork': 4,
  'cooked rice': 4,
  'cooked pasta': 4,
  'soup': 4, 'stew': 4, 'chili': 4, 'curry': 4,
  'cooked fish': 2,           // cooked fish degrades faster than meat
  'cooked shrimp': 3,
  'cooked beans': 5,
  'cooked lentils': 5,
  'mashed potatoes': 4,
  'cooked quinoa': 5,

  // ── Pantry Staples — Long Shelf Life ────────────────────────────────────────
  // Sealed/unopened. Source: USDA FoodKeeper, Health Canada
  'pasta': 730, 'spaghetti': 730, 'penne': 730, 'linguine': 730,
  'rice': 1825,               // was 730 — white rice is 4–5 years sealed
  'brown rice': 365,          // brown rice has oils, goes rancid after ~1 year
  'basmati rice': 1825, 'jasmine rice': 1825,
  'quinoa': 730,
  'lentils': 1095,            // dried lentils 2–3 years
  'dried beans': 1095, 'black beans': 1095, 'chickpeas': 1095,
  'split peas': 1095,
  'flour': 365,               // all-purpose flour in sealed container
  'whole wheat flour': 180,   // whole wheat goes rancid faster
  'almond flour': 90,         // high fat content, goes rancid quickly
  'bread flour': 365,
  'sugar': 1825,              // indefinitely if kept dry; 5 years is safe
  'brown sugar': 730,
  'icing sugar': 730, 'powdered sugar': 730,
  'salt': 1825,               // indefinitely; 5 years is conservative
  'oil': 365, 'olive oil': 365, 'vegetable oil': 365, 'canola oil': 365,
  'coconut oil': 730,         // coconut oil is stable for 2 years
  'sesame oil': 365,
  'avocado oil': 365,
  'vinegar': 1825,            // vinegar is self-preserving; 5 years
  'apple cider vinegar': 1825, 'white vinegar': 1825, 'balsamic vinegar': 1825,
  'soy sauce': 730,           // opened soy sauce is 1–2 years fridge
  'fish sauce': 730,
  'worcestershire sauce': 730,
  'hot sauce': 1095,          // vinegar-based hot sauce is 3 years
  'sriracha': 365,
  'ketchup': 365,             // opened, fridge
  'mustard': 365,
  'mayonnaise': 90,           // opened, fridge — mayo is 2–3 months
  'relish': 365,
  'honey': 1825,              // honey doesn't spoil; 5 years is conservative
  'maple syrup': 365,         // opened fridge; unopened is indefinite
  'agave': 365,
  'oats': 730,                // was 365 — rolled oats in sealed container 2 years
  'steel cut oats': 730,
  'cereal': 180,
  'granola': 90,
  'canned beans': 730, 'canned tomatoes': 730, 'canned corn': 730,
  'canned lentils': 730, 'canned chickpeas': 730, 'canned soup': 730,
  'canned tuna': 730, 'canned salmon': 730, 'canned sardines': 730,
  'canned coconut milk': 730,
  'peanut butter': 180,       // opened; natural PB is shorter due to no stabilizers
  'almond butter': 120,       // natural nut butter goes rancid faster
  'jam': 180, 'jelly': 180, 'marmalade': 180,  // opened, fridge
  'protein powder': 365,
  // ── Nuts ────────────────────────────────────────────────────────────────────
  // Shelled nuts in pantry; fridge doubles shelf life
  'nuts': 180,
  'almonds': 365,             // was 180 — almonds last 1 year in pantry
  'walnuts': 180,             // high omega-3, goes rancid faster
  'cashews': 180,
  'peanuts': 180,
  'pecans': 180,
  'pistachios': 180,
  'macadamia nuts': 180,
  'hazelnuts': 90,            // goes rancid quickly
  'pine nuts': 60,            // very high oil, goes rancid fast
  'brazil nuts': 90,
  'mixed nuts': 120,

  // ── Seeds ───────────────────────────────────────────────────────────────────
  // Sealed container, pantry — generally very shelf-stable
  'seeds': 730,
  'sesame seeds': 730,        // 1–3 years sealed
  'chia seeds': 730,          // 2 years sealed
  'flax seeds': 365,          // was 730 — whole flax is 1 year; ground is 90 days
  'ground flax': 90,          // oils oxidize quickly once ground
  'sunflower seeds': 365,     // shelled, pantry
  'pumpkin seeds': 365,       // shelled, pantry
  'hemp seeds': 365,          // hemp is rich in omega-3, fridge recommended
  'poppy seeds': 730,
  'caraway seeds': 730,
  'fennel seeds': 730,
  'mustard seeds': 730,
  'nigella seeds': 730,

  // ── Spices & Herbs ──────────────────────────────────────────────────────────
  // Ground spices: 2–3 years. Whole spices: 3–5 years. Dried herbs: 1–3 years.
  // These values are for potency/quality — they don't become unsafe, just lose flavour
  'spices': 730,
  'black pepper': 730, 'ground pepper': 730, 'white pepper': 730,
  'cumin': 730, 'ground cumin': 730, 'cumin seeds': 1095,
  'coriander': 730, 'ground coriander': 730, 'coriander seeds': 1095,
  'turmeric': 730,
  'paprika': 730, 'smoked paprika': 730,
  'cinnamon': 730, 'cinnamon sticks': 1095,
  'oregano': 730,
  'basil': 730,               // dried basil
  'thyme': 730,
  'rosemary': 730,
  'bay leaves': 730,
  'dill': 730,
  'parsley': 730,             // dried
  'sage': 730,
  'tarragon': 730,
  'marjoram': 730,
  'chili powder': 730,
  'cayenne': 730,
  'red pepper flakes': 730,
  'garlic powder': 730,
  'onion powder': 730,
  'ginger powder': 730,
  'curry powder': 730,
  'garam masala': 730,
  'allspice': 730,
  'nutmeg': 730, 'whole nutmeg': 1095,
  'cloves': 730, 'whole cloves': 1095,
  'cardamom': 730,
  'star anise': 1095,
  'vanilla extract': 1825,    // pure vanilla extract keeps indefinitely
  'vanilla bean': 365,

  // ── Baking ──────────────────────────────────────────────────────────────────
  'chocolate': 365,           // was 180 — dark chocolate is up to 1 year
  'dark chocolate': 365, 'milk chocolate': 180, 'white chocolate': 90,
  'chocolate chips': 365,
  'cocoa': 730,               // unsweetened cocoa powder 2 years
  'cocoa powder': 730,
  'baking powder': 365,
  'baking soda': 365,
  'yeast': 120,               // active dry yeast once opened
  'instant yeast': 120,
  'cornstarch': 730,
  'gelatin': 1095,
  'cream of tartar': 1095,
  'food colouring': 1095,

  // ── Frozen (days in freezer) ────────────────────────────────────────────────
  // Health Canada freezer storage guidelines
  'frozen chicken': 270,      // 9 months
  'frozen beef': 270,
  'frozen fish': 180,         // 6 months
  'frozen shrimp': 270,
  'frozen vegetables': 270,
  'frozen fruit': 270,
  'frozen pizza': 60,         // 1–2 months quality
  'frozen meals': 90,
  'ice cream': 60,            // best quality 1–2 months; safe longer
  'frozen bread': 90,

  // ── Condiments & Sauces ─────────────────────────────────────────────────────
  'salad dressing': 90,       // opened, fridge
  'ranch dressing': 60,
  'caesar dressing': 60,
  'bbq sauce': 120,           // opened, fridge
  'teriyaki sauce': 365,
  'oyster sauce': 180,
  'hoisin sauce': 180,
  'coconut aminos': 365,
  'tomato paste': 5,          // opened can, fridge
  'tomato sauce': 5,          // opened jar, fridge
  'pasta sauce': 5,           // opened jar, fridge
  'stock': 5,                 // opened carton, fridge
  'chicken stock': 5, 'beef stock': 5, 'vegetable stock': 5,
  'broth': 5, 'chicken broth': 5, 'bone broth': 5,

  // ── Alcohol ─────────────────────────────────────────────────────────────────
  'wine': 5,                  // opened bottle, fridge
  'red wine': 5, 'white wine': 5,
  'beer': 1,                  // opened
  'sake': 14,                 // opened, fridge

  // ── Miscellaneous ───────────────────────────────────────────────────────────
  'protein powder': 365,
  'protein oats': 365,
  'nutritional yeast': 365,
  'coconut flakes': 180,
  'breadcrumbs': 180,
  'panko': 180,
  'crackers': 90,
  'popcorn': 60,              // unpopped kernels last years; popped goes stale fast
  'chips': 30,
  'coffee': 14,               // opened bag, ground — best flavour; safe longer
  'whole bean coffee': 30,
  'tea': 730,                 // loose leaf or bags, sealed
  'matcha': 180,              // ground matcha loses flavour fast
}

// ─── Match item name to lookup table ─────────────────────────────────────────
const lookupLocalExpiry = (itemName) => {
  const name = itemName.toLowerCase().trim()

  // Exact match first
  if (EXPIRY_TABLE[name]) return EXPIRY_TABLE[name]

  // Partial match — check if any key is contained in the item name
  for (const [key, days] of Object.entries(EXPIRY_TABLE)) {
    if (name.includes(key) || key.includes(name)) return days
  }

  return null
}

// ─── Learn from pantry history for this family ───────────────────────────────
const learnFromHistory = async (itemName, familyId) => {
  const history = await prisma.itemUsageHistory.findMany({
    where: {
      familyId,
      itemName: { contains: itemName.split(' ')[0], mode: 'insensitive' },
      removedAt: { not: null }
    },
    orderBy: { addedAt: 'desc' },
    take: 5
  })

  if (history.length === 0) return null

  // Calculate average days this item lasted in this family's pantry
  const durations = history
    .filter(h => h.removedAt)
    .map(h => Math.ceil((new Date(h.removedAt) - new Date(h.addedAt)) / (1000 * 60 * 60 * 24)))
    .filter(d => d > 0 && d < 365)

  if (durations.length === 0) return null

  const avgDays = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  return { days: avgDays, source: 'pattern_learned', confidence: durations.length >= 3 ? 'high' : 'medium' }
}

// ─── Claude as last resort ───────────────────────────────────────────────────
const askClaude = async (itemName, category) => {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `How many days does "${itemName}" (category: ${category}) typically last after purchase? Respond ONLY with JSON: {"days":NUMBER,"confidence":"high"|"medium"|"low","reasoning":"one short sentence"}`
    }]
  })

  return JSON.parse(response.content[0].text)
}

// ─── Main predict endpoint ────────────────────────────────────────────────────
const predictExpiry = async (req, res) => {
  try {
    const { itemName, category, itemId } = req.body
    const familyId = req.user.familyId

    const today = new Date()
    let days, confidence, source, reasoning

    // 1. Try local lookup table first (free, instant)
    const localDays = lookupLocalExpiry(itemName)
    if (localDays) {
      days = localDays
      confidence = 'high'
      source = 'local_table'
      reasoning = `Standard shelf life for ${category} items`
    }

    // 2. Override with family's own learned patterns if available (more accurate)
    const learned = await learnFromHistory(itemName, familyId)
    if (learned) {
      days = learned.days
      confidence = learned.confidence
      source = learned.source
      reasoning = `Based on your family's actual usage history`
    }

    // 3. Only call Claude if nothing else worked
    if (!days) {
      const claudeResult = await askClaude(itemName, category)
      days = claudeResult.days
      confidence = claudeResult.confidence
      source = 'ai_predicted'
      reasoning = claudeResult.reasoning
    }

    const predictedExpiry = new Date(today.getTime() + days * 24 * 60 * 60 * 1000)

    // Save to pantry item
    if (itemId) {
      await prisma.pantryItem.update({
        where: { id: itemId },
        data: {
          predictedExpiry,
          expiryConfidence: confidence,
          expirySource: source
        }
      })
    }

    res.json({
      success: true,
      predictedExpiry: predictedExpiry.toISOString().split('T')[0],
      daysUntilExpiry: days,
      confidence,
      source,
      reasoning
    })
  } catch (err) {
    console.error('predictExpiry error:', err)
    res.status(500).json({ error: 'Failed to predict expiry' })
  }
}

// ─── Get expiring soon items ──────────────────────────────────────────────────
const getExpiringSoon = async (req, res) => {
  try {
    const familyId = req.user.familyId
    const now = new Date()
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const items = await prisma.pantryItem.findMany({ where: { familyId } })

    const expiringSoon = items
      .map(item => {
        const expiryDate = item.expiry
          ? new Date(item.expiry)
          : item.predictedExpiry
            ? new Date(item.predictedExpiry)
            : null

        if (!expiryDate) return null

        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))

        return {
          ...item,
          expiryDate: expiryDate.toISOString().split('T')[0],
          daysLeft,
          isExpired: daysLeft < 0,
          urgency: daysLeft < 0 ? 'expired' : daysLeft <= 2 ? 'critical' : daysLeft <= 5 ? 'warning' : 'soon'
        }
      })
      .filter(item => item && item.daysLeft <= 7)
      .sort((a, b) => a.daysLeft - b.daysLeft)

    res.json(expiringSoon)
  } catch (err) {
    console.error('getExpiringSoon error:', err)
    res.status(500).json({ error: 'Failed to get expiring items' })
  }
}

// ─── Log item removal (self-learning) ────────────────────────────────────────
const logItemRemoval = async (req, res) => {
  try {
    const { itemName, category, predictedExpiry, actualExpiry, removalReason } = req.body
    const familyId = req.user.familyId

    await prisma.itemUsageHistory.create({
      data: {
        itemName,
        category,
        predictedExpiry: predictedExpiry ? new Date(predictedExpiry) : null,
        actualExpiry: actualExpiry ? new Date(actualExpiry) : null,
        removalReason: removalReason || 'used',
        removedAt: new Date(),
        familyId
      }
    })

    res.json({ success: true })
  } catch (err) {
    console.error('logItemRemoval error:', err)
    res.status(500).json({ error: 'Failed to log removal' })
  }
}

module.exports = { predictExpiry, getExpiringSoon, logItemRemoval }