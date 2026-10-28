import { dot } from './vector'
import rerankConfig from './rerank-config.json'

export type RerankConfig = {
  lambda: number
  depth: number
  coverThreshold: number
  tunedOn: string | null
}

export const RERANK: RerankConfig = rerankConfig

export type ElementMatch = {
  element: number
  passage: number
  similarity: number
  covered: boolean
}

export type Overlap = {
  coverage: number
  coveredCount: number
  matches: ElementMatch[]
}

/**
 * Claim-element overlap: each claim limitation is matched to the single cited passage
 * that best discloses it. Coverage is the mean best-match similarity across limitations,
 * so a document only scores well if it speaks to most elements, not just one.
 */
export function elementOverlap(
  elementVecs: ArrayLike<number>[],
  passageVecs: ArrayLike<number>[],
  threshold = RERANK.coverThreshold,
): Overlap {
  if (!elementVecs.length || !passageVecs.length) return { coverage: 0, coveredCount: 0, matches: [] }
  const matches = elementVecs.map((e, element) => {
    let best = -1
    let passage = 0
    passageVecs.forEach((p, i) => {
      const s = dot(e, p)
      if (s > best) {
        best = s
        passage = i
      }
    })
    return { element, passage, similarity: best, covered: best >= threshold }
  })
  const coverage = matches.reduce((s, m) => s + m.similarity, 0) / matches.length
  return { coverage, coveredCount: matches.filter((m) => m.covered).length, matches }
}

export function fuse(dense: number, coverage: number, lambda = RERANK.lambda) {
  return (1 - lambda) * dense + lambda * coverage
}

const STOPWORDS = new Set(
  'the a an and or of to in on for with by from at as is are be being been said that which wherein whereby such each one first second third least plurality thereof therein its it this these those into via than then when where comprising comprises including includes having has have configured adapted arranged means further between based upon within least more other same respective'.split(
    ' ',
  ),
)

export function stem(word: string) {
  const w = word.toLowerCase()
  if (w.length > 6 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function contentStems(text: string) {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []) {
    if (!STOPWORDS.has(raw)) out.add(stem(raw))
  }
  return out
}

/** Vocabulary the element and its matched passage share; the rest of the match is conceptual. */
export function sharedTerms(element: string, passage: string) {
  const p = contentStems(passage)
  return [...contentStems(element)].filter((s) => p.has(s))
}
