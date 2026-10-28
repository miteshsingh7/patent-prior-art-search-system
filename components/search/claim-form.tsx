'use client'

import { Loader2, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MODE_LABELS, type SampleClaim, type SearchMode } from '@/lib/patents/client'
import { cn } from '@/lib/utils'

const MODES: SearchMode[] = ['keyword', 'base', 'adapted']

export function ClaimForm({
  claim,
  onClaimChange,
  mode,
  onModeChange,
  rerank,
  onRerankChange,
  onSubmit,
  onSample,
  searching,
  sampling,
  sample,
  error,
}: {
  claim: string
  onClaimChange: (v: string) => void
  mode: SearchMode
  onModeChange: (m: SearchMode) => void
  rerank: boolean
  onRerankChange: (v: boolean) => void
  onSubmit: () => void
  onSample: () => void
  searching: boolean
  sampling: boolean
  sample: SampleClaim | null
  error: string | null
}) {
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="claim" className="text-sm font-medium">
            Target claim
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={onSample} disabled={sampling || searching}>
            {sampling ? <Loader2 className="animate-spin" aria-hidden /> : <Shuffle aria-hidden />}
            Load a test claim
          </Button>
        </div>
        <Textarea
          id="claim"
          value={claim}
          onChange={(e) => onClaimChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            e.preventDefault()
            onSubmit()
          }}
          rows={9}
          placeholder="1. A method for ... comprising: a) ...; b) ...; wherein ..."
          className="max-h-96 min-h-48 font-mono text-[13px] leading-relaxed"
          aria-describedby="claim-help"
          aria-invalid={Boolean(error) || undefined}
        />
        <p id="claim-help" className="text-xs leading-relaxed text-muted-foreground">
          {sample ? (
            <>
              Held-out claim from <span className="font-mono text-foreground">{sample.appId}</span>. The examiner
              cited {sample.citations} documents ({sample.xCitations} novelty-destroying X) — results are marked
              against them.
            </>
          ) : (
            'Independent claim text works best. Ctrl/Cmd + Enter to search.'
          )}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">First-stage retrieval</legend>
        <div role="radiogroup" aria-label="Retrieval model" className="grid grid-cols-3 gap-1 rounded-md bg-secondary p-1">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => onModeChange(m)}
              className={cn(
                'rounded-sm px-2 py-1.5 text-xs font-medium transition-colors',
                mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {MODE_LABELS[m].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODE_LABELS[mode].hint}</p>
      </fieldset>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span id="rerank-label" className="text-sm font-medium">
            Claim-element re-rank
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Match each limitation to its best cited passage and reorder the top 100 by coverage.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={rerank}
          aria-labelledby="rerank-label"
          onClick={() => onRerankChange(!rerank)}
          className={cn(
            'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            rerank ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'inline-block size-4 rounded-full bg-card shadow-sm transition-transform',
              rerank ? 'translate-x-4.5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={searching || claim.trim().length < 40}>
        {searching && <Loader2 className="animate-spin" aria-hidden />}
        {searching ? 'Searching prior art' : 'Search prior art'}
      </Button>
    </form>
  )
}
