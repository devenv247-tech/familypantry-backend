const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { suggestRecipes, familyRecipe } = require('../controllers/recipeController')

router.post('/suggest', auth, suggestRecipes)
router.post('/family', auth, familyRecipe)

module.exports = router