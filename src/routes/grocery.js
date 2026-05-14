const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getItems, addItem, updateItem, deleteItem, clearChecked, getPredictions } = require('../controllers/groceryController')
const { validateGroceryItem } = require('../middleware/validate')

router.get('/', auth, getItems)
router.post('/', auth, validateGroceryItem, addItem)
router.put('/:id', auth, validateGroceryItem, updateItem)
router.get('/predictions', auth, getPredictions)
router.delete('/clear-checked', auth, clearChecked)
router.delete('/:id', auth, deleteItem)

module.exports = router