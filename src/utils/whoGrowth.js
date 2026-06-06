// WHO Child Growth Standards — weight-for-age and height-for-age
// Source: WHO Multicentre Growth Reference Study
// Values represent median (M) and SD for boys and girls at each month

const WHO_WEIGHT = {
  girl: {
    0:{M:3.2,SD:0.39}, 1:{M:4.2,SD:0.48}, 2:{M:5.1,SD:0.57},
    3:{M:5.8,SD:0.63}, 4:{M:6.4,SD:0.68}, 5:{M:6.9,SD:0.73},
    6:{M:7.3,SD:0.77}, 7:{M:7.6,SD:0.80}, 8:{M:7.9,SD:0.83},
    9:{M:8.2,SD:0.86}, 10:{M:8.5,SD:0.89}, 11:{M:8.7,SD:0.91},
    12:{M:8.9,SD:0.93}, 15:{M:9.6,SD:0.99}, 18:{M:10.2,SD:1.05},
    21:{M:10.9,SD:1.11}, 24:{M:11.5,SD:1.16}, 30:{M:12.7,SD:1.26},
    36:{M:13.9,SD:1.36},
  },
  boy: {
    0:{M:3.3,SD:0.43}, 1:{M:4.5,SD:0.52}, 2:{M:5.6,SD:0.61},
    3:{M:6.4,SD:0.68}, 4:{M:7.0,SD:0.74}, 5:{M:7.5,SD:0.79},
    6:{M:7.9,SD:0.83}, 7:{M:8.3,SD:0.87}, 8:{M:8.6,SD:0.90},
    9:{M:8.9,SD:0.93}, 10:{M:9.2,SD:0.96}, 11:{M:9.4,SD:0.98},
    12:{M:9.6,SD:1.00}, 15:{M:10.3,SD:1.06}, 18:{M:11.0,SD:1.13},
    21:{M:11.6,SD:1.18}, 24:{M:12.2,SD:1.24}, 30:{M:13.3,SD:1.34},
    36:{M:14.3,SD:1.43},
  }
}

const WHO_HEIGHT = {
  girl: {
    0:{M:49.1,SD:1.86}, 1:{M:53.7,SD:1.96}, 2:{M:57.1,SD:2.04},
    3:{M:59.8,SD:2.09}, 4:{M:62.1,SD:2.13}, 5:{M:64.0,SD:2.16},
    6:{M:65.7,SD:2.19}, 7:{M:67.3,SD:2.22}, 8:{M:68.7,SD:2.24},
    9:{M:70.1,SD:2.26}, 10:{M:71.5,SD:2.28}, 11:{M:72.8,SD:2.30},
    12:{M:74.0,SD:2.32}, 15:{M:77.5,SD:2.38}, 18:{M:80.7,SD:2.44},
    21:{M:83.7,SD:2.50}, 24:{M:86.4,SD:2.55}, 30:{M:91.4,SD:2.65},
    36:{M:95.7,SD:2.75},
  },
  boy: {
    0:{M:49.9,SD:1.89}, 1:{M:54.7,SD:1.99}, 2:{M:58.4,SD:2.07},
    3:{M:61.4,SD:2.13}, 4:{M:63.9,SD:2.17}, 5:{M:65.9,SD:2.21},
    6:{M:67.6,SD:2.24}, 7:{M:69.2,SD:2.27}, 8:{M:70.6,SD:2.29},
    9:{M:72.0,SD:2.32}, 10:{M:73.3,SD:2.34}, 11:{M:74.5,SD:2.36},
    12:{M:75.7,SD:2.38}, 15:{M:79.1,SD:2.44}, 18:{M:82.3,SD:2.50},
    21:{M:85.1,SD:2.55}, 24:{M:87.8,SD:2.60}, 30:{M:92.7,SD:2.69},
    36:{M:96.1,SD:2.78},
  }
}

// Find nearest month bracket in WHO table
const getNearestMonth = (table, months) => {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b)
  let nearest = keys[0]
  for (const k of keys) {
    if (k <= months) nearest = k
    else break
  }
  return table[nearest]
}

// Convert z-score to percentile approximation
const zToPercentile = (z) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp(-z * z / 2)
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))))
  if (z > 0) p = 1 - p
  return Math.round(p * 100)
}

const getVerdict = (weightP, heightP) => {
  const avg = (weightP + heightP) / 2
  if (avg >= 85) return { verdict: 'Above average growth', color: 'blue', emoji: '🌟' }
  if (avg >= 15) return { verdict: 'Healthy growth — on track', color: 'green', emoji: '✅' }
  if (avg >= 5)  return { verdict: 'Slightly below average — monitor at next visit', color: 'yellow', emoji: '⚠️' }
  return { verdict: 'Below expected range — consult your pediatrician', color: 'red', emoji: '🚨' }
}

// gender: 'boy' | 'girl' | null (defaults to neutral average)
exports.assessGrowth = (months, weightKg, heightCm, gender) => {
  if (months === null || months < 0 || months > 36) return null

  const g = gender === 'girl' ? 'girl' : 'boy' // default to boy if unknown
  const wRef = getNearestMonth(WHO_WEIGHT[g], months)
  const hRef = getNearestMonth(WHO_HEIGHT[g], months)

  const wZ = (weightKg - wRef.M) / wRef.SD
  const hZ = (heightCm - hRef.M) / hRef.SD

  const weightPercentile = zToPercentile(wZ)
  const heightPercentile = zToPercentile(hZ)

  const { verdict, color, emoji } = getVerdict(weightPercentile, heightPercentile)

  return {
    weightPercentile,
    heightPercentile,
    weightMedian: wRef.M,
    heightMedian: hRef.M,
    verdict,
    color,
    emoji,
  }
}

// Well-baby visit schedule (Health Canada)
exports.WELL_BABY_MONTHS = [1, 2, 4, 6, 9, 12, 15, 18, 24, 30, 36]

exports.getNextMeasurementDue = (months) => {
  const schedule = [1, 2, 4, 6, 9, 12, 15, 18, 24, 30, 36]
  const next = schedule.find(m => m > months)
  return next || null
}