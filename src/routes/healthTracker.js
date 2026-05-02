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

router.get('/', auth, getHealthData)
router.post('/weight', auth, logWeight)
router.post('/meal', auth, logMeal)
router.put('/goal', auth, updateMemberGoal)
router.delete('/log/:id', auth, deleteNutritionLog)

module.exports = router