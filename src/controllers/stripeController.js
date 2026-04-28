const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const prisma = require('../utils/prisma')

// Create checkout session
exports.createCheckoutSession = async (req, res) => {
  try {
    const { plan } = req.body
    const { familyId, email } = req.user

    if (!['family', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    const priceId = plan === 'family'
      ? process.env.STRIPE_FAMILY_PRICE_ID
      : process.env.STRIPE_PREMIUM_PRICE_ID

    // Get or create Stripe customer
    const family = await prisma.family.findUnique({ where: { id: familyId } })

    let customerId = family.stripeCustomerId

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { familyId }
      })
      customerId = customer.id
      await prisma.family.update({
        where: { id: familyId },
        data: { stripeCustomerId: customerId }
      })
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/app/settings?tab=plan&success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/app/settings?tab=plan&cancelled=true`,
      metadata: { familyId, plan }
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('createCheckoutSession error:', err)
    res.status(500).json({ error: 'Failed to create checkout session' })
  }
}

// Create customer portal session (manage subscription)
exports.createPortalSession = async (req, res) => {
  try {
    const { familyId } = req.user
    const family = await prisma.family.findUnique({ where: { id: familyId } })

    if (!family.stripeCustomerId) {
      return res.status(400).json({ error: 'No active subscription found' })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: family.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/app/settings?tab=plan`,
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('createPortalSession error:', err)
    res.status(500).json({ error: 'Failed to create portal session' })
  }
}

// Stripe webhook — handles subscription events
exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Webhook signature error:', err.message)
    return res.status(400).json({ error: `Webhook error: ${err.message}` })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const { familyId, plan } = session.metadata
        await prisma.family.update({
          where: { id: familyId },
          data: {
            plan,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
          }
        })
        console.log(`✅ Family ${familyId} upgraded to ${plan}`)
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const family = await prisma.family.findFirst({
          where: { stripeCustomerId: sub.customer }
        })
        if (family) {
          const plan = sub.items.data[0]?.price?.id === process.env.STRIPE_PREMIUM_PRICE_ID
            ? 'premium'
            : sub.items.data[0]?.price?.id === process.env.STRIPE_FAMILY_PRICE_ID
            ? 'family'
            : 'free'
          await prisma.family.update({
            where: { id: family.id },
            data: { plan, stripeSubscriptionId: sub.id }
          })
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const family = await prisma.family.findFirst({
          where: { stripeCustomerId: sub.customer }
        })
        if (family) {
          await prisma.family.update({
            where: { id: family.id },
            data: { plan: 'free', stripeSubscriptionId: null }
          })
          console.log(`⬇️ Family ${family.id} downgraded to free`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        const family = await prisma.family.findFirst({
          where: { stripeCustomerId: invoice.customer }
        })
        if (family) {
          console.log(`❌ Payment failed for family ${family.id}`)
        }
        break
      }
    }

    res.json({ received: true })
  } catch (err) {
    console.error('Webhook handler error:', err)
    res.status(500).json({ error: 'Webhook handler failed' })
  }
}

// Get current subscription status
exports.getSubscription = async (req, res) => {
  try {
    const { familyId } = req.user
    const family = await prisma.family.findUnique({ where: { id: familyId } })

    if (!family.stripeSubscriptionId) {
      return res.json({ plan: family.plan || 'free', subscription: null })
    }

    const subscription = await stripe.subscriptions.retrieve(family.stripeSubscriptionId)

    res.json({
      plan: family.plan || 'free',
      subscription: {
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toLocaleDateString('en-CA'),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      }
    })
  } catch (err) {
    console.error('getSubscription error:', err)
    res.json({ plan: 'free', subscription: null })
  }
}