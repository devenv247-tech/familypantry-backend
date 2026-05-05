const express = require('express')
const router = express.Router()
// Public endpoint — no auth needed, used by landing page
router.get('/public/config', async (req, res) => {
  try {
    const flags = await prisma.featureFlag.findMany({
      where: { enabled: true },
      select: { name: true, description: true, requiredPlan: true }
    })
    res.json({ flags })
  } catch (err) {
    res.status(500).json({ error: 'Failed' })
  }
})
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