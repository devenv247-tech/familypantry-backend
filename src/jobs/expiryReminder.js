const cron = require('node-cron')
const prisma = require('../utils/prisma')
const { Resend } = require('resend')
const { buildEmailWrapper, BASE_URL, FROM_EMAIL } = require('../utils/digestRecipes')

const resend = new Resend(process.env.RESEND_API_KEY)

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Checks both expiry (manual string) and predictedExpiry (DateTime) — same dual-field
// pattern as expiryController.js, unlike weeklyDigest.js which only checks predictedExpiry.
const getExpiringIn2Days = async (familyId) => {
  const now = new Date()
  const items = await prisma.pantryItem.findMany({
    where: { familyId, quantity: { gt: 0 } },
  })
  return items
    .map(item => {
      const expiryDate = item.expiry
        ? new Date(item.expiry)
        : item.predictedExpiry
          ? new Date(item.predictedExpiry)
          : null
      if (!expiryDate) return null
      const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
      if (daysLeft < 0 || daysLeft > 2) return null
      return { ...item, daysLeft }
    })
    .filter(Boolean)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

// ─── Email builder ────────────────────────────────────────────────────────────

const buildExpiryReminderEmail = (name, items, unsubscribeToken) => {
  const itemList = items.slice(0, 5).map(item => {
    const label = item.daysLeft === 0 ? 'today' : item.daysLeft === 1 ? 'tomorrow' : '2 days'
    return `<li style="padding:6px 0;color:#374151">${item.name} <span style="color:#dc2626;font-weight:600">(${label})</span></li>`
  }).join('')

  const body = `
    <p style="color:#374151;font-size:14px;margin-top:0">
      You have <strong>${items.length} item${items.length !== 1 ? 's' : ''} expiring in the next 2 days</strong> — here's what to use up:
    </p>
    <ul style="padding-left:20px;margin:16px 0;line-height:1.8">
      ${itemList}
    </ul>
    <p style="color:#6b7280;font-size:13px">
      Open Nooka to see recipe ideas that use these items before they go to waste.
    </p>`

  return buildEmailWrapper(
    name,
    body,
    [`<a href="${BASE_URL}/login?redirect=/app/recipes?expiring=true" style="display:block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;text-align:center">See recipes for expiring items →</a>`],
    unsubscribeToken,
    'Expiry reminder'
  )
}

// ─── Push sender ─────────────────────────────────────────────────────────────

const sendExpiryPush = async (familyId, items) => {
  const tokens = await prisma.pushToken.findMany({
    where: { user: { familyId } },
    select: { token: true },
  })
  if (tokens.length === 0) return

  const first = items[0]
  const label = first.daysLeft === 0 ? 'today' : first.daysLeft === 1 ? 'tomorrow' : 'in 2 days'
  const body = items.length === 1
    ? `${first.name} expires ${label}.`
    : `${first.name} and ${items.length - 1} other item${items.length - 1 !== 1 ? 's' : ''} expiring ${label}.`

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify({
      to: tokens.map(t => t.token),
      title: 'Items expiring soon',
      body,
      data: { screen: 'Pantry' },
      sound: 'default',
    }),
  })

  const result = await response.json()
  const tickets = Array.isArray(result.data) ? result.data : [result.data]
  const errors = tickets.filter(t => t?.status === 'error')
  if (errors.length > 0) {
    console.error(`[expiry-reminder] Push errors for family ${familyId}:`, errors)
  }
}

// ─── Main sender ──────────────────────────────────────────────────────────────

const sendExpiryReminders = async () => {
  console.log('[expiry-reminder] Starting...')

  const families = await prisma.family.findMany({
    where: { notifyExpiry: true, digestEnabled: true },
  })

  console.log(`[expiry-reminder] Processing ${families.length} families`)

  const now = new Date()
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  for (const family of families) {
    try {
      if (family.expiryEmailSentAt && new Date(family.expiryEmailSentAt) > cutoff48h) continue

      const expiringItems = await getExpiringIn2Days(family.id)
      if (expiringItems.length === 0) continue

      const admin = await prisma.user.findFirst({
        where: { familyId: family.id },
        orderBy: { createdAt: 'asc' },
        select: { email: true, name: true },
      })
      if (!admin) continue

      const firstName = admin.name?.split(' ')[0] || 'there'
      const token = family.unsubscribeToken || family.id

      const itemSummary = expiringItems.slice(0, 3).map(i => {
        const label = i.daysLeft === 0 ? 'today' : i.daysLeft === 1 ? 'tomorrow' : '2 days'
        return `${i.name} (${label})`
      }).join(', ')

      await resend.emails.send({
        from: FROM_EMAIL,
        to: admin.email,
        subject: `${firstName}, ${expiringItems.length} item${expiringItems.length !== 1 ? 's' : ''} expiring soon: ${itemSummary}`,
        html: buildExpiryReminderEmail(firstName, expiringItems, token),
      })

      await sendExpiryPush(family.id, expiringItems)

      await prisma.family.update({
        where: { id: family.id },
        data: { expiryEmailSentAt: now },
      })

      console.log(`[expiry-reminder] Sent to ${admin.email} (${expiringItems.length} items) ✓`)
    } catch (err) {
      console.error(`[expiry-reminder] Failed for family ${family.id}:`, err.message)
    }
  }

  console.log('[expiry-reminder] Done.')
}

// ─── Schedule: daily at 9am PT ────────────────────────────────────────────────

const scheduleExpiryReminder = () => {
  cron.schedule('0 9 * * *', sendExpiryReminders, {
    timezone: 'America/Vancouver'
  })
  console.log('[expiry-reminder] Expiry reminder scheduled — daily 9am PT')
}

module.exports = { scheduleExpiryReminder, sendExpiryReminders }
