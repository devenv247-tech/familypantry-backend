const prisma = require('../utils/prisma')

// Goal targets by health goal type
const GOAL_TARGETS = {
  'lose weight':      { calories: { max: 1800 }, protein: { min: 100 }, carbs: { max: 150 }, fat: { max: 60 } },
  'weight loss':      { calories: { max: 1800 }, protein: { min: 100 }, carbs: { max: 150 }, fat: { max: 60 } },
  'build muscle':     { calories: { min: 2000 }, protein: { min: 150 }, carbs: { min: 200 }, fat: { min: 50 } },
  'muscle gain':      { calories: { min: 2000 }, protein: { min: 150 }, carbs: { min: 200 }, fat: { min: 50 } },
  'healthy eating':   { calories: { min: 1600, max: 2200 }, protein: { min: 60 }, carbs: { min: 150, max: 300 }, fat: { min: 40, max: 80 } },
  'maintenance':      { calories: { min: 1800, max: 2400 }, protein: { min: 60 }, carbs: { min: 150, max: 300 }, fat: { min: 50, max: 90 } },
  'high protein':     { calories: { min: 1800 }, protein: { min: 180 }, carbs: { max: 200 }, fat: { max: 80 } },
  'low carb':         { calories: { min: 1600 }, protein: { min: 100 }, carbs: { max: 100 }, fat: { min: 60 } },
  'heart health':     { calories: { max: 2000 }, protein: { min: 60 }, carbs: { min: 150 }, fat: { max: 60 }, sodium: { max: 1500 } },
}

const getGoalTargets = (goalText) => {
  if (!goalText) return GOAL_TARGETS['healthy eating']
  const lower = goalText.toLowerCase()
  for (const [key, targets] of Object.entries(GOAL_TARGETS)) {
    if (lower.includes(key)) return targets
  }
  return GOAL_TARGETS['healthy eating']
}

const getStatus = (value, target) => {
  if (!value || !target) return 'neutral'
  if (target.min && target.max) {
    if (value < target.min) return 'low'
    if (value > target.max) return 'high'
    return 'good'
  }
  if (target.min) return value >= target.min ? 'good' : 'low'
  if (target.max) return value <= target.max ? 'good' : 'high'
  return 'neutral'
}

const statusIcon = (status) => {
  if (status === 'good') return '✅'
  if (status === 'low') return '⬇️'
  if (status === 'high') return '⚠️'
  return '➖'
}

// Log nutrition when a meal is cooked
const logNutrition = async (req, res) => {
  try {
    const { memberNames, recipeName, mealType, nutritionPerServing } = req.body
    const familyId = req.user.familyId

    if (!memberNames || memberNames.length === 0 || !nutritionPerServing) {
      return res.json({ success: true, skipped: true })
    }

    await Promise.all(
      memberNames.map(memberName =>
        prisma.nutritionLog.create({
          data: {
            memberName,
            recipeName,
            mealType,
            calories: nutritionPerServing.calories || null,
            protein: nutritionPerServing.protein || null,
            carbs: nutritionPerServing.carbs || null,
            fat: nutritionPerServing.fat || null,
            fiber: nutritionPerServing.fiber || null,
            sugar: nutritionPerServing.sugar || null,
            sodium: nutritionPerServing.sodium || null,
            familyId
          }
        })
      )
    )

    res.json({ success: true, logged: memberNames.length })
  } catch (err) {
    console.error('logNutrition error:', err)
    res.status(500).json({ error: 'Failed to log nutrition' })
  }
}

// Get health progress for all members
const getHealthProgress = async (req, res) => {
  try {
    const familyId = req.user.familyId

    // Get all members with their goals
    const members = await prisma.member.findMany({
      where: { familyId }
    })

    // Get last 7 days of nutrition logs
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const logs = await prisma.nutritionLog.findMany({
      where: {
        familyId,
        loggedAt: { gte: sevenDaysAgo }
      },
      orderBy: { loggedAt: 'desc' }
    })

    if (logs.length === 0) {
      return res.json({ hasData: false, members: [] })
    }

    // Build progress per member
    const progress = members.map(member => {
      const memberLogs = logs.filter(l => l.memberName === member.name)

      if (memberLogs.length === 0) {
        return {
          name: member.name,
          goal: member.goals || 'healthy eating',
          hasData: false
        }
      }

      // Calculate averages
      const avg = (field) => {
        const vals = memberLogs.map(l => l[field]).filter(v => v !== null && v !== undefined)
        if (vals.length === 0) return null
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      }

      const averages = {
        calories: avg('calories'),
        protein: avg('protein'),
        carbs: avg('carbs'),
        fat: avg('fat'),
        fiber: avg('fiber'),
        sodium: avg('sodium'),
      }

      const targets = getGoalTargets(member.goals)

      const metrics = [
        { label: 'Calories', value: averages.calories, unit: 'kcal', target: targets.calories, status: getStatus(averages.calories, targets.calories) },
        { label: 'Protein', value: averages.protein, unit: 'g', target: targets.protein, status: getStatus(averages.protein, targets.protein) },
        { label: 'Carbs', value: averages.carbs, unit: 'g', target: targets.carbs, status: getStatus(averages.carbs, targets.carbs) },
        { label: 'Fat', value: averages.fat, unit: 'g', target: targets.fat, status: getStatus(averages.fat, targets.fat) },
      ].filter(m => m.value !== null)

      const goodCount = metrics.filter(m => m.status === 'good').length
      const overallScore = metrics.length > 0 ? Math.round((goodCount / metrics.length) * 100) : 0

      return {
        name: member.name,
        goal: member.goals || 'healthy eating',
        hasData: true,
        mealsLogged: memberLogs.length,
        overallScore,
        metrics: metrics.map(m => ({
          ...m,
          icon: statusIcon(m.status),
          targetText: m.target
            ? m.target.min && m.target.max ? `${m.target.min}–${m.target.max}${m.unit}`
              : m.target.min ? `${m.target.min}+${m.unit}`
              : `<${m.target.max}${m.unit}`
            : null
        }))
      }
    })

    res.json({ hasData: true, members: progress })
  } catch (err) {
    console.error('getHealthProgress error:', err)
    res.status(500).json({ error: 'Failed to get health progress' })
  }
}

module.exports = { logNutrition, getHealthProgress }