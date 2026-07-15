const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getMembers, addMember, updateMember, deleteMember, inviteMember, updateRestockThreshold, getNotificationPrefs, updateNotificationPrefs } = require('../controllers/familyController')
const { validateMember } = require('../middleware/validate')

router.get('/members', auth, getMembers)
router.post('/members', auth, validateMember, addMember)
router.put('/members/:id', auth, validateMember, updateMember)
router.delete('/members/:id', auth, deleteMember)
router.post('/members/:id/invite', auth, inviteMember)
router.put('/restock-threshold', auth, updateRestockThreshold)
router.get('/notification-prefs', auth, getNotificationPrefs)
router.patch('/notification-prefs', auth, updateNotificationPrefs)

module.exports = router