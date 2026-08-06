// PIPEDA — member names must never be sent to the Anthropic API.
// Real names are substituted back into AI responses server-side after JSON.parse.

/**
 * Build an anonymized member profile block for AI prompts.
 * @param {Array} members - Prisma member records
 * @returns {{ profileText: string, nameMap: Object }}
 *   profileText: ready-to-embed string using "Member 1", "Member 2" labels
 *   nameMap: { "Member 1": "Jasmine", ... } for post-parse substitution
 */
function buildAnonymizedProfiles(members) {
  const nameMap = {}
  const profileText = members.map((m, i) => {
    const label = `Member ${i + 1}`
    if (m.name && m.name.trim()) nameMap[label] = m.name
    const weight = m.weight ? `${m.weight}${m.weightUnit || 'kg'}` : 'unknown'
    return `${label}: age=${m.age || 'unknown'}, goal=${m.goals || 'healthy eating'}, dietary=${m.dietary || 'none'}, allergens=${m.allergens || 'none'}, weight=${weight}, height=${m.height || 'unknown'}`
  }).join('; ')
  return { profileText, nameMap }
}

/**
 * Recursively replace anonymized labels with real names throughout an AI response.
 * Handles strings, arrays, and nested objects (e.g. allergenWarnings, memberTips).
 * Sorts labels longest-first so "Member 10" is replaced before "Member 1".
 * @param {*} value - string, array, or plain object (or primitive — returned as-is)
 * @param {Object} nameMap - { "Member 1": "Jasmine", ... }
 * @returns {*} same shape with every label occurrence replaced by the real name
 */
function substituteNames(value, nameMap) {
  if (!nameMap || Object.keys(nameMap).length === 0) return value

  const labels = Object.keys(nameMap).sort((a, b) => b.length - a.length)

  if (typeof value === 'string') {
    let result = value
    for (const label of labels) {
      result = result.split(label).join(nameMap[label])
    }
    return result
  }

  if (Array.isArray(value)) {
    return value.map(item => substituteNames(item, nameMap))
  }

  if (value !== null && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value)) {
      result[key] = substituteNames(value[key], nameMap)
    }
    return result
  }

  return value
}

module.exports = { buildAnonymizedProfiles, substituteNames }
