const cron = require('node-cron')
const Anthropic = require('@anthropic-ai/sdk')
const prisma = require('../utils/prisma')
const macroEngine = require('../services/macroEngine')
const { heightToCm, toKg } = require('../services/units')
const { trackApiUsage } = require('../utils/anthropicError')
const { buildMemberTargets } = require('../controllers/healthTrackerController')

const PLAN_RANK = { free: 0, family: 1, premium: 2 }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const callClaude = async (params, endpoint) => {
  const message = await anthropic.messages.create(params)
  await trackApiUsage(endpoint, message.usage?.input_tokens || 0, message.usage?.output_tokens || 0, params.model)
  return message
}

// {{name}} is a server-side placeholder — never sent to the API. Substituted after parsing.
const COACH_FALLBACKS = {
  on_track:          '{{name}}, great work this week — your habits are putting you on track to reach your goal.',
  under_eating:      '{{name}}, your calorie intake was low this week — try to consistently hit your daily target to fuel your progress.',
  over_target:       '{{name}}, you went over your calorie target this week — a small adjustment each day will get you back on track.',
  plateau:           '{{name}}, your progress has stalled this week — the options below can help break through and get things moving again.',
  insufficient_data: '{{name}}, log your meals and weight more often this week to unlock your personalised audit.',
}

// firstName is never sent to the Anthropic API (CLAUDE.md no-PII rule).
// Haiku is instructed to use the literal placeholder {{name}}; substitution happens here.
const generateCoachSummary = async (metrics, verdict, firstName) => {
  try {
    const message = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: 'You are a fitness coaching API. Respond with only a valid raw JSON object. No markdown, no backticks. Start with { and end with }.',
      messages: [{
        role: 'user',
        content: `Verdict: ${verdict}\nMetrics: ${JSON.stringify(metrics)}\n\nWrite a coaching summary: max 3 sentences, warm but direct. Wherever you would use the member's name, write the literal placeholder {{name}} instead. Do not introduce any number not already present in the metrics above. Respond with exactly: {"summary": "..."}`,
      }],
    }, 'fitness_audit_summary')

    let text = message.content[0].text.trim()
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(text)
    if (typeof parsed.summary !== 'string') throw new Error('missing summary key')
    return parsed.summary.replace(/\{\{name\}\}/g, firstName)
  } catch (err) {
    console.error('[fitnessRecalibration] coachSummary parse error:', err.message)
    const fallback = COACH_FALLBACKS[verdict] ?? COACH_FALLBACKS.insufficient_data
    return fallback.replace(/\{\{name\}\}/g, firstName)
  }
}

// Returns the YYYY-MM-DD of the Monday starting the current week in America/Vancouver.
const vanWeekStartStr = (now) => {
  const name = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', weekday: 'short' }).format(now)
  const dow = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[name] ?? 0
  const monday = new Date(now.getTime() - dow * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(monday)
}

// Full per-member pipeline: TDEE recalibration (14-day) then weekly audit (7-day).
const processOneMember = async (member, familyId, now) => {
  const windowStart = new Date(now.getTime() - 14 * 86400000)

  // --- TDEE Recalibration ---
  const nutritionLogs = await prisma.nutritionLog.findMany({
    where: {
      familyId,
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

  const heightCm = heightToCm(member.height) ?? 170
  const { bmr: bmrValue } = macroEngine.bmr({
    weightKg,
    heightCm,
    age: member.age,
    sex: member.gender,
  })
  const fTdee = macroEngine.formulaTdee(bmrValue, member.activityLevel)
  const trendSeries = macroEngine.trendWeights(logsKg)

  let tdeeUpdateData = { tdeeConfidence: 'formula', tdeeUpdatedAt: now }
  let updatedTdeeEstimate = member.tdeeEstimate || null

  if (trendSeries.length >= 4) {
    const trendStartKg = trendSeries[0].trendKg
    const trendEndKg   = trendSeries[trendSeries.length - 1].trendKg
    const adaptive = macroEngine.adaptiveTdee({ dailyIntakes, trendStartKg, trendEndKg, windowDays: 14 })

    if (adaptive !== null && isFinite(adaptive)) {
      const blended = macroEngine.blendTdee({ previous: member.tdeeEstimate || null, fresh: adaptive, formula: fTdee })
      tdeeUpdateData = { tdeeEstimate: blended, tdeeUpdatedAt: now, tdeeConfidence: 'adaptive' }
      updatedTdeeEstimate = blended
    }
  }

  await prisma.member.update({ where: { id: member.id }, data: tdeeUpdateData })
  console.log(`[fitnessRecalibration] ${member.name} (${member.id}): TDEE ${tdeeUpdateData.tdeeConfidence}`)

  // --- Weekly Audit ---
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000)

  const auditLogs = await prisma.nutritionLog.findMany({
    where: {
      familyId,
      memberName: { equals: member.name, mode: 'insensitive' },
      loggedAt: { gte: sevenDaysAgo },
    },
    select: { loggedAt: true, calories: true, protein: true },
  })

  const dailyNutrition = {}
  for (const log of auditLogs) {
    const day = new Date(log.loggedAt).toDateString()
    if (!dailyNutrition[day]) dailyNutrition[day] = { calories: 0, protein: 0 }
    dailyNutrition[day].calories += log.calories || 0
    dailyNutrition[day].protein  += log.protein  || 0
  }

  const loggedDays   = Object.values(dailyNutrition)
  const daysLogged   = loggedDays.length
  const avgIntake    = daysLogged > 0 ? loggedDays.reduce((s, d) => s + d.calories, 0) / daysLogged : 0

  // Build targets using updated TDEE — weightLogs already in asc order from TDEE step
  const memberForTargets = { ...member, tdeeEstimate: updatedTdeeEstimate }
  const targets = buildMemberTargets(memberForTargets, weightLogs)

  const targetCalories = targets?.calories ?? member.dailyCalorieGoal ?? 2000
  const proteinTarget  = targets?.macros?.protein ?? 0
  const effectiveTdee  = updatedTdeeEstimate ?? Math.round(fTdee)

  const proteinHitDays = loggedDays.filter(d => d.protein >= 0.9 * proteinTarget).length
  const velocityKgWk   = macroEngine.weeklyVelocity(trendSeries) ?? 0

  let targetVelocityKgWk = 0
  if (member.fitnessGoal === 'cut' && weightKg && member.goalRatePct) {
    targetVelocityKgWk = -(weightKg * member.goalRatePct)
  } else if (member.fitnessGoal === 'lean_bulk' && weightKg && member.goalRatePct) {
    targetVelocityKgWk = weightKg * member.goalRatePct
  }

  const recentAudits = await prisma.weeklyAudit.findMany({
    where: { memberId: member.id },
    orderBy: { weekStart: 'desc' },
    take: 10,
    select: { verdict: true },
  })
  let priorPlateauWeeks = 0
  for (const a of recentAudits) {
    if (a.verdict === 'plateau') priorPlateauWeeks++
    else break
  }

  const { adherencePct, intakeDeltaPct, verdict } = macroEngine.auditWeek({
    daysLogged,
    avgIntake,
    targetCalories,
    velocityKgWk,
    targetVelocityKgWk,
    proteinHitDays,
    fitnessGoal: member.fitnessGoal,
    priorPlateauWeeks,
  })

  const metrics = {
    daysLogged,
    avgIntake:          Math.round(avgIntake),
    targetCalories,
    proteinHitDays,
    velocityKgWk:       Math.round(velocityKgWk * 100) / 100,
    targetVelocityKgWk: Math.round(targetVelocityKgWk * 100) / 100,
    priorPlateauWeeks,
    adherencePct:       Math.round(adherencePct),
    intakeDeltaPct:     Math.round(intakeDeltaPct),
  }

  if (verdict === 'plateau') {
    metrics.options = {
      dropCalories:      100,
      dietBreakDays:     7,
      dietBreakCalories: Math.round(effectiveTdee),
      extraStepsMinutes: 15,
    }
  }

  const firstName    = member.name.split(' ')[0]
  const coachSummary = await generateCoachSummary(metrics, verdict, firstName)
  const weekStart    = vanWeekStartStr(now)

  const audit = await prisma.weeklyAudit.upsert({
    where:  { memberId_weekStart: { memberId: member.id, weekStart } },
    create: { memberId: member.id, weekStart, metrics, verdict, coachSummary },
    update: { metrics, verdict, coachSummary },
  })

  console.log(`[fitnessRecalibration] ${member.name} audit: ${verdict} (${weekStart})`)
  return audit
}

const runFitnessRecalibration = async () => {
  console.log('[fitnessRecalibration] Starting weekly TDEE recalibration...')

  const flag = await prisma.featureFlag.findUnique({ where: { name: 'fitness_coach' } })
  if (!flag || !flag.enabled) {
    console.log('[fitnessRecalibration] fitness_coach flag disabled — skipping')
    return
  }

  const requiredRank    = PLAN_RANK[flag.requiredPlan] ?? 0
  const qualifyingPlans = Object.keys(PLAN_RANK).filter(p => (PLAN_RANK[p] ?? 0) >= requiredRank)

  const families = await prisma.family.findMany({
    where: { plan: { in: qualifyingPlans } },
    select: { id: true },
  })

  console.log(`[fitnessRecalibration] ${families.length} eligible families`)

  const now = new Date()

  for (const family of families) {
    const members = await prisma.member.findMany({
      where: { familyId: family.id, fitnessGoal: { not: null } },
    })

    for (const member of members) {
      try {
        await processOneMember(member, family.id, now)
      } catch (err) {
        console.error(`[fitnessRecalibration] Failed for member ${member.id}:`, err.message)
      }
    }
  }

  console.log('[fitnessRecalibration] Done.')
}

// Exported for local testing: runs the full pipeline for a single member.
const runFitnessAuditNow = async (memberId) => {
  const member = await prisma.member.findUnique({ where: { id: memberId } })
  if (!member) throw new Error(`Member not found: ${memberId}`)
  if (!member.fitnessGoal) throw new Error(`Member ${memberId} has no fitnessGoal set`)
  return processOneMember(member, member.familyId, new Date())
}

const scheduleFitnessRecalibration = () => {
  cron.schedule('0 6 * * 0', runFitnessRecalibration, { timezone: 'America/Vancouver' })
  console.log('[fitnessRecalibration] Scheduled — Sundays 6am PT')
}

module.exports = { scheduleFitnessRecalibration, runFitnessRecalibration, runFitnessAuditNow }
