export function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

const TRANSITION = /\b(comprising|comprises|comprise|consisting of|consisting essentially of|including|includes|having|characterized in that|characterised in that|characterized by|characterised by)\b/i

/** Words after which an article continues the current noun phrase rather than opening a new limitation. */
const BINDING = new Set([
  'of', 'to', 'with', 'in', 'on', 'from', 'by', 'for', 'between', 'into', 'at', 'onto', 'over',
  'under', 'through', 'via', 'as', 'than', 'within', 'about', 'against', 'along', 'across',
  'is', 'are', 'be', 'being', 'has', 'have', 'forming', 'form', 'defining', 'define', 'providing',
  'receiving', 'comprising', 'including', 'having', 'containing', 'contains', 'such', 'or', 'the',
  'and', 'which', 'that', 'whether', 'either', 'least', 'determining', 'generating', 'obtaining',
  'applying', 'printing', 'using', 'storing', 'transmitting', 'detecting', 'measuring',
])

const BREAK_BEFORE = /^(wherein|whereby|characterized|characterised|such|so)$/i
const STEP_LETTER = /^[a-h]$/
const MIN_WORDS = 5
const MAX_ELEMENTS = 14

/**
 * Claim-element segmentation that works without punctuation (PatentMatch strips
 * commas and semicolons): preamble up to the transitional phrase, then the body is
 * cut before lettered steps ("a providing … b providing …"), before "wherein"
 * clauses, and before an article that opens a new noun phrase after "and"/a verb
 * boundary rather than continuing a prepositional phrase.
 */
export function splitClaimElements(rawClaim: string): string[] {
  const claim = normalizeWhitespace(rawClaim.replace(/^\s*\d+\s*[.)]\s*/, ''))
  if (!claim) return []

  const t = claim.match(TRANSITION)
  const preamble = t && t.index! > 0 ? claim.slice(0, t.index! + t[0].length).trim() : ''
  const body = preamble ? claim.slice(preamble.length).replace(/^[\s:]+/, '') : claim
  const hasSemicolons = /;/.test(body)

  let segments: string[]
  if (hasSemicolons) {
    segments = body.split(/;\s*/).flatMap((s) => s.split(/\s+(?=wherein\b)/i))
  } else {
    const words = body.split(' ')
    segments = []
    let current: string[] = []
    const flush = () => {
      if (current.length) segments.push(current.join(' '))
      current = []
    }
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      const lower = w.toLowerCase()
      const prev = (words[i - 1] ?? '').toLowerCase()
      const next = (words[i + 1] ?? '').toLowerCase()
      const longEnough = current.length >= MIN_WORDS

      const isStepLetter =
        STEP_LETTER.test(lower) && /^[a-z]+ing$/.test(next) && !BINDING.has(prev) && longEnough
      const isClauseBreak = BREAK_BEFORE.test(lower) && longEnough && (lower !== 'such' || next === 'that')
      const opensNounPhrase =
        (lower === 'a' || lower === 'an' || (lower === 'at' && next === 'least') || lower === 'one') &&
        (prev === 'and' || !BINDING.has(prev)) &&
        longEnough &&
        current.length >= 8

      if (isStepLetter) {
        flush()
        continue
      }
      if (isClauseBreak || opensNounPhrase) {
        if (prev === 'and' && current.length > 1) current.pop()
        flush()
      }
      current.push(w)
    }
    flush()
  }

  const cleaned = segments
    .map((s) => normalizeWhitespace(s).replace(/^(and|or)\s+/i, '').replace(/\s+(and|or)$/i, '').replace(/[.,;:]+$/, ''))
    .filter(Boolean)

  const merged: string[] = []
  for (const s of cleaned) {
    if (merged.length && s.split(' ').length < MIN_WORDS) merged[merged.length - 1] += ` ${s}`
    else merged.push(s)
  }

  const elements = preamble ? [preamble.replace(/[,:]+$/, ''), ...merged] : merged
  if (elements.length <= MAX_ELEMENTS) return elements
  const head = elements.slice(0, MAX_ELEMENTS - 1)
  return [...head, elements.slice(MAX_ELEMENTS - 1).join(' ')]
}
