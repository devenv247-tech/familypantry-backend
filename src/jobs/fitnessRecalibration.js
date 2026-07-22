const cron = require('node-cron')
const prisma = require('../utils/prisma')
const macroEngine = require('../services/macroEngine')
const { heightToCm, toKg } = require('../services/units')

const PLAN_RANK = { free: 0, family: 1, premium: 2 }

const runFitnessRecalibration = async () => {
  console.log('[fitnessRecalibration] Starting weekly TDEE recalibration...')

  const flag = await prisma.featureFlag.findUnique({ where: { name: 'fitness_coach' } })
  if (!flag || !flag.enabled) {
    console.log('[fitnessRecalibration] fitness_coach flag disabled — skipping')
    return
  }

  const requiredRank = PLAN_RANK[flag.requiredPlan] ?? 0
  const qualifyingPlans = Object.keys(PLAN_RANK).filter(p => (PLAN_RANK[p] ?? 0) >= requiredRank)

  const families = await prisma.family.findMany({
    where: { plan: { in: qualifyingPlans } },
    select: { id: true },
  })

  console.log(`[fitnessRecalibration] ${families.length} eligible families`)

  const now = new Date()
  const windowStart = new Date(now.getTime() - 14 * 86400000)

  for (const family of families) {
    const members = await prisma.member.findMany({
      where: { familyId: family.id, fitnessGoal: { not: null } },
    })

    for (const member of members) {
      try {
        // Daily calorie totals from NutritionLog — group by calendar day
        const nutritionLogs = await prisma.nutritionLog.findMany({
          where: {
            familyId: family.id,
            memberName: { equals: member.name, mode: 'insensitive' },
            loggedAt: { gte: windowStart },
            calories: { not: null },
          },
          select: { loggedAt: true, calories: true },
        })

        const dailyMap = {}
        for (const log of nutritionLogs) {
          const day = new Date(log.loggedAt).toDateString()
          dailyMap[day] = (dailyMap[day] || 0) + (log.calories || 0)
        }
        const dailyIntakes = Object.values(dailyMap)

        // WeightLog series in the window, converted to kg
        const weightLogs = await prisma.weightLog.findMany({
          where: { memberId: member.id, loggedAt: { gte: windowStart } },
          orderBy: { loggedAt: 'asc' },
          select: { weight: true, unit: true, loggedAt: true },
        })

        const latestLog = weightLogs[weightLogs.length - 1]
        const weightKg = latestLog
          ? toKg(latestLog.weight, latestLog.unit) ?? toKg(member.weight, member.weightUnit)
          : toKg(member.weight, member.weightUnit)

        const logsKg = weightLogs.map(w => ({
          weightKg: toKg(w.weight, w.unit) ?? weightKg,
          loggedAt: w.loggedAt,
        }))

        // BMR + formula TDEE for blending and clamping
        const heightCm = heightToCm(member.height) ?? 170
        const { bmr: bmrValue } = macroEngine.bmr({
          weightKg,
          heightCm,
          age: member.age,
          sex: member.gender,
        })
        const fTdee = macroEngine.formulaTdee(bmrValue, member.activityLevel)

        const trendSeries = macroEngine.trendWeights(logsKg)

        // Require ≥4 weigh-ins in the window before attempting adaptive estimate
        let updateData = { tdeeConfidence: 'formula', tdeeUpdatedAt: now }

        if (trendSeries.length >= 4) {
          const trendStartKg = trendSeries[0].trendKg
          const trendEndKg   = trendSeries[trendSeries.length - 1].trendKg

          const adaptive = macroEngine.adaptiveTdee({
            dailyIntakes,
            trendStartKg,
            trendEndKg,
            windowDays: 14,
          })

          if (adaptive !== null && isFinite(adaptive)) {
            const blended = macroEngine.blendTdee({
              previous: member.tdeeEstimate || null,
              fresh:    adaptive,
              formula:  fTdee,
            })
            updateData = {
              tdeeEstimate:   blended,
              tdeeUpdatedAt:  now,
              tdeeConfidence: 'adaptive',
            }
          }
        }

        await prisma.member.update({ where: { id: member.id }, data: updateData })

        console.log(`[fitnessRecalibration] ${member.name} (${member.id}): ${updateData.tdeeConfidence}`)
      } catch (err) {
        console.error(`[fitnessRecalibration] Failed for member ${member.id}:`, err.message)
      }
    }
  }

  console.log('[fitnessRecalibration] Done.')
}

const scheduleFitnessRecalibration = () => {
  // Sundays 6am America/Vancouver
  cron.schedule('0 6 * * 0', runFitnessRecalibration, { timezone: 'America/Vancouver' })
  console.log('[fitnessRecalibration] Scheduled — Sundays 6am PT')
}

module.exports = { scheduleFitnessRecalibration, runFitnessRecalibration }
