/**
 * heightToCm — parse a freeform height string to centimetres.
 *
 * Handled formats:
 *   5'4"   feet + inches with trailing quote
 *   5'4    feet + inches, no trailing quote
 *   64     bare integer ≤ 96 → total inches
 *   163    bare integer > 96 → cm
 *   163cm  explicit cm label
 *
 * Returns a Number, or null when unparseable / falsy input.
 */
const heightToCm = (heightStr) => {
  if (!heightStr || typeof heightStr !== 'string') return null
  const s = heightStr.trim()

  // 5'4" or 5'4
  const feetInches = s.match(/^(\d+)'(\d+)"?$/)
  if (feetInches) {
    const feet = parseInt(feetInches[1], 10)
    const inches = parseInt(feetInches[2], 10)
    return (feet * 30.48) + (inches * 2.54)
  }

  // 163cm (with optional space)
  const withCm = s.match(/^(\d+(?:\.\d+)?)\s*cm$/i)
  if (withCm) return parseFloat(withCm[1])

  // bare number — ≤96 = total inches, >96 = cm already
  const plain = s.match(/^(\d+(?:\.\d+)?)$/)
  if (plain) {
    const val = parseFloat(plain[1])
    return val <= 96 ? val * 2.54 : val
  }

  return null
}

/**
 * toKg — normalise a weight value to kilograms.
 * Passes kg through; divides lbs by 2.2046.
 * Returns a Number, or null for missing / non-numeric input.
 */
const toKg = (weight, unit) => {
  if (weight == null) return null
  const w = parseFloat(weight)
  if (isNaN(w)) return null
  if (unit === 'lbs' || unit === 'lb') return w / 2.2046
  return w
}

module.exports = { heightToCm, toKg }
