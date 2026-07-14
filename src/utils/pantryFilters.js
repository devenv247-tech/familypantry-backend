const filterUsable = (items, now = new Date()) =>
  items.filter(i => {
    if (i.quantity <= 0) return false
    if (i.expiry && new Date(i.expiry) < now) return false
    return true
  })

module.exports = { filterUsable }
