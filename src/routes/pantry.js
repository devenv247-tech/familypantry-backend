const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getItems, addItem, updateItem, deleteItem, subtractIngredients, restockItem } = require('../controllers/pantryController')
const { validatePantryItem } = require('../middleware/validate')

router.get('/', auth, getItems)
router.post('/', auth, validatePantryItem, addItem)
router.put('/:id', auth, validatePantryItem, updateItem)
router.delete('/:id', auth, deleteItem)
router.post('/subtract', auth, subtractIngredients)
router.post('/:id/restock', auth, restockItem)

module.exports = router