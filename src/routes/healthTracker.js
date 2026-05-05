const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const adminAuth = require('../middleware/adminAuth')
const {
  getHealthData,
  logWeight,
  logMeal,
  updateMemberGoal,
  deleteNutritionLog,
  searchNutritionCache,
} = require('../controllers/healthTrackerController')
const {
  lookupNutrition,
  getCacheStats,
  deleteCacheItem,
  clearExpiredCache,
  clearAllCache,
} = require('../controllers/nutritionLookupController')

// Health tracker routes
router.get('/', auth, getHealthData)
router.post('/weight', auth, logWeight)
router.post('/meal', auth, logMeal)
router.put('/goal', auth, updateMemberGoal)
router.delete('/log/:id', auth, deleteNutritionLog)
router.post('/lookup', auth, lookupNutrition)
router.get('/nutrition/search', auth, searchNutritionCache)

// Cache management — admin only
router.get('/cache/stats', adminAuth, getCacheStats)
router.delete('/cache/expired', adminAuth, clearExpiredCache)
router.delete('/cache/all', adminAuth, clearAllCache)
router.delete('/cache/:id', adminAuth, deleteCacheItem)

module.exports = router