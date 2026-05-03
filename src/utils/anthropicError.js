const prisma = require('./prisma')

// Check if error is Anthropic credit exhaustion
const isCreditsExhausted = (err) => {
  return (
    err?.status === 529 ||
    err?.error?.type === 'overloaded_error' ||
    err?.message?.includes('credit') ||
    err?.message?.includes('billing') ||
    err?.error?.error?.type === 'invalid_request_error' && err?.message?.includes('credit') ||
    err?.status === 400 && err?.message?.toLowerCase().includes('credit')
  )
}

// Store API status in DB so admin can see it
const setApiStatus = async (service, status, message) => {
  try {
    // Store in a simple way using FeatureFlag table's description field
    await prisma.featureFlag.updateMany({
      where: { name: 'ai_recipes' },
      data: {
        description: status === 'error'
          ? `⚠️ API ERROR: ${message} — ${new Date().toISOString()}`
          : 'AI recipe generation'
      }
    })
  } catch (e) {
    console.error('Failed to store API status:', e)
  }
}

const handleAnthropicError = async (err, res) => {
  console.error('Anthropic API error:', err)

  if (isCreditsExhausted(err)) {
    // Alert admin via feature flag description
    await setApiStatus('anthropic', 'error', 'Credits exhausted')

    return res.status(503).json({
      error: 'service_unavailable',
      userMessage: 'Our AI service is temporarily unavailable. Please try again later or contact support.',
      adminMessage: 'Anthropic API credits exhausted — top up at console.anthropic.com',
      creditsExhausted: true,
    })
  }

  if (err?.status === 529 || err?.message?.includes('overloaded')) {
    return res.status(503).json({
      error: 'service_overloaded',
      userMessage: 'AI service is busy right now. Please try again in a few minutes.',
      creditsExhausted: false,
    })
  }

  return res.status(500).json({
    error: 'ai_error',
    userMessage: 'Something went wrong with AI. Please try again.',
    creditsExhausted: false,
  })
}

module.exports = { handleAnthropicError, isCreditsExhausted }