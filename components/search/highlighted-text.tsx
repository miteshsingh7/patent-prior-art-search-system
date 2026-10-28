import { stem } from '@/lib/patents/overlap'

const WORD = /^[A-Za-z][A-Za-z-]{2,}$/

function isTerm(token: string, terms: Set<string>) {
  const bare = token.replace(/[^A-Za-z-]/g, '')
  return WORD.test(bare) && terms.has(stem(bare))
}

/** Renders text with claim-element vocabulary marked like an examiner's highlighter. */
export function HighlightedText({
  text,
  terms,
  excerptWords,
}: {
  text: string
  terms: string[]
  excerptWords?: number
}) {
  const termSet = new Set(terms)
  let tokens = text.split(/(\s+)/)

  let prefix = ''
  let suffix = ''
  if (excerptWords) {
    const words = tokens.filter((_, i) => i % 2 === 0)
    if (words.length > excerptWords) {
      const firstHit = Math.max(0, words.findIndex((w) => isTerm(w, termSet)))
      const start = Math.max(0, Math.min(firstHit - Math.floor(excerptWords / 4), words.length - excerptWords))
      tokens = tokens.slice(start * 2, (start + excerptWords) * 2 - 1)
      prefix = start > 0 ? '… ' : ''
      suffix = start + excerptWords < words.length ? ' …' : ''
    }
  }

  return (
    <>
      {prefix}
      {tokens.map((t, i) =>
        i % 2 === 0 && isTerm(t, termSet) ? (
          <mark key={i} className="rounded-sm bg-highlight px-0.5 text-highlight-foreground">
            {t}
          </mark>
        ) : (
          t
        ),
      )}
      {suffix}
    </>
  )
}
