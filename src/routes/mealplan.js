const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const {
  getMealPlan,
  saveMeal,
  deleteMeal,
  generateGroceryFromPlan
} = require('../controllers/mealPlanController')

router.get('/', auth, getMealPlan)
router.post('/', auth, saveMeal)
router.delete('/:id', auth, deleteMeal)
router.post('/generate-grocery', auth, generateGroceryFromPlan)

module.exports = router