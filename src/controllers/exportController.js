const prisma = require('../utils/prisma')

exports.exportUserData = async (req, res) => {
  try {
    const { userId, familyId } = req.user

    const [
      user,
      family,
      members,
      pantryItems,
      groceryItems,
      mealPlans,
      savedRecipes,
      nutritionLogs,
      weightLogs,
      cookedMeals,
      feedingLogs,
      growthLogs,
      allergenIntroductions,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          consentedAt: true,
          privacyPolicyVersion: true,
        }
      }),
      prisma.family.findUnique({
        where: { id: familyId },
        select: { id: true, name: true, plan: true, createdAt: true }
      }),
      prisma.member.findMany({
        where: { familyId },
        select: {
          id: true, name: true, role: true, age: true,
          weight: true, weightUnit: true, height: true,
          goals: true, dietary: true, allergens: true,
          isBaby: true, birthDate: true, createdAt: true,
        }
      }),
      prisma.pantryItem.findMany({
        where: { familyId },
        select: {
          name: true, quantity: true, unit: true,
          category: true, expiry: true, createdAt: true,
        }
      }),
      prisma.groceryItem.findMany({
        where: { familyId },
        select: {
          name: true, qty: true, price: true,
          store: true, checked: true, createdAt: true,
        }
      }),
      prisma.mealPlan.findMany({
        where: { familyId },
        select: {
          recipeName: true, mealType: true, day: true,
          cooked: true, cookedAt: true, createdAt: true,
        }
      }),
      prisma.savedRecipe.findMany({
        where: { familyId },
        select: {
          name: true, description: true, tags: true, difficulty: true,
          time: true, serves: true, allergenWarnings: true,
        }
      }),
      prisma.nutritionLog.findMany({
        where: { familyId },
        select: {
          recipeName: true, calories: true, protein: true,
          carbs: true, fat: true, fiber: true, sugar: true, sodium: true,
        }
      }),
      prisma.weightLog.findMany({
        where: { member: { familyId } },
        select: {
          weight: true, note: true, loggedAt: true,
        }
      }),
      prisma.cookedMeal.findMany({
        where: { familyId },
        select: {
          recipeName: true, mealType: true, cookedAt: true,
        }
      }),
      prisma.feedingLog.findMany({
        where: { member: { familyId } },
        select: {
          foodName: true, portionMl: true, portionG: true,
          texture: true, reaction: true, notes: true, loggedAt: true,
        }
      }),
      prisma.growthLog.findMany({
        where: { member: { familyId } },
        select: {
          weight: true, weightUnit: true, height: true,
          heightUnit: true, note: true,
        }
      }),
      prisma.allergenIntroduction.findMany({
        where: { member: { familyId } },
        select: {
          allergen: true, introducedAt: true, reaction: true, notes: true,
        }
      }),
    ])

    const exportData = {
      exportedAt: new Date().toISOString(),
      exportVersion: '1.0',
      notice: 'This file contains all personal data Nooka holds for your account, exported under your rights pursuant to PIPEDA (Personal Information Protection and Electronic Documents Act) and BC PIPA.',
      account: user,
      family,
      members,
      pantryItems,
      groceryItems,
      mealPlans,
      savedRecipes,
      nutritionLogs,
      weightLogs,
      cookedMeals,
      babyData: {
        feedingLogs,
        growthLogs,
        allergenIntroductions,
      }
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="nooka-data-export-${new Date().toISOString().split('T')[0]}.json"`)
    res.json(exportData)

  } catch (err) {
    console.error('Export error:', err)
    res.status(500).json({ error: 'Failed to export data' })
  }
}