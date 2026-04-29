const prisma = require('../utils/prisma')

exports.getSavedRecipes = async (req, res) => {
  try {
    const recipes = await prisma.savedRecipe.findMany({
      where: { familyId: req.user.familyId },
      orderBy: { createdAt: 'desc' }
    })
    res.json(recipes)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch saved recipes' })
  }
}

exports.saveRecipe = async (req, res) => {
  try {
    const {
      name, description, icon, time, difficulty,
      serves, tags, ingredients, missing, steps,
      nutrition, nutritionPerServing, allergenWarnings
    } = req.body
    const familyId = req.user.familyId

    if (!name) return res.status(400).json({ error: 'Recipe name is required' })

    // Check if already saved
    const existing = await prisma.savedRecipe.findFirst({
      where: { familyId, name: { equals: name, mode: 'insensitive' } }
    })
    if (existing) {
      return res.status(400).json({ error: 'Recipe already saved', alreadySaved: true })
    }

    const recipe = await prisma.savedRecipe.create({
      data: {
        name, description, icon, time, difficulty,
        serves, tags, ingredients, missing, steps,
        nutrition, nutritionPerServing, allergenWarnings,
        familyId
      }
    })
    res.status(201).json(recipe)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save recipe' })
  }
}

exports.deleteSavedRecipe = async (req, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.savedRecipe.findFirst({
      where: { id, familyId: req.user.familyId }
    })
    if (!existing) return res.status(404).json({ error: 'Recipe not found' })
    await prisma.savedRecipe.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete saved recipe' })
  }
}

exports.checkSaved = async (req, res) => {
  try {
    const { name } = req.query
    const existing = await prisma.savedRecipe.findFirst({
      where: {
        familyId: req.user.familyId,
        name: { equals: name, mode: 'insensitive' }
      }
    })
    res.json({ saved: !!existing, id: existing?.id || null })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to check saved status' })
  }
}