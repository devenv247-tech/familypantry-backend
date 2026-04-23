const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { suggestRecipes } = require('../controllers/recipeController')

router.post('/suggest', auth, suggestRecipes)

module.exports = router