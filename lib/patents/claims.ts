const PREAMBLE_TRANSITION =
  /^(.*?\b(?:comprising|comprises|consisting of|consisting essentially of|including|includes|having|wherein)\b\s*:?)\s*(.*)$/is

export function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export function stripClaimNumber(text: string) {
  return text.replace(/^\s*\d+\s*[.)]\s*/, '')
}

function cleanElement(text: string) {
  return normalizeWhitespace(text)
    .replace(/^[;,:\s]+/, '')
    .replace(/[;,]\s*(and|or)?\s*$/i, '')
    .replace(/\.\s*$/, '')
    .trim()
}

/**
 * Heuristic claim-element segmentation for free text: preamble up to the
 * transitional phrase, then body limitations split on semicolons / line breaks,
 * with trailing "wherein" clauses broken out as their own limitations.
 */
export function splitClaimElements(rawClaim: string): string[] {
  const claim = stripClaimNumber(rawClaim.replace(/\r/g, '')).trim()
  if (!claim) return []

  const match = claim.match(PREAMBLE_TRANSITION)
  const preamble = match ? match[1] : ''
  const body = match ? match[2] : claim

  const pieces = body
    .split(/;\s*|\n+/)
    .flatMap((piece) => piece.split(/,?\s+(?=wherein\b)/i))
    .map(cleanElement)
    .filter((piece) => piece.split(' ').length >= 3)

  const elements = preamble ? [cleanElement(preamble), ...pieces] : pieces
  if (elements.length <= 1) {
    return claim
      .split(/,\s+(?=(?:a|an|the|said)\s)/i)
      .map(cleanElement)
      .filter((piece) => piece.split(' ').length >= 3)
      .slice(0, 25)
  }
  return elements.slice(0, 25)
}
