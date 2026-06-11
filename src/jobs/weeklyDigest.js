const cron = require('node-cron')
const prisma = require('../utils/prisma')
const { Resend } = require('resend')
const Anthropic = require('@anthropic-ai/sdk')

const resend = new Resend(process.env.RESEND_API_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const BASE_URL = process.env.FRONTEND_URL || 'https://nooka.ca'
const FROM_EMAIL = 'Nooka <noreply@nooka.ca>'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getExpiringItems = async (familyId) => {
  const in7Days = new Date()
  in7Days.setDate(in7Days.getDate() + 7)
  return prisma.pantryItem.findMany({
    where: {
      familyId,
      predictedExpiry: { lte: in7Days, gte: new Date() },
      quantity: { gt: 0 },
    },
    orderBy: { predictedExpiry: 'asc' },
    take: 5,
  })
}

const getPantryCount = async (familyId) => {
  return prisma.pantryItem.count({
    where: { familyId, quantity: { gt: 0 } },
  })
}

const getAdminUser = async (familyId) => {
  return prisma.user.findFirst({
    where: { familyId, isAdmin: true },
    select: { email: true, name: true },
  })
}

// ─── AI recipe suggestions (Family/Premium only) ──────────────────────────────

const getRecipeSuggestions = async (pantryItems, familyPlan) => {
  if (!pantryItems.length) return []
  try {
    const itemNames = pantryItems.map(i => i.name).join(', ')
    const count = familyPlan === 'premium' ? 3 : 2
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Suggest ${count} quick dinner recipes using some of these pantry items: ${itemNames}.
Return ONLY a JSON array like: [{"name":"Recipe Name","time":"20 mins","emoji":"🍝"}]
No other text.`
      }]
    })
    const text = msg.content[0].text.replace(/```json|```/g, '').trim()
    return JSON.parse(text)
  } catch (err) {
    console.error('Recipe suggestion error:', err)
    return []
  }
}

// ─── Email HTML builders ──────────────────────────────────────────────────────

const buildFreeEmail = (name, expiringItems, unsubscribeToken) => {
  const expiryLine = expiringItems.length > 0
    ? `<p style="color:#374151">You have <strong>${expiringItems.length} item${expiringItems.length > 1 ? 's' : ''} expiring</strong> in the next 7 days. Open Nooka to see what to cook before they go to waste.</p>`
    : `<p style="color:#374151">Your pantry looks good this week — nothing expiring soon!</p>`

  return buildEmailWrapper(name, expiryLine, [
    `<a href="${BASE_URL}/login?redirect=/app/pantry" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View my pantry →</a>`
  ], unsubscribeToken)
}

const buildFamilyEmail = (name, expiringItems, recipes, unsubscribeToken) => {
  const expirySection = expiringItems.length > 0
    ? `<p style="color:#374151"><strong>⏰ Expiring soon:</strong> ${expiringItems.map(i => i.name).join(', ')}</p>`
    : `<p style="color:#374151">✅ Nothing expiring this week — great job!</p>`

  const recipeSection = recipes.length > 0
    ? `<p style="color:#374151;font-weight:600;margin-top:16px">🍽️ Recipe ideas for this week:</p>
       <ul style="color:#374151;padding-left:20px">
         ${recipes.map(r => `<li>${r.emoji} <strong>${r.name}</strong> — ${r.time}</li>`).join('')}
       </ul>`
    : ''

  return buildEmailWrapper(name, expirySection + recipeSection, [
    `<a href="${BASE_URL}/login?redirect=/app/recipes" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">See full recipes →</a>`
  ], unsubscribeToken)
}

const buildPremiumEmail = (name, expiringItems, recipes, unsubscribeToken) => {
  const expirySection = expiringItems.length > 0
    ? `<p style="color:#374151"><strong>⏰ Expiring soon:</strong> ${expiringItems.map(i => i.name).join(', ')}</p>`
    : `<p style="color:#374151">✅ Nothing expiring this week — great job!</p>`

  const recipeSection = recipes.length > 0
    ? `<p style="color:#374151;font-weight:600;margin-top:16px">🍽️ Suggested meals this week:</p>
       <ul style="color:#374151;padding-left:20px">
         ${recipes.map(r => `<li>${r.emoji} <strong>${r.name}</strong> — ${r.time}</li>`).join('')}
       </ul>`
    : ''

  const tipSection = `<p style="color:#374151;margin-top:16px">💡 <strong>Tip:</strong> Use your meal planner to schedule these meals and auto-generate your grocery list.</p>`

  return buildEmailWrapper(name, expirySection + recipeSection + tipSection, [
    `<a href="${BASE_URL}/login?redirect=/app/mealplan" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open my meal plan →</a>`
  ], unsubscribeToken)
}

const buildEmailWrapper = (name, bodyContent, ctaButtons, unsubscribeToken) => {
  const unsubscribeUrl = `${BASE_URL}/unsubscribe?token=${unsubscribeToken}`
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">

    <!-- Header -->
    <div style="background:#2563eb;padding:24px 32px">
      <p style="margin:0;color:#fff;font-size:20px;font-weight:700">Nooka</p>
      <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px">Your weekly pantry digest</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px">
      <p style="color:#111827;font-size:16px;font-weight:600;margin-top:0">Hi ${name} 👋</p>
      <p style="color:#6b7280;font-size:13px;margin-top:-8px">Here's your Nooka update for the week.</p>
      ${bodyContent}
      <div style="margin-top:24px">
        ${ctaButtons.join('')}
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center">
      <p style="color:#9ca3af;font-size:11px;margin:0">
        You're receiving this because you have a Nooka account.<br>
        <a href="${unsubscribeUrl}" style="color:#9ca3af">Unsubscribe from digest emails</a>
      </p>
    </div>

  </div>
</body>
</html>`
}

// ─── Main digest sender ───────────────────────────────────────────────────────

const sendWeeklyDigest = async () => {
  console.log('[digest] Starting weekly digest job...')

  const families = await prisma.family.findMany({
    where: { digestEnabled: true },
  })

  console.log(`[digest] Processing ${families.length} families`)

  for (const family of families) {
    try {
      const [admin, pantryCount, expiringItems] = await Promise.all([
        getAdminUser(family.id),
        getPantryCount(family.id),
        getExpiringItems(family.id),
      ])

      if (!admin) continue

      const firstName = admin.name?.split(' ')[0] || 'there'
      const token = family.unsubscribeToken || family.id
      const familyPlan = family.plan?.toLowerCase() || 'free'

      if (pantryCount < 15) {
        if (pantryCount > 0) {
          await resend.emails.send({
            from: FROM_EMAIL,
            to: admin.email,
            subject: `${firstName}, your Nooka pantry is almost ready 🛒`,
            html: buildEmailWrapper(
              firstName,
              `<p style="color:#374151">You've added <strong>${pantryCount} item${pantryCount > 1 ? 's' : ''}</strong> to your pantry — nice start! Add a few more and Nooka will start sending you weekly recipe ideas and expiry alerts.</p>
               <p style="color:#374151">Tip: Add at least <strong>15 items</strong> to get the most out of your digest.</p>`,
              [`<a href="${BASE_URL}/login?redirect=/app/pantry" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Add items to my pantry →</a>`],
              token
            )
          })
        }
        continue
      }

      let html, subject

      if (familyPlan === 'premium') {
        const pantryItems = await prisma.pantryItem.findMany({
          where: { familyId: family.id, quantity: { gt: 0 } },
          take: 20,
        })
        const recipes = await getRecipeSuggestions(pantryItems, familyPlan)
        html = buildPremiumEmail(firstName, expiringItems, recipes, token)
        subject = `Your weekly Nooka digest — ${expiringItems.length > 0 ? `${expiringItems.length} items expiring` : 'all good this week'} 🍽️`

      } else if (familyPlan === 'family') {
        const pantryItems = await prisma.pantryItem.findMany({
          where: { familyId: family.id, quantity: { gt: 0 } },
          take: 20,
        })
        const recipes = await getRecipeSuggestions(pantryItems, familyPlan)
        html = buildFamilyEmail(firstName, expiringItems, recipes, token)
        subject = `Your weekly Nooka digest — ${expiringItems.length > 0 ? `${expiringItems.length} items expiring` : 'all good this week'} 🛒`

      } else {
        html = buildFreeEmail(firstName, expiringItems, token)
        subject = expiringItems.length > 0
          ? `${firstName}, you have ${expiringItems.length} items expiring this week`
          : `Your weekly Nooka pantry update`
      }

      await resend.emails.send({
        from: FROM_EMAIL,
        to: admin.email,
        subject,
        html,
      })

      console.log(`[digest] Sent to ${admin.email} (${familyPlan}) ✓`)

    } catch (err) {
      console.error(`[digest] Failed for family ${family.id}:`, err.message)
    }
  }

  console.log('[digest] Done.')
}

// ─── Schedule: every Sunday at 9am ───────────────────────────────────────────

const scheduleDigest = () => {
  cron.schedule('0 9 * * 0', sendWeeklyDigest, {
    timezone: 'America/Vancouver'
  })
  console.log('[digest] Weekly digest scheduled — Sundays 9am PT')
}

module.exports = { scheduleDigest, sendWeeklyDigest }