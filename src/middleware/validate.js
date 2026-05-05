const { body, validationResult } = require('express-validator')

// Middleware to check validation results
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => e.msg)
    })
  }
  next()
}

// Auth validation rules
const validateRegister = [
  body('familyName')
    .trim()
    .notEmpty().withMessage('Family name is required')
    .isLength({ max: 100 }).withMessage('Family name too long'),
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ max: 100 }).withMessage('Name too long'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email address')
    .isLength({ max: 255 }).withMessage('Email too long')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .isLength({ max: 128 }).withMessage('Password too long'),
  validate
]

const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ max: 128 }).withMessage('Password too long'),
  validate
]

const validateForgotPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  validate
]

const validateResetPassword = [
  body('token')
    .trim()
    .notEmpty().withMessage('Token is required')
    .isLength({ max: 255 }).withMessage('Invalid token'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .isLength({ max: 128 }).withMessage('Password too long'),
  validate
]

// Member validation
const validateMember = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ max: 100 }).withMessage('Name too long'),
  body('age')
    .optional({ nullable: true })
    .isInt({ min: 0, max: 120 }).withMessage('Age must be between 0 and 120'),
  body('weight')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 500 }).withMessage('Weight must be between 0 and 500'),
  body('goals')
    .optional()
    .isLength({ max: 500 }).withMessage('Goals too long'),
  body('dietary')
    .optional()
    .isLength({ max: 500 }).withMessage('Dietary preferences too long'),
  body('allergens')
    .optional()
    .isLength({ max: 500 }).withMessage('Allergens too long'),
  validate
]

// Pantry validation
const validatePantryItem = [
  body('name')
    .trim()
    .notEmpty().withMessage('Item name is required')
    .isLength({ max: 200 }).withMessage('Item name too long'),
  body('quantity')
    .notEmpty().withMessage('Quantity is required')
    .isFloat({ min: 0, max: 99999 }).withMessage('Invalid quantity'),
  body('unit')
    .trim()
    .notEmpty().withMessage('Unit is required')
    .isLength({ max: 50 }).withMessage('Unit too long'),
  body('category')
    .trim()
    .notEmpty().withMessage('Category is required')
    .isLength({ max: 100 }).withMessage('Category too long'),
  validate
]

// Grocery validation
const validateGroceryItem = [
  body('name')
    .trim()
    .notEmpty().withMessage('Item name is required')
    .isLength({ max: 200 }).withMessage('Item name too long'),
  body('qty')
    .optional()
    .isLength({ max: 100 }).withMessage('Quantity too long'),
  body('price')
    .optional()
    .isLength({ max: 50 }).withMessage('Price too long'),
  body('store')
    .optional()
    .isLength({ max: 200 }).withMessage('Store name too long'),
  validate
]

// Recipe validation
const validateRecipeRequest = [
  body('mealType')
    .optional()
    .isLength({ max: 50 }).withMessage('Meal type too long'),
  body('cuisine')
    .optional()
    .isLength({ max: 100 }).withMessage('Cuisine too long'),
  body('memberNames')
    .optional()
    .isArray({ max: 20 }).withMessage('Too many members'),
  validate
]

module.exports = {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
  validateMember,
  validatePantryItem,
  validateGroceryItem,
  validateRecipeRequest,
}