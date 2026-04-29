const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const {
  getSavedRecipes,
  saveRecipe,
  deleteSavedRecipe,
  checkSaved
} = require('../controllers/savedRecipesController')

router.get('/', auth, getSavedRecipes)
router.post('/', auth, saveRecipe)
router.delete('/:id', auth, deleteSavedRecipe)
router.get('/check', auth, checkSaved)

module.exports = router