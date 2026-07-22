#!/usr/bin/env node
'use strict'

const { heightToCm, toKg } = require('../src/services/units')

let passed = 0
let failed = 0

const approx = (a, b, tol = 0.01) => Math.abs(a - b) <= tol

const assert = (label, actual, expected) => {
  const ok = expected === null ? actual === null : typeof expected === 'number' ? approx(actual, expected) : actual === expected
  if (ok) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}  →  expected ${expected}, got ${actual}`)
    failed++
  }
}

console.log('\nheightToCm')
assert('5\'4"  (feet+inches, trailing quote)', heightToCm('5\'4"'), 162.56)
assert("5'4   (feet+inches, no quote)",       heightToCm("5'4"),   162.56)
assert('64    (bare ≤96 = total inches)',      heightToCm('64'),    162.56)
assert('163cm (explicit cm label)',            heightToCm('163cm'), 163)
assert('163   (bare >96 = cm already)',        heightToCm('163'),   163)
assert("6'2\"  (feet+inches, larger)",         heightToCm('6\'2"'), 187.96)
assert('72    (bare ≤96 = 72 total inches)',   heightToCm('72'),    182.88)
assert('null  (missing → null)',               heightToCm(null),    null)
assert("6'    (feet only, no inches)",         heightToCm("6'"),    182.88)
assert("5'    (feet only, no inches)",         heightToCm("5'"),    152.4)

console.log('\ntoKg')
assert('70 kg passthrough',    toKg(70, 'kg'),   70)
assert('154 lbs → ~69.85 kg', toKg(154, 'lbs'), 69.85)
assert('null weight → null',  toKg(null, 'kg'), null)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
