require('dotenv').config({ path: '.env.production' })
const prisma = require('../src/utils/prisma')

async function main() {
  const rows = await prisma.mealPlan.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
  })
  for (const r of rows) {
    console.log('---')
    console.log('created:', r.createdAt, '| day:', r.day, r.mealType)
    console.log('recipe:', r.recipeName)
    console.log('plannedFor:', JSON.stringify(r.recipeData?.plannedFor ?? null))
  }
  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
