require('dotenv').config({ path: require('path').join(__dirname, '../.env.development') })
const prisma = require('../src/utils/prisma')

async function main() {
  const existing = await prisma.featureFlag.findFirst({
    where: { name: 'voice_input' }
  })

  if (existing) {
    console.log('Flag already exists:', existing)
    return
  }

  const flag = await prisma.featureFlag.create({
    data: {
      name: 'voice_input',
      description: '🎙️ Voice add for pantry and grocery',
      enabled: true,
      requiredPlan: 'premium',
    }
  })

  console.log('✅ Created flag:', flag)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())