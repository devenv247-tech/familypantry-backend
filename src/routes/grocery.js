const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { getItems, addItem, updateItem, deleteItem, clearChecked } = require('../controllers/groceryController')

router.get('/', auth, getItems)
router.post('/', auth, addItem)
router.put('/:id', auth, updateItem)
router.delete('/clear-checked', auth, clearChecked)
router.delete('/:id', auth, deleteItem)

module.exports = router