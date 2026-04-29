const express = require('express')
const router = express.Router()
const adminAuth = require('../middleware/adminAuth')
const {
  getDashboardStats,
  getFamilies,
  updateFamilyPlan,
  deleteFamily,
  getFeatureFlags,
  updateFeatureFlag,
  getUsageStats,
} = require('../controllers/adminController')

// All routes protected by adminAuth middleware
router.get('/stats', adminAuth, getDashboardStats)
router.get('/families', adminAuth, getFamilies)
router.put('/families/:id/plan', adminAuth, updateFamilyPlan)
router.delete('/families/:id', adminAuth, deleteFamily)
router.get('/flags', adminAuth, getFeatureFlags)
router.put('/flags/:id', adminAuth, updateFeatureFlag)
router.get('/usage', adminAuth, getUsageStats)

module.exports = router