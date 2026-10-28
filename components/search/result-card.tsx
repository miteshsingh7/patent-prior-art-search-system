'use client'

import { ArrowDown, ArrowUp, ChevronDown, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { espacenetUrl, type SearchHit } from '@/lib/patents/client'
import { cn } from '@/lib/utils'
import { ClaimChart } from './claim-chart'
import { JudgmentControl } from './judgment-control'

function CitationTag({ grade }: { grade: number | undefined }) {
  if (!grade) return null
  return (
    <span
      className={cn(
        'rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium',
        grade === 2 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
      )}
    >
      {grade === 2 ? 'examiner X' : 'examiner A'}
    </span>
  )
}

function RankShift({ hit, show }: { hit: SearchHit; show: boolean }) {
  const delta = hit.firstStageRank - hit.rank
  if (!show || delta === 0) return null
  const Icon = delta > 0 ? ArrowUp : ArrowDown
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 font-mono text-[11px]', delta > 0 ? 'text-primary' : 'text-muted-foreground')}
      title={`Rank ${hit.firstStageRank} before element re-ranking`}
    >
      <Icon className="size-3" aria-hidden />
      {Math.abs(delta)}
      <span className="sr-only">{delta > 0 ? 'places up' : 'places down'} after re-ranking</span>
    </span>
  )
}

export function ResultCard({
  hit,
  elements,
  claim,
  citationGrade,
  judgment,
  reranked,
}: {
  hit: SearchHit
  elements: string[]
  claim: string
  citationGrade: number | undefined
  judgment: number | undefined
  reranked: boolean
}) {
  const [open, setOpen] = useState(false)
  const covered = hit.matches.filter((m) => m.covered).length
  const panelId = `chart-${hit.docId}`

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-muted-foreground">#{hit.rank}</span>
        <a
          href={espacenetUrl(hit.docId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-sm font-medium hover:text-primary"
        >
          {hit.docId}
          <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">(opens Espacenet)</span>
        </a>
        <RankShift hit={hit} show={reranked} />
        <CitationTag grade={citationGrade} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          sim {hit.dense.toFixed(3)}
          {hit.coverage !== null && <> · cov {hit.coverage.toFixed(3)}</>}
        </span>
      </div>

      <p className="line-clamp-3 text-sm leading-relaxed text-pretty">{hit.preview}</p>

      {hit.matches.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Elements disclosed{' '}
              <span className="font-mono text-foreground">
                {covered}/{hit.matches.length}
              </span>
            </span>
          </div>
          <div className="flex gap-0.5" aria-hidden>
            {hit.matches.map((m) => (
              <span
                key={m.element}
                title={`E${m.element + 1}: ${m.similarity.toFixed(2)}`}
                className={cn('h-1.5 flex-1 rounded-full', m.covered ? 'bg-primary' : 'bg-muted')}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
          {open ? 'Hide claim chart' : 'Claim chart'}
        </button>
        <JudgmentControl claim={claim} docId={hit.docId} rank={hit.rank} initial={judgment} />
      </div>

      {open && (
        <div id={panelId}>
          <ClaimChart hit={hit} elements={elements} />
        </div>
      )}
    </li>
  )
}
