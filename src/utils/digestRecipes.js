const Anthropic = require('@anthropic-ai/sdk')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const BASE_URL = process.env.FRONTEND_URL || 'https://nooka.ca'
const FROM_EMAIL = 'Nooka <noreply@nooka.ca>'

const getRecipeSuggestions = async (pantryItems, familyPlan) => {
  if (!pantryItems.length) return []
  try {
    const itemNames = pantryItems.map(i => i.name).join(', ')
    const count = familyPlan === 'premium' ? 3 : 2
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: 'You are a JSON API. Respond ONLY with raw JSON. No markdown, no backticks, no explanation. Start with [ and end with ].',
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

// subtitle defaults to the weekly digest label; pass a custom string for other email types
const buildEmailWrapper = (name, bodyContent, ctaButtons, unsubscribeToken, subtitle = 'Your weekly pantry digest') => {
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
      <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px">${subtitle}</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px">
      <p style="color:#111827;font-size:16px;font-weight:600;margin-top:0">Hi ${name} 👋</p>
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

module.exports = { getRecipeSuggestions, buildEmailWrapper, BASE_URL, FROM_EMAIL }
