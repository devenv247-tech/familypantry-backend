const ACTIVITY_MULTIPLIERS = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9,
}

// Mifflin-St Jeor. Unknown sex returns the average of both sexes (confidence 'low').
function bmr({ weightKg, heightCm, age, sex }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  if (sex === 'male')   return { bmr: base + 5,   confidence: 'normal' }
  if (sex === 'female') return { bmr: base - 161,  confidence: 'normal' }
  // avg of (base+5) and (base-161) = base - 78
  return { bmr: base - 78, confidence: 'low' }
}

function formulaTdee(bmrValue, activityLevel) {
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] ?? ACTIVITY_MULTIPLIERS.sedentary
  return bmrValue * multiplier
}

// Daily adjustment = weightKg * goalRatePct * 7700 / 7 (subtracted for cut, added for lean_bulk).
// Floor: never below max(bmrValue * 1.05, 1200 female / 1500 male).
// Returns {calories, flooredRatePct} where flooredRatePct is the achievable rate if the floor bit.
function goalCalories({ tdee, weightKg, fitnessGoal, goalRatePct, sex, bmrValue }) {
  const dailyAdj = weightKg * (goalRatePct || 0) * 7700 / 7

  if (fitnessGoal === 'recomp' || fitnessGoal === 'maintain') {
    return { calories: Math.round(tdee), flooredRatePct: goalRatePct || 0 }
  }

  let calories = fitnessGoal === 'cut'
    ? tdee - dailyAdj
    : tdee + dailyAdj // lean_bulk

  const absoluteFloor = sex === 'female' ? 1200 : 1500
  const floor = Math.max(bmrValue * 1.05, absoluteFloor)

  if (calories < floor) {
    const achievableDeficit = tdee - floor
    const flooredRatePct = Math.max(0, achievableDeficit * 7 / (weightKg * 7700))
    return { calories: Math.round(floor), flooredRatePct }
  }

  return { calories: Math.round(calories), flooredRatePct: goalRatePct || 0 }
}

// Protein g/kg by goal; cut uses goalWeightKg as base when provided and lower than weightKg.
// Fat = max(0.7g/kg, 25% of calories). Carbs = remainder, floored at 0. Fiber = 14g/1000kcal.
function macroTargets({ calories, weightKg, goalWeightKg, fitnessGoal }) {
  const proteinRatios = { cut: 2.2, recomp: 2.0, lean_bulk: 1.8, maintain: 1.6 }
  const ratio = proteinRatios[fitnessGoal] ?? 1.6

  const proteinBase = (fitnessGoal === 'cut' && goalWeightKg && goalWeightKg < weightKg)
    ? goalWeightKg
    : weightKg

  const protein = Math.round(proteinBase * ratio)
  const fat     = Math.round(Math.max(0.7 * weightKg, calories * 0.25 / 9))
  const carbs   = Math.round(Math.max(0, (calories - protein * 4 - fat * 9) / 4))
  const fiber   = Math.round(14 * calories / 1000)

  return { protein, fat, carbs, fiber }
}

// EWMA alpha=0.25, seeded at the first entry. Returns a new array with trendKg appended.
function trendWeights(logs) {
  if (!logs || logs.length === 0) return []
  let trend = logs[0].weightKg
  return logs.map(entry => {
    trend = trend + 0.25 * (entry.weightKg - trend)
    return { ...entry, trendKg: trend }
  })
}

// Ordinary least-squares slope over the last-7-day window; returns kg/week or null.
function weeklyVelocity(trendSeries) {
  if (!trendSeries || trendSeries.length === 0) return null
  const latest  = new Date(trendSeries[trendSeries.length - 1].loggedAt)
  const cutoff  = new Date(latest.getTime() - 7 * 86400000)
  const window  = trendSeries.filter(e => new Date(e.loggedAt) >= cutoff)
  if (window.length < 2) return null

  const t0     = new Date(window[0].loggedAt).getTime()
  const points = window.map(e => ({
    x: (new Date(e.loggedAt).getTime() - t0) / 86400000,
    y: e.trendKg,
  }))

  const n     = points.length
  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null

  return ((n * sumXY - sumX * sumY) / denom) * 7 // kg/day → kg/week
}

// Requires ≥10 days logged AND avg intake >800 kcal; otherwise returns null.
// Formula: avg(dailyIntakes) − (trendDelta × 7700 / windowDays).
function adaptiveTdee({ dailyIntakes, trendStartKg, trendEndKg, windowDays }) {
  if (!dailyIntakes || dailyIntakes.length < 10) return null
  const avg = dailyIntakes.reduce((s, v) => s + v, 0) / dailyIntakes.length
  if (avg <= 800) return null
  return avg - ((trendEndKg - trendStartKg) * 7700 / windowDays)
}

// Blends a new adaptive TDEE estimate with prior history.
// First valid window: 50/50 split. Subsequent windows: 25% previous + 75% fresh.
// Clamped to ±25% of formula TDEE to reject outliers.
function blendTdee({ previous, fresh, formula }) {
  const blended = (previous == null)
    ? 0.5 * formula + 0.5 * fresh
    : 0.25 * previous + 0.75 * fresh
  return Math.max(0.75 * formula, Math.min(1.25 * formula, blended))
}

// Deterministic weekly diagnosis. Plateau requires ≥2 prior plateau weeks (3-week rule from spec:
// the caller increments priorPlateauWeeks each time verdict=plateau, so >=2 means week 3).
function auditWeek({ daysLogged, avgIntake, targetCalories, velocityKgWk, targetVelocityKgWk, proteinHitDays, fitnessGoal, priorPlateauWeeks }) {
  const adherencePct   = (daysLogged / 7) * 100
  const intakeDeltaPct = ((avgIntake - targetCalories) / targetCalories) * 100

  let verdict
  if (daysLogged < 4) {
    verdict = 'insufficient_data'
  } else if (
    fitnessGoal === 'cut' &&
    adherencePct >= 80 &&
    Math.abs(velocityKgWk) < 0.1 &&
    priorPlateauWeeks >= 2
  ) {
    verdict = 'plateau'
  } else if (avgIntake > targetCalories * 1.1) {
    verdict = 'over_target'
  } else if (avgIntake < targetCalories * 0.8) {
    verdict = 'under_eating'
  } else {
    verdict = 'on_track'
  }

  return { adherencePct, intakeDeltaPct, verdict }
}

// Under-18 users may only use 'maintain'.
function isEligibleForGoal(age, fitnessGoal) {
  if (age < 18) return fitnessGoal === 'maintain'
  return true
}

module.exports = {
  ACTIVITY_MULTIPLIERS,
  bmr,
  formulaTdee,
  goalCalories,
  macroTargets,
  trendWeights,
  weeklyVelocity,
  adaptiveTdee,
  blendTdee,
  auditWeek,
  isEligibleForGoal,
}
