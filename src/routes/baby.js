const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const {
  getBabyProfile,
  getAllergenIntroductions,
  logAllergenIntroduction,
  removeAllergenIntroduction,
  getFeedingLog,
  addFeedingLog,
  deleteFeedingLog,
  generateBabyRecipe,
} = require('../controllers/babyController')

router.get('/:memberId/profile',                    auth, getBabyProfile)
router.get('/:memberId/allergens',                  auth, getAllergenIntroductions)
router.post('/:memberId/allergens',                 auth, logAllergenIntroduction)
router.delete('/:memberId/allergens/:allergen',     auth, removeAllergenIntroduction)
router.get('/:memberId/feeding-log',                auth, getFeedingLog)
router.post('/:memberId/feeding-log',               auth, addFeedingLog)
router.delete('/:memberId/feeding-log/:logId',      auth, deleteFeedingLog)
router.post('/:memberId/recipe',                    auth, generateBabyRecipe)

module.exports = router