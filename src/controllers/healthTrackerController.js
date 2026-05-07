const prisma = require('../utils/prisma')

// Harris-Benedict formula to calculate daily calorie goal
const calculateDailyCalories = (member) => {
  if (!member.age || !member.weight) return null

  // Parse height - supports formats like "5'8", "175cm", "175"
  let heightCm = null
  if (member.height) {
    const feetInches = member.height.match(/(\d+)'(\d+)?/)
    const cm = member.height.match(/(\d+)\s*cm/i)
    const plain = member.height.match(/^(\d+)$/)
    if (feetInches) {
      const feet = parseInt(feetInches[1])
      const inches = parseInt(feetInches[2] || 0)
      heightCm = (feet * 30.48) + (inches * 2.54)
    } else if (cm) {
      heightCm = parseFloat(cm[1])
    } else if (plain) {
      heightCm = parseFloat(plain[1])
    }
  }

  // BMR using Mifflin-St Jeor (more accurate than Harris-Benedict)
  // Assuming male formula as default (we don't store gender)
  const weightKg = member.weight
  const age = member.age
  let bmr = heightCm
    ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5
    : (10 * weightKg) - (5 * age) + 5

  // Activity multiplier and goal adjustment
  const goal = (member.goals || '').toLowerCase()
  let calories

  if (goal.includes('lose weight')) {
    calories = Math.round(bmr * 1.375 - 500) // Moderate activity, deficit
  } else if (goal.includes('gain muscle')) {
    calories = Math.round(bmr * 1.55 + 300) // Active, surplus
  } else if (goal.includes('high protein')) {
    calories = Math.round(bmr * 1.55)
  } else if (goal.includes('diabetes') || goal.includes('heart')) {
    calories = Math.round(bmr * 1.2) // Light activity, controlled
  } else if (goal.includes('healthy growth')) {
    calories = Math.round(bmr * 1.725) // Very active (kids)
  } else {
    calories = Math.round(bmr * 1.375) // Moderate activity, maintain
  }

  return Math.max(1200, Math.min(4000, calories)) // Clamp between 1200-4000
}

// Get macro targets based on goal
const getMacroTargets = (calories, goal = '') => {
  const g = goal.toLowerCase()
  if (g.includes('gain muscle') || g.includes('high protein')) {
    return {
      protein: Math.round((calories * 0.35) / 4), // 35% protein
      carbs: Math.round((calories * 0.40) / 4),   // 40% carbs
      fat: Math.round((calories * 0.25) / 9),     // 25% fat
    }
  } else if (g.includes('lose weight')) {
    return {
      protein: Math.round((calories * 0.30) / 4), // 30% protein
      carbs: Math.round((calories * 0.40) / 4),   // 40% carbs
      fat: Math.round((calories * 0.30) / 9),     // 30% fat
    }
  } else if (g.includes('keto') || g.includes('diabetes')) {
    return {
      protein: Math.round((calories * 0.25) / 4), // 25% protein
      carbs: Math.round((calories * 0.10) / 4),   // 10% carbs
      fat: Math.round((calories * 0.65) / 9),     // 65% fat
    }
  } else {
    return {
      protein: Math.round((calories * 0.25) / 4), // 25% protein
      carbs: Math.round((calories * 0.50) / 4),   // 50% carbs
      fat: Math.round((calories * 0.25) / 9),     // 25% fat
    }
  }
}

// Get health data for all members
exports.getHealthData = async (req, res) => {
  try {
    const familyId = req.user.familyId
    const { memberId, days = 7 } = req.query

    const members = await prisma.member.findMany({
      where: { familyId },
      include: {
        weightLogs: {
          orderBy: { loggedAt: 'desc' },
          take: 30,
        }
      }
    })

    const daysAgo = new Date()
    daysAgo.setDate(daysAgo.getDate() - parseInt(days))

    // Get nutrition logs for period
    const nutritionLogs = await prisma.nutritionLog.findMany({
      where: {
        familyId,
        loggedAt: { gte: daysAgo },
        ...(memberId ? { memberName: members.find(m => m.id === memberId)?.name } : {})
      },
      orderBy: { loggedAt: 'desc' }
    })

    // Build member health profiles
    const memberProfiles = members.map(member => {
      const dailyCalorieGoal = member.dailyCalorieGoal || calculateDailyCalories(member)
      const macroTargets = getMacroTargets(dailyCalorieGoal || 2000, member.goals)

      // Get logs for this member
      const memberLogs = nutritionLogs.filter(l =>
        l.memberName && member.name && l.memberName.toLowerCase() === member.name.toLowerCase()
      )

      // Today's totals
      const today = new Date().toDateString()
      const todayLogs = memberLogs.filter(l => new Date(l.loggedAt).toDateString() === today)
      const todayTotals = todayLogs.reduce((acc, log) => ({
        calories: acc.calories + (log.calories || 0),
        protein: acc.protein + (log.protein || 0),
        carbs: acc.carbs + (log.carbs || 0),
        fat: acc.fat + (log.fat || 0),
        fiber: acc.fiber + (log.fiber || 0),
      }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })

      // 7-day history
      const last7Days = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toDateString()
        const dayLogs = memberLogs.filter(l => new Date(l.loggedAt).toDateString() === dateStr)
        const dayCalories = dayLogs.reduce((sum, l) => sum + (l.calories || 0), 0)
        last7Days.push({
          date: date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }),
          calories: Math.round(dayCalories),
          goal: dailyCalorieGoal,
          mealsLogged: dayLogs.length,
        })
      }

      // Streak calculation
      let streak = 0
      for (let i = 0; i < 30; i++) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toDateString()
        const hasLog = memberLogs.some(l => new Date(l.loggedAt).toDateString() === dateStr)
        if (hasLog) streak++
        else if (i > 0) break
      }

      // Latest weight
      const latestWeight = member.weightLogs[0]?.weight || member.weight

      // Weight progress
      const weightHistory = member.weightLogs.map(w => ({
        weight: w.weight,
        unit: w.unit || 'kg',
        note: w.note,
        date: w.loggedAt,
      }))

      return {
        id: member.id,
        name: member.name,
        age: member.age,
        currentWeight: latestWeight,
        goalWeight: member.goalWeight,
        height: member.height,
        goals: member.goals,
        dietary: member.dietary,
        allergens: member.allergens,
        dailyCalorieGoal,
        macroTargets,
        todayTotals: {
          calories: Math.round(todayTotals.calories),
          protein: Math.round(todayTotals.protein),
          carbs: Math.round(todayTotals.carbs),
          fat: Math.round(todayTotals.fat),
          fiber: Math.round(todayTotals.fiber),
        },
        todayMeals: todayLogs,
        last7Days,
        streak,
        weightHistory,
        recentMeals: memberLogs.slice(0, 10),
      }
    })

    res.json({ members: memberProfiles })
 } catch (err) {
    console.error('getHealthData error:', err)
    res.status(500).json({ error: 'Failed to get health data', detail: err.message, code: err.code })
  }
}

// Log weight for a member
exports.logWeight = async (req, res) => {
  try {
    const { memberId, weight, unit, note } = req.body
    const familyId = req.user.familyId

    if (!memberId || !weight) {
      return res.status(400).json({ error: 'Member and weight are required' })
    }

    // Verify member belongs to family
    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId }
    })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    // Log weight
    const log = await prisma.weightLog.create({
      data: {
        memberId,
        weight: parseFloat(weight),
        unit: unit || 'kg',
        note: note || null,
      }
    })

    // Update member's current weight
    await prisma.member.update({
      where: { id: memberId },
      data: { weight: parseFloat(weight) }
    })

    res.json({ success: true, log })
  } catch (err) {
    console.error('logWeight error:', err)
    res.status(500).json({ error: 'Failed to log weight' })
  }
}

// Log a manual meal
exports.logMeal = async (req, res) => {
  try {
    const { memberName, recipeName, mealType, calories, protein, carbs, fat, fiber } = req.body
    const familyId = req.user.familyId

    if (!memberName || !recipeName) {
      return res.status(400).json({ error: 'Member name and meal name are required' })
    }

    const log = await prisma.nutritionLog.create({
      data: {
        memberName,
        recipeName,
        mealType: mealType || 'Meal',
        calories: calories ? parseFloat(calories) : null,
        protein: protein ? parseFloat(protein) : null,
        carbs: carbs ? parseFloat(carbs) : null,
        fat: fat ? parseFloat(fat) : null,
        fiber: fiber ? parseFloat(fiber) : null,
        familyId,
      }
    })

    res.json({ success: true, log })
  } catch (err) {
    console.error('logMeal error:', err)
    res.status(500).json({ error: 'Failed to log meal' })
  }
}

// Update member calorie goal
exports.updateMemberGoal = async (req, res) => {
  try {
    const { memberId, dailyCalorieGoal, goalWeight } = req.body
    const familyId = req.user.familyId

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId }
    })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    const updated = await prisma.member.update({
      where: { id: memberId },
      data: {
        ...(dailyCalorieGoal && { dailyCalorieGoal: parseInt(dailyCalorieGoal) }),
        ...(goalWeight && { goalWeight: parseFloat(goalWeight) }),
      }
    })

    res.json({ success: true, member: updated })
  } catch (err) {
    console.error('updateMemberGoal error:', err)
    res.status(500).json({ error: 'Failed to update member goal' })
  }
}

// Delete a nutrition log entry
exports.deleteNutritionLog = async (req, res) => {
  try {
    const { id } = req.params
    const familyId = req.user.familyId

    const log = await prisma.nutritionLog.findFirst({
      where: { id, familyId }
    })
    if (!log) return res.status(404).json({ error: 'Log not found' })

    await prisma.nutritionLog.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error('deleteNutritionLog error:', err)
    res.status(500).json({ error: 'Failed to delete log' })
  }
}

// Search nutrition cache by meal name
exports.searchNutritionCache = async (req, res) => {
  try {
    const { q } = req.query
    if (!q || q.length < 2) return res.json({ results: [] })

    const results = await prisma.nutritionCache.findMany({
      where: {
        mealName: {
          contains: q,
          mode: 'insensitive'
        },
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: { hitCount: 'desc' },
      take: 6,
      select: {
        mealName: true,
        calories: true,
        protein: true,
        carbs: true,
        fat: true,
        fiber: true,
        servingSize: true,
        source: true,
        confidence: true,
      }
    })

    res.json({ results })
  } catch (err) {
    console.error('Nutrition cache search error:', err)
    res.json({ results: [] })
  }
}