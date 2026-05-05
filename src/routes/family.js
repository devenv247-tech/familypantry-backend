const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getMembers, addMember, updateMember, deleteMember } = require('../controllers/familyController')
const { validateMember } = require('../middleware/validate')

router.get('/members', auth, getMembers)
router.post('/members', auth, validateMember, addMember)
router.put('/members/:id', auth, validateMember, updateMember)
router.delete('/members/:id', auth, deleteMember)

module.exports = router