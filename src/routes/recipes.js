const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { suggestRecipes, familyRecipe, getSubstitutions } = require('../controllers/recipeController')

router.post('/suggest', auth, suggestRecipes)
router.post('/family', auth, familyRecipe)
router.post('/substitutions', auth, getSubstitutions)

module.exports = router