const cron = require('node-cron')
const prisma = require('../utils/prisma')
const { Resend } = require('resend')
const { getRecipeSuggestions, buildEmailWrapper, BASE_URL, FROM_EMAIL } = require('../utils/digestRecipes')

const resend = new Resend(process.env.RESEND_API_KEY)

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
    where: { familyId },
    orderBy: { createdAt: 'asc' },
    select: { email: true, name: true },
  })
}

// ─── Nutrition insights (Premium only) ───────────────────────────────────────

const getNutritionInsights = async (familyId) => {
  try {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const logs = await prisma.nutritionLog.findMany({
      where: { familyId, loggedAt: { gte: sevenDaysAgo } },
      orderBy: { loggedAt: 'desc' },
    })

    if (logs.length === 0) return null

    // Group by member
    const byMember = {}
    for (const log of logs) {
      const name = log.memberName || 'Family'
      if (!byMember[name]) byMember[name] = []
      byMember[name].push(log)
    }

    // Per member stats
    const memberStats = Object.entries(byMember).map(([name, memberLogs]) => {
      const days = [...new Set(memberLogs.map(l => new Date(l.loggedAt).toDateString()))].length
      const avgCalories = Math.round(memberLogs.reduce((s, l) => s + (l.calories || 0), 0) / Math.max(days, 1))
      const avgProtein = Math.round(memberLogs.reduce((s, l) => s + (l.protein || 0), 0) / Math.max(days, 1))
      const topMeal = memberLogs.reduce((top, l) => {
        const count = memberLogs.filter(x => x.recipeName === l.recipeName).length
        return count > (top.count || 0) ? { name: l.recipeName, count } : top
      }, {})

      return { name, days, avgCalories, avgProtein, topMeal: topMeal.name || null }
    })

    return { memberStats, totalLogs: logs.length }
  } catch (err) {
    console.error('getNutritionInsights error:', err)
    return null
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

const buildPremiumEmail = (name, expiringItems, recipes, nutritionInsights, unsubscribeToken) => {
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

  // Nutrition insights section — only if data exists
  let nutritionSection = ''
  if (nutritionInsights?.memberStats?.length > 0) {
    const rows = nutritionInsights.memberStats.map(m => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827">${m.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:center">${m.avgCalories} kcal</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:center">${m.avgProtein}g</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px">${m.topMeal ? m.topMeal : '—'}</td>
      </tr>`).join('')

    nutritionSection = `
      <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:20px">
        <p style="color:#111827;font-weight:600;margin:0 0 12px">📊 This week's nutrition snapshot</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Member</th>
              <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Avg cal/day</th>
              <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Avg protein</th>
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Top meal</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#6b7280;font-size:12px;margin-top:10px">
          Based on ${nutritionInsights.totalLogs} meals logged this week.
          <a href="${BASE_URL}/login?redirect=/app/health" style="color:#2563eb">View full health tracker →</a>
        </p>
      </div>`
  } else {
    nutritionSection = `
      <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:20px">
        <p style="color:#111827;font-weight:600;margin:0 0 8px">📊 Nutrition tracking</p>
        <p style="color:#6b7280;font-size:13px;margin:0">No meals logged this week yet. Start logging meals in the Health tracker to see your weekly nutrition summary here.</p>
        <a href="${BASE_URL}/login?redirect=/app/health" style="display:inline-block;margin-top:10px;color:#2563eb;font-size:13px">Start tracking →</a>
      </div>`
  }

  return buildEmailWrapper(name, expirySection + recipeSection + tipSection + nutritionSection, [
    `<a href="${BASE_URL}/login?redirect=/app/mealplan" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-right:8px">Open meal plan →</a>`,
    `<a href="${BASE_URL}/login?redirect=/app/health" style="display:inline-block;background:#f3f4f6;color:#374151;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Health tracker →</a>`,
  ], unsubscribeToken)
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

      if (pantryCount === 0) {
        // Re-engagement email — send once, then once a month max
        const now = new Date()
        const lastSent = family.reengagementSentAt
        const shouldSend = !lastSent || (now - new Date(lastSent)) > 30 * 24 * 60 * 60 * 1000

        if (shouldSend) {
          await resend.emails.send({
            from: FROM_EMAIL,
            to: admin.email,
            subject: `${firstName}, you could be saving money on groceries 🛒`,
            html: buildEmailWrapper(
              firstName,
              `<p style="color:#374151">Your Nooka pantry is empty — and you're missing out on some real benefits:</p>
               <ul style="color:#374151;padding-left:20px;line-height:1.8">
                 <li>🥗 <strong>Healthier meals</strong> — get recipe ideas tailored to your family's dietary needs</li>
                 <li>💰 <strong>Less food waste</strong> — Canadians throw away an average of <strong>$1,300 of food per year</strong>. Nooka helps you use what you have.</li>
                 <li>🛒 <strong>Smarter grocery trips</strong> — auto-generated lists so you never over-buy</li>
                 <li>⏰ <strong>Expiry alerts</strong> — get notified before food goes bad</li>
               </ul>
               <p style="color:#374151;margin-top:16px">It takes less than 2 minutes to add your first 5 items and unlock your first recipe suggestions.</p>`,
              [`<a href="${BASE_URL}/login?redirect=/app/pantry" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Set up my pantry →</a>`],
              token
            )
          })

          await prisma.family.update({
            where: { id: family.id },
            data: { reengagementSentAt: now }
          })
        }
        continue
      }

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
        const [recipes, nutritionInsights] = await Promise.all([
          getRecipeSuggestions(pantryItems, familyPlan),
          getNutritionInsights(family.id),
        ])
        html = buildPremiumEmail(firstName, expiringItems, recipes, nutritionInsights, token)
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