// Usage: node scripts/test-expiry-email.js <familyId> [--push]
// Sends the expiry reminder email to the family's admin, and optionally a push
// notification to all registered devices for that family (--push flag).
// Bypasses the 48h expiryEmailSentAt guard and does NOT write to the DB.
// If no items expire in 2 days, uses the 3 soonest-expiring pantry items as a preview.

require('dotenv').config({ path: '.env.production' })

const prisma = require('../src/utils/prisma')
const { Resend } = require('resend')
const { buildEmailWrapper, BASE_URL, FROM_EMAIL } = require('../src/utils/digestRecipes')

const resend = new Resend(process.env.RESEND_API_KEY)

const buildExpiryReminderEmail = (name, items, unsubscribeToken) => {
  const itemList = items.slice(0, 5).map(item => {
    const label = item.daysLeft === 0 ? 'today' : item.daysLeft === 1 ? 'tomorrow' : item.daysLeft <= 2 ? '2 days' : `${item.daysLeft} days`
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

async function main() {
  const familyId = process.argv[2]
  const sendPush = process.argv.includes('--push')

  if (!familyId) {
    console.error('Usage: node scripts/test-expiry-email.js <familyId> [--push]')
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
  const now = new Date()

  const allItems = await prisma.pantryItem.findMany({
    where: { familyId, quantity: { gt: 0 } },
  })

  // Real expiring items (within 2 days)
  let expiringItems = allItems
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

  let usingFallback = false
  if (expiringItems.length === 0) {
    // Fallback: use the 3 soonest-expiring items regardless of window, for preview
    const withExpiry = allItems
      .map(item => {
        const expiryDate = item.expiry
          ? new Date(item.expiry)
          : item.predictedExpiry
            ? new Date(item.predictedExpiry)
            : null
        if (!expiryDate) return null
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
        if (daysLeft < 0) return null  // match real job — don't show already-expired items
        return { ...item, daysLeft }
      })
      .filter(Boolean)
      .sort((a, b) => a.daysLeft - b.daysLeft)

    expiringItems = withExpiry.slice(0, 3)
    usingFallback = true
  }

  console.log(`\nFamily : ${family.name} (${familyId})`)
  console.log(`To     : ${admin.email}`)
  console.log(`Items  : ${expiringItems.length}${usingFallback ? ' (fallback — no real 2-day expiries; showing soonest items for preview)' : ' expiring within 2 days'}`)
  if (expiringItems.length > 0) {
    expiringItems.forEach(i => console.log(`         · ${i.name} (${i.daysLeft}d)`))
  }

  if (expiringItems.length === 0) {
    console.log('\nNo pantry items with expiry dates found — nothing to send.')
    await prisma.$disconnect()
    return
  }

  console.log(`\nSending email${sendPush ? ' + push' : ''}...`)
  const itemSummary = expiringItems.slice(0, 3).map(i => {
    const label = i.daysLeft === 0 ? 'today' : i.daysLeft === 1 ? 'tomorrow' : `${i.daysLeft} days`
    return `${i.name} (${label})`
  }).join(', ')

  await resend.emails.send({
    from: FROM_EMAIL,
    to: admin.email,
    subject: `[TEST] ${firstName}, ${expiringItems.length} item${expiringItems.length !== 1 ? 's' : ''} expiring soon: ${itemSummary}`,
    html: buildExpiryReminderEmail(firstName, expiringItems, token),
  })

  console.log('✓ Email sent. expiryEmailSentAt was NOT updated.')

  if (sendPush) {
    const tokens = await prisma.pushToken.findMany({
      where: { user: { familyId } },
      select: { token: true },
    })

    if (tokens.length === 0) {
      console.log('  Push: no registered tokens found for this family.')
    } else {
      console.log(`  Push: sending to ${tokens.length} device${tokens.length !== 1 ? 's' : ''}...`)

      const first = expiringItems[0]
      const label = first.daysLeft === 0 ? 'today' : first.daysLeft === 1 ? 'tomorrow' : 'in 2 days'
      const body = expiringItems.length === 1
        ? `${first.name} expires ${label}.`
        : `${first.name} and ${expiringItems.length - 1} other item${expiringItems.length - 1 !== 1 ? 's' : ''} expiring ${label}.`

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify({
          to: tokens.map(t => t.token),
          title: '[TEST] Items expiring soon',
          body,
          data: { screen: 'Pantry' },
          sound: 'default',
        }),
      })

      const result = await response.json()
      console.log('  Push tickets:', JSON.stringify(result.data, null, 2))
    }
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  prisma.$disconnect()
  process.exit(1)
})
