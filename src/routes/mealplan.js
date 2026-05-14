const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const {
  getMealPlan,
  saveMeal,
  deleteMeal,
  generateGroceryFromPlan,
  generateWeekPlan,
  markCooked
} = require('../controllers/mealPlanController')

router.get('/', auth, getMealPlan)
router.post('/', auth, saveMeal)
router.delete('/:id', auth, deleteMeal)
router.post('/generate-grocery', auth, generateGroceryFromPlan)
router.post('/generate-week', auth, generateWeekPlan)
router.patch('/:id/cooked', auth, markCooked)

module.exports = router