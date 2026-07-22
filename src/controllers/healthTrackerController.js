const prisma = require('../utils/prisma')
const { heightToCm, toKg } = require('../services/units')
const macroEngine = require('../services/macroEngine')
const { ACTIVITY_MULTIPLIERS } = macroEngine

const VALID_FITNESS_GOALS = ['cut', 'lean_bulk', 'recomp', 'maintain']
const PLAN_RANK = { free: 0, family: 1, premium: 2 }

// Pure computation — no DB access. weightLogsAsc: [{weight, unit, loggedAt}] oldest-first.
// Exported so the fitnessRecalibration job can reuse it without duplicating logic.
function buildMemberTargets(member, weightLogsAsc = []) {
  if (!member.weight || !member.age) return null

  const latestLog = weightLogsAsc[weightLogsAsc.length - 1]
  const weightKg = latestLog
    ? toKg(latestLog.weight, latestLog.unit) ?? toKg(member.weight, member.weightUnit)
    : toKg(member.weight, member.weightUnit)

  const heightCm = heightToCm(member.height) ?? 170
  const sex = member.gender
  const { bmr: bmrValue, confidence } = macroEngine.bmr({ weightKg, heightCm, age: member.age, sex })
  const fTdee = macroEngine.formulaTdee(bmrValue, member.activityLevel)
  const effectiveTdee = member.tdeeEstimate || fTdee
  const source = member.tdeeEstimate ? 'adaptive' : 'formula'

  const logsKg = weightLogsAsc.map(w => ({
    weightKg: toKg(w.weight, w.unit) ?? weightKg,
    loggedAt: w.loggedAt,
  }))
  const trendSeries = macroEngine.trendWeights(logsKg)
  const latestTrend = trendSeries[trendSeries.length - 1]
  const trendWeightKg = latestTrend ? Math.round(latestTrend.trendKg * 10) / 10 : null
  const velocity = macroEngine.weeklyVelocity(trendSeries)

  let calories = null
  let flooredRatePct = null
  let macros = null

  if (member.fitnessGoal) {
    const result = macroEngine.goalCalories({
      tdee: effectiveTdee,
      weightKg,
      fitnessGoal: member.fitnessGoal,
      goalRatePct: member.goalRatePct || 0,
      sex,
      bmrValue,
    })
    calories = result.calories
    flooredRatePct = result.flooredRatePct
    macros = macroEngine.macroTargets({
      calories,
      weightKg,
      goalWeightKg: member.goalWeight || null,
      fitnessGoal: member.fitnessGoal,
    })
  }

  return {
    bmr: Math.round(bmrValue),
    confidence,
    formulaTdee: Math.round(fTdee),
    effectiveTdee: Math.round(effectiveTdee),
    source,
    calories,
    flooredRatePct,
    macros,
    trendWeightKg,
    weeklyVelocity: velocity !== null ? Math.round(velocity * 100) / 100 : null,
  }
}

// Pre-activityLevel path: preserves exact existing behaviour for members with null activityLevel
const legacyCalories = (bmr, goal) => {
  if (goal.includes('lose weight'))                         return Math.round(bmr * 1.375 - 500)
  if (goal.includes('gain muscle'))                         return Math.round(bmr * 1.55 + 300)
  if (goal.includes('high protein'))                        return Math.round(bmr * 1.55)
  if (goal.includes('diabetes') || goal.includes('heart'))  return Math.round(bmr * 1.2)
  if (goal.includes('healthy growth'))                      return Math.round(bmr * 1.725)
  return Math.round(bmr * 1.375)
}

const calculateDailyCalories = (member) => {
  if (!member.age || !member.weight) return null

  // New fitnessGoal path — fully delegated to macroEngine
  if (member.fitnessGoal) {
    const weightKg = toKg(member.weight, member.weightUnit)
    const heightCm = heightToCm(member.height) ?? 170
    const sex = member.gender
    const { bmr: bmrValue } = macroEngine.bmr({ weightKg, heightCm, age: member.age, sex })
    const tdee = member.tdeeEstimate || macroEngine.formulaTdee(bmrValue, member.activityLevel)
    const { calories } = macroEngine.goalCalories({
      tdee,
      weightKg,
      fitnessGoal: member.fitnessGoal,
      goalRatePct: member.goalRatePct || 0,
      sex,
      bmrValue,
    })
    return Math.round(calories)
  }

  // Legacy path — zero behavior change for members without fitnessGoal
  // Fall back to 170 cm population average when height is missing or unparseable.
  // This introduces ~100–150 kcal error vs a true height — lower confidence.
  const heightCm = heightToCm(member.height) ?? 170

  // BMR using Mifflin-St Jeor. Female constant is -161, male (default) is +5.
  const weightKg = toKg(member.weight, member.weightUnit)
  const age = member.age
  const isFemale = member.gender === 'female'
  const genderConstant = isFemale ? -161 : 5
  let bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + genderConstant

  const goal = (member.goals || '').toLowerCase()
  let calories

  if (member.activityLevel && ACTIVITY_MULTIPLIERS[member.activityLevel]) {
    calories = Math.round(bmr * ACTIVITY_MULTIPLIERS[member.activityLevel])
    if (goal.includes('lose weight')) calories -= 500
    else if (goal.includes('gain muscle')) calories += 300
  } else {
    calories = legacyCalories(bmr, goal)
  }

  return Math.max(1200, Math.min(4000, calories)) // Clamp between 1200-4000
}

// Get macro targets based on goal; pass member to use macroEngine when fitnessGoal is set
const getMacroTargets = (calories, goal = '', member = null) => {
  if (member && member.fitnessGoal) {
    return macroEngine.macroTargets({
      calories,
      weightKg: toKg(member.weight, member.weightUnit),
      goalWeightKg: member.goalWeight || null,
      fitnessGoal: member.fitnessGoal,
    })
  }

  // Legacy path
  const g = (goal || '').toLowerCase()
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
      const macroTargets = getMacroTargets(dailyCalorieGoal || 2000, member.goals, member)

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
      const latestWeightUnit = member.weightLogs[0]?.unit || 'kg'

      // Weight progress
      const weightHistory = member.weightLogs.map(w => ({
        weight: w.weight,
        unit: w.unit || 'kg',
        note: w.note,
        date: w.loggedAt,
      }))

      // Targets breakdown for members with a fitness goal (weight logs already fetched desc, reverse for EWMA)
      const targets = member.fitnessGoal
        ? buildMemberTargets(member, [...member.weightLogs].reverse())
        : null

      return {
        id: member.id,
        name: member.name,
        age: member.age,
        gender: member.gender,
        genderMissing: !member.gender && !member.isBaby && (member.age === null || member.age >= 13),
        fitnessGoal: member.fitnessGoal,
        goalRatePct: member.goalRatePct,
        tdeeEstimate: member.tdeeEstimate,
        tdeeConfidence: member.tdeeConfidence,
        currentWeight: latestWeight,
        weightUnit: latestWeightUnit,
        goalWeight: member.goalWeight,
        height: member.height,
        goals: member.goals,
        dietary: member.dietary,
        allergens: member.allergens,
        dailyCalorieGoal,
        macroTargets,
        targets,
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
    const { memberName, recipeName, mealType, calories, protein, carbs, fat, fiber, calcium, iron, vitaminD } = req.body
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
        calcium: calcium ? parseFloat(calcium) : null,
        iron: iron ? parseFloat(iron) : null,
        vitaminD: vitaminD ? parseFloat(vitaminD) : null,
        familyId,
      }
    })

    res.json({ success: true, log })
  } catch (err) {
    console.error('logMeal error:', err)
    res.status(500).json({ error: 'Failed to log meal' })
  }
}

// Update member goal — accepts legacy fields plus new fitness-coach fields
exports.updateMemberGoal = async (req, res) => {
  try {
    const { memberId, dailyCalorieGoal, goalWeight, fitnessGoal, goalRatePct, gender } = req.body
    const familyId = req.user.familyId

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId }
    })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    // Validate fitnessGoal value when provided
    if (fitnessGoal !== undefined && fitnessGoal !== null && !VALID_FITNESS_GOALS.includes(fitnessGoal)) {
      return res.status(400).json({ error: `fitnessGoal must be one of: ${VALID_FITNESS_GOALS.join(', ')}` })
    }

    // Gate setting a non-null fitnessGoal behind the fitness_coach feature flag (premium)
    if (fitnessGoal) {
      const [family, flag] = await Promise.all([
        prisma.family.findUnique({ where: { id: familyId }, select: { plan: true } }),
        prisma.featureFlag.findUnique({ where: { name: 'fitness_coach' } }),
      ])
      const hasAccess = flag && flag.enabled &&
        (PLAN_RANK[family?.plan] ?? 0) >= (PLAN_RANK[flag.requiredPlan] ?? 0)
      if (!hasAccess) {
        return res.status(403).json({ error: 'Fitness Coach requires a Premium plan.' })
      }

      // Age safety: under-18 members may only use maintain
      if (!macroEngine.isEligibleForGoal(member.age, fitnessGoal)) {
        return res.status(400).json({
          error: 'Members under 18 can only use the Maintain goal. Cut, lean bulk, and recomp are not available for minors.'
        })
      }
    }

    const updateData = {}
    if (dailyCalorieGoal !== undefined) updateData.dailyCalorieGoal = parseInt(dailyCalorieGoal)
    if (goalWeight !== undefined)       updateData.goalWeight   = goalWeight ? parseFloat(goalWeight) : null
    if (fitnessGoal !== undefined)      updateData.fitnessGoal  = fitnessGoal || null
    if (goalRatePct !== undefined)      updateData.goalRatePct  = goalRatePct != null ? parseFloat(goalRatePct) : null
    if (gender !== undefined)           updateData.gender       = gender || null

    const updated = await prisma.member.update({
      where: { id: memberId },
      data: updateData,
    })

    res.json({ success: true, member: updated })
  } catch (err) {
    console.error('updateMemberGoal error:', err)
    res.status(500).json({ error: 'Failed to update member goal' })
  }
}

// GET /health-tracker/targets/:memberId — full deterministic breakdown, no AI
exports.getMemberTargets = async (req, res) => {
  try {
    const { memberId } = req.params
    const familyId = req.user.familyId

    const member = await prisma.member.findFirst({
      where: { id: memberId, familyId },
      include: {
        weightLogs: { orderBy: { loggedAt: 'asc' } },
      },
    })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    const targets = buildMemberTargets(member, member.weightLogs)
    res.json(targets)
  } catch (err) {
    console.error('getMemberTargets error:', err)
    res.status(500).json({ error: 'Failed to compute targets' })
  }
}

exports.buildMemberTargets = buildMemberTargets

// GET /health-tracker/audit/:memberId — latest WeeklyAudit, gated behind fitness_coach flag
exports.getLatestAudit = async (req, res) => {
  try {
    const { memberId } = req.params
    const familyId = req.user.familyId

    const member = await prisma.member.findFirst({ where: { id: memberId, familyId } })
    if (!member) return res.status(404).json({ error: 'Member not found' })

    const [family, flag] = await Promise.all([
      prisma.family.findUnique({ where: { id: familyId }, select: { plan: true } }),
      prisma.featureFlag.findUnique({ where: { name: 'fitness_coach' } }),
    ])
    const hasAccess = flag && flag.enabled &&
      (PLAN_RANK[family?.plan] ?? 0) >= (PLAN_RANK[flag.requiredPlan] ?? 0)
    if (!hasAccess) return res.status(403).json({ error: 'Fitness Coach requires a Premium plan.' })

    const audit = await prisma.weeklyAudit.findFirst({
      where: { memberId },
      orderBy: { weekStart: 'desc' },
    })

    res.json({ audit: audit ?? null })
  } catch (err) {
    console.error('getLatestAudit error:', err)
    res.status(500).json({ error: 'Failed to get audit' })
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