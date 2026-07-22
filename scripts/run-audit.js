// Usage: node scripts/run-audit.js <memberId>
// Runs the full TDEE recalibration + weekly audit for the given member and prints the result.
// Uses .env.production — the same way our other debug scripts do.
require('dotenv').config({ path: '.env.production' })

const { runFitnessAuditNow } = require('../src/jobs/fitnessRecalibration')

const memberId = process.argv[2]
if (!memberId) {
  console.error('Usage: node scripts/run-audit.js <memberId>')
  process.exit(1)
}

runFitnessAuditNow(memberId)
  .then(audit => {
    console.log(JSON.stringify(audit, null, 2))
    process.exit(0)
  })
  .catch(err => {
    console.error('Error:', err.message)
    process.exit(1)
  })
