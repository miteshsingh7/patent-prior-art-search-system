import { Check } from 'lucide-react'
import type { SearchHit } from '@/lib/patents/client'
import { cn } from '@/lib/utils'
import { HighlightedText } from './highlighted-text'

/** Element-by-element mapping of the target claim onto the candidate's cited passages. */
export function ClaimChart({ hit, elements }: { hit: SearchHit; elements: string[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5.5rem] gap-4 border-b border-border bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
        <span>Claim element</span>
        <span>Best-matching cited passage</span>
        <span className="text-right">Similarity</span>
      </div>
      <ol className="divide-y divide-border">
        {hit.matches.map((m) => (
          <li
            key={m.element}
            className="grid grid-cols-1 gap-2 px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5.5rem] md:gap-4"
          >
            <div className="flex gap-2 text-sm leading-relaxed">
              <span className="font-mono text-xs leading-6 text-muted-foreground">E{m.element + 1}</span>
              <p>
                <HighlightedText text={elements[m.element] ?? ''} terms={m.terms} />
              </p>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              <HighlightedText text={m.passage} terms={m.terms} excerptWords={55} />
            </p>
            <div className="flex items-center gap-2 md:flex-col md:items-end md:gap-1">
              <span className={cn('font-mono text-xs', m.covered ? 'text-primary' : 'text-muted-foreground')}>
                {m.similarity.toFixed(2)}
              </span>
              <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn('block h-full rounded-full', m.covered ? 'bg-primary' : 'bg-muted-foreground/50')}
                  style={{ width: `${Math.max(0, Math.min(1, m.similarity)) * 100}%` }}
                />
              </span>
              {m.covered && (
                <span className="inline-flex items-center gap-1 text-xs text-primary">
                  <Check className="size-3" aria-hidden />
                  disclosed
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-border bg-secondary/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <mark className="rounded-sm bg-highlight px-1 text-highlight-foreground">Highlighted</mark> words are
        vocabulary the element and passage share. High similarity with little highlighting is a conceptual match
        that keyword search would miss.
      </p>
    </div>
  )
}
