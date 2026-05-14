const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { suggestRecipes, familyRecipe, getSubstitutions, estimateCosts } = require('../controllers/recipeController')

router.post('/suggest', auth, suggestRecipes)
router.post('/family', auth, familyRecipe)
router.post('/substitutions', auth, getSubstitutions)
router.post('/estimate-costs', auth, estimateCosts)

module.exports = router