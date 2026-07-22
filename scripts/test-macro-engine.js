'use strict'
const { bmr, formulaTdee, goalCalories, macroTargets, adaptiveTdee, auditWeek } = require('../src/services/macroEngine')

let pass = 0
let fail = 0

function assert(condition, label) {
  if (condition) {
    console.log(`PASS  ${label}`)
    pass++
  } else {
    console.log(`FAIL  ${label}`)
    fail++
  }
}

// ── (a) 80 kg male, 180 cm, 30 y, moderate activity, cut at 0.5%/wk ─────────
// BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780
// TDEE = 1780 * 1.55 = 2759
// dailyAdj = 80 * 0.005 * 7700 / 7 = 440
// target calories = 2759 - 440 = 2319  (spec says "near 2280", ±100 accepted)
// protein = round(80 * 2.2) = 176 g
{
  const { bmr: bmrVal } = bmr({ weightKg: 80, heightCm: 180, age: 30, sex: 'male' })
  const tdee = formulaTdee(bmrVal, 'moderate')
  const { calories } = goalCalories({ tdee, weightKg: 80, fitnessGoal: 'cut', goalRatePct: 0.005, sex: 'male', bmrValue: bmrVal })
  const macros = macroTargets({ calories, weightKg: 80, fitnessGoal: 'cut' })
  assert(Math.abs(calories - 2280) < 100, `(a) calories near 2280 — got ${calories}`)
  assert(macros.protein === 176,           `(a) protein = 176 g — got ${macros.protein}`)
}

// ── (b) light female on aggressive cut hits the floor ────────────────────────
// 50 kg female, 155 cm, 25 y, sedentary
// BMR = 10*50 + 6.25*155 - 5*25 - 161 = 500 + 968.75 - 125 - 161 = 1182.75
// TDEE sedentary = 1182.75 * 1.2 ≈ 1419.3
// dailyAdj at 1%/wk = 50 * 0.01 * 7700/7 = 550  →  proposed = 1419.3 - 550 = 869 < floor
// floor = max(1182.75 * 1.05, 1200) = max(1241.9, 1200) = 1241.9 → floor bites
{
  const { bmr: bmrFemale } = bmr({ weightKg: 50, heightCm: 155, age: 25, sex: 'female' })
  const tdeeFemale = formulaTdee(bmrFemale, 'sedentary')
  const { calories: calF, flooredRatePct } = goalCalories({
    tdee: tdeeFemale,
    weightKg: 50,
    fitnessGoal: 'cut',
    goalRatePct: 0.01,
    sex: 'female',
    bmrValue: bmrFemale,
  })
  assert(flooredRatePct < 0.01, `(b) flooredRatePct (${flooredRatePct.toFixed(4)}) < goalRatePct 0.01`)
  assert(calF >= 1200,          `(b) floored calories (${calF}) at/above 1200 female floor`)
}

// ── (c) adaptiveTdee with 14 intakes of 2200, trend −0.9 kg over 14 days ≈ 2695
// 2200 - (-0.9 * 7700 / 14) = 2200 + 495 = 2695
{
  const intake14 = Array(14).fill(2200)
  const result = adaptiveTdee({ dailyIntakes: intake14, trendStartKg: 80, trendEndKg: 79.1, windowDays: 14 })
  assert(result !== null && Math.abs(result - 2695) < 5, `(c) adaptiveTdee ≈ 2695 — got ${result}`)
}

// ── (d) adaptiveTdee returns null with only 8 logged days ────────────────────
{
  const result = adaptiveTdee({ dailyIntakes: Array(8).fill(2200), trendStartKg: 80, trendEndKg: 79.5, windowDays: 14 })
  assert(result === null, `(d) adaptiveTdee null for 8-day log — got ${result}`)
}

// ── (e) auditWeek: plateau verdict and insufficient_data ─────────────────────
{
  // Plateau: cut + adherence ≥ 80% (6/7 = 85.7%) + |velocity| < 0.1 + priorPlateauWeeks = 2
  const plateau = auditWeek({
    daysLogged: 6,
    avgIntake: 2300,
    targetCalories: 2280,
    velocityKgWk: 0.04,
    targetVelocityKgWk: -0.4,
    proteinHitDays: 5,
    fitnessGoal: 'cut',
    priorPlateauWeeks: 2,
  })
  assert(plateau.verdict === 'plateau', `(e) plateau verdict — got ${plateau.verdict}`)

  // Insufficient data: 3 days logged
  const insufficient = auditWeek({
    daysLogged: 3,
    avgIntake: 2200,
    targetCalories: 2280,
    velocityKgWk: -0.3,
    targetVelocityKgWk: -0.4,
    proteinHitDays: 2,
    fitnessGoal: 'cut',
    priorPlateauWeeks: 0,
  })
  assert(insufficient.verdict === 'insufficient_data', `(e) insufficient_data for 3 days — got ${insufficient.verdict}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
