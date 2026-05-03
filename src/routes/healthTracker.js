const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const {
  getHealthData,
  logWeight,
  logMeal,
  updateMemberGoal,
  deleteNutritionLog,
} = require('../controllers/healthTrackerController')
const { lookupNutrition } = require('../controllers/nutritionLookupController')

router.get('/', auth, getHealthData)
router.post('/weight', auth, logWeight)
router.post('/meal', auth, logMeal)
router.put('/goal', auth, updateMemberGoal)
router.delete('/log/:id', auth, deleteNutritionLog)
router.post('/lookup', auth, lookupNutrition)

module.exports = router