require('dotenv').config({ path: '.env.production' })
const prisma = require('../src/utils/prisma')

async function main() {
  const start = new Date(); start.setHours(0,0,0,0)
  const logs = await prisma.nutritionLog.findMany({
    where: { loggedAt: { gte: start } },
    orderBy: { loggedAt: 'desc' },
  })
  for (const l of logs) {
    console.log(l.loggedAt.toISOString(), '|', l.memberName, '| memberId:', l.memberId, '|', l.recipeName, '|', l.calories, 'kcal')
  }
  console.log('total rows today:', logs.length)
  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
