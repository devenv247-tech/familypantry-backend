// Usage: node scripts/test-activation-email.js <familyId>
// Sends both activation email variants to the family's admin email.
// Bypasses the 40-72h window and activationEmailSentAt guard — does NOT write to the DB.

require('dotenv').config({ path: '.env.production' })

const prisma = require('../src/utils/prisma')
const { Resend } = require('resend')
const { getRecipeSuggestions, buildEmailWrapper, BASE_URL, FROM_EMAIL } = require('../src/utils/digestRecipes')

const resend = new Resend(process.env.RESEND_API_KEY)

// ─── Email builders (mirrors activationEmail.js — not exported from there) ───

const buildPantryReadyEmail = (name, recipes, unsubscribeToken) => {
  const recipeList = recipes.length > 0
    ? recipes.map(r => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6">
          <span style="font-size:24px;min-width:36px;text-align:center">${r.emoji}</span>
          <div>
            <p style="margin:0;color:#111827;font-weight:600;font-size:14px">${r.name}</p>
            <p style="margin:2px 0 0;color:#6b7280;font-size:12px">${r.time}</p>
          </div>
        </div>`).join('')
    : `<p style="color:#6b7280;font-size:14px">Open Nooka to see recipe ideas based on your pantry.</p>`

  const body = `
    <p style="color:#374151;font-size:14px;margin-top:0">
      Great start — your pantry is taking shape. Based on what you've added,
      here are a couple of dinners you can make <strong>tonight</strong>:
    </p>
    <div style="margin:16px 0;border-top:1px solid #f3f4f6">
      ${recipeList}
    </div>
    <p style="color:#6b7280;font-size:13px;margin-top:16px">
      Nooka will keep suggesting meals as your pantry grows and alert you before
      anything expires — so nothing goes to waste.
    </p>`

  return buildEmailWrapper(
    name,
    body,
    [`<a href="${BASE_URL}/login?redirect=/app/recipes" style="display:block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;text-align:center">See all my recipes →</a>`],
    unsubscribeToken,
    'Meal ideas from your pantry'
  )
}

const buildEmptyPantryEmail = (name, unsubscribeToken) => {
  const body = `
    <p style="color:#374151;font-size:14px;margin-top:0">
      You signed up for Nooka — but your pantry is still empty, so we haven't been
      able to suggest any meals yet.
    </p>
    <p style="color:#374151;font-size:14px">
      It takes <strong>under 2 minutes</strong> to get started. Here's the fastest way:
    </p>
    <div style="background:#f0f4ff;border-radius:8px;padding:16px 20px;margin:16px 0">
      <p style="margin:0 0 8px;color:#1e3a8a;font-weight:600;font-size:14px">Use a starter template</p>
      <p style="margin:0;color:#374151;font-size:13px;line-height:1.6">
        Tap <strong>Add items</strong> in your pantry, then choose a starter template
        (Fridge Basics, Dry Goods, etc.) to add common items in one tap — no scanning needed.
      </p>
    </div>
    <p style="color:#6b7280;font-size:13px">
      Once you've added a few items, Nooka will suggest meals, track expiry dates,
      and help you cut down on food waste.
    </p>`

  return buildEmailWrapper(
    name,
    body,
    [`<a href="${BASE_URL}/login?redirect=/app/pantry" style="display:block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;text-align:center">Set up my pantry →</a>`],
    unsubscribeToken,
    'Meal planning & pantry for Canadian families'
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const familyId = process.argv[2]
  if (!familyId) {
    console.error('Usage: node scripts/test-activation-email.js <familyId>')
    process.exit(1)
  }

  const family = await prisma.family.findUnique({ where: { id: familyId } })
  if (!family) {
    console.error(`Family not found: ${familyId}`)
    process.exit(1)
  }

  const admin = await prisma.user.findFirst({
    where: { familyId },
    orderBy: { createdAt: 'asc' },
    select: { email: true, name: true },
  })
  if (!admin) {
    console.error('No admin user found for this family')
    process.exit(1)
  }

  const firstName = admin.name?.split(' ')[0] || 'there'
  const token = family.unsubscribeToken || family.id

  const realItems = await prisma.pantryItem.findMany({
    where: { familyId, quantity: { gt: 0 } },
    take: 20,
  })

  // If pantry is empty use mock items so the AI still returns recipe suggestions
  const itemsForRecipes = realItems.length > 0
    ? realItems
    : [
        { name: 'chicken breast' },
        { name: 'pasta' },
        { name: 'olive oil' },
        { name: 'garlic' },
        { name: 'tomatoes' },
      ]

  console.log(`\nFamily : ${family.name} (${familyId})`)
  console.log(`To     : ${admin.email}`)
  console.log(`Pantry : ${realItems.length} real item(s)${realItems.length === 0 ? ' — using mock items for AI recipe suggestions' : ''}`)

  // ── Variant 1: pantry-ready ───────────────────────────────────────────────
  console.log('\n[1/2] Sending pantry-ready variant...')
  const recipes = await getRecipeSuggestions(itemsForRecipes, 'family')
  await resend.emails.send({
    from: FROM_EMAIL,
    to: admin.email,
    subject: `[TEST] ${firstName}, here's what you can cook tonight 🍽️`,
    html: buildPantryReadyEmail(firstName, recipes, token),
  })
  console.log('✓ Pantry-ready email sent')

  // ── Variant 2: empty-pantry ───────────────────────────────────────────────
  console.log('\n[2/2] Sending empty-pantry variant...')
  await resend.emails.send({
    from: FROM_EMAIL,
    to: admin.email,
    subject: `[TEST] ${firstName}, set up your pantry in 2 minutes 🥗`,
    html: buildEmptyPantryEmail(firstName, token),
  })
  console.log('✓ Empty-pantry email sent')

  console.log('\nDone — both variants sent. activationEmailSentAt was NOT updated.')
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  prisma.$disconnect()
  process.exit(1)
})
