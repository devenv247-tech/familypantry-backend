const prisma = require('./prisma')

// Track every Claude API call — tokens used, cost, endpoint
const trackApiUsage = async (endpoint, inputTokens, outputTokens) => {
  try {
    // Cost per million tokens (Claude Sonnet 4)
    const inputCostPer1M = 3.00
    const outputCostPer1M = 15.00
    const cost = ((inputTokens / 1_000_000) * inputCostPer1M) + ((outputTokens / 1_000_000) * outputCostPer1M)

    // Store in FeatureFlag description as a running log (simple approach)
    const existing = await prisma.featureFlag.findUnique({ where: { name: 'ai_recipes' } })
    if (!existing) return

    // Parse existing usage or start fresh
    let usage = {}
    try {
      if (existing.description?.startsWith('{')) {
        usage = JSON.parse(existing.description)
      }
    } catch (e) {
      usage = {}
    }

    const month = new Date().toISOString().slice(0, 7)
    if (!usage[month]) usage[month] = { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0, byEndpoint: {} }

    usage[month].calls += 1
    usage[month].inputTokens += inputTokens
    usage[month].outputTokens += outputTokens
    usage[month].costUSD = parseFloat((usage[month].costUSD + cost).toFixed(4))
    usage[month].byEndpoint[endpoint] = (usage[month].byEndpoint[endpoint] || 0) + 1
    usage[month].lastCall = new Date().toISOString()

    await prisma.featureFlag.update({
      where: { name: 'ai_recipes' },
      data: { description: JSON.stringify(usage) }
    })
  } catch (e) {
    console.error('Failed to track API usage:', e)
  }
}

const isCreditsExhausted = (err) => {
  return (
    err?.status === 529 ||
    err?.status === 402 ||
    err?.message?.toLowerCase().includes('credit') ||
    err?.message?.toLowerCase().includes('billing') ||
    err?.error?.error?.type === 'invalid_request_error' ||
    (err?.status === 400 && err?.message?.toLowerCase().includes('credit'))
  )
}

const handleAnthropicError = async (err, res) => {
  console.error('Anthropic API error:', err?.message || err)

  if (isCreditsExhausted(err)) {
    // Mark credits as exhausted in DB
    try {
      await prisma.featureFlag.updateMany({
        where: { name: 'ai_recipes' },
        data: { description: JSON.stringify({ creditError: true, message: err.message, at: new Date().toISOString() }) }
      })
    } catch (e) {}

    return res.status(503).json({
      error: 'service_unavailable',
      userMessage: 'Our AI service is temporarily unavailable. Please try again later.',
      adminMessage: 'Anthropic API credits exhausted — top up at console.anthropic.com',
      creditsExhausted: true,
    })
  }

  if (err?.status === 529 || err?.message?.includes('overloaded')) {
    return res.status(503).json({
      error: 'service_overloaded',
      userMessage: 'AI is busy right now. Please try again in a few minutes.',
      creditsExhausted: false,
    })
  }

  return res.status(500).json({
    error: 'ai_error',
    userMessage: 'Something went wrong with AI. Please try again.',
    creditsExhausted: false,
  })
}

module.exports = { handleAnthropicError, isCreditsExhausted, trackApiUsage }