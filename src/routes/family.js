const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getMembers, addMember, updateMember, deleteMember } = require('../controllers/familyController')

router.get('/members', auth, getMembers)
router.post('/members', auth, addMember)
router.put('/members/:id', auth, updateMember)
router.delete('/members/:id', auth, deleteMember)

module.exports = router