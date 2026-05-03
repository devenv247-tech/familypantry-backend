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
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  getApiStatus,
} = require('../controllers/adminController')

// All routes protected by adminAuth middleware
router.get('/stats', adminAuth, getDashboardStats)
router.get('/families', adminAuth, getFamilies)
router.put('/families/:id/plan', adminAuth, updateFamilyPlan)
router.delete('/families/:id', adminAuth, deleteFamily)
router.get('/flags', adminAuth, getFeatureFlags)
router.put('/flags/:id', adminAuth, updateFeatureFlag)
router.get('/usage', adminAuth, getUsageStats)
router.get('/announcements', adminAuth, getAnnouncements)
router.get('/api-status', adminAuth, getApiStatus)
router.post('/announcements', adminAuth, createAnnouncement)
router.delete('/announcements/:id', adminAuth, deleteAnnouncement)


module.exports = router