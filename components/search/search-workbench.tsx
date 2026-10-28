'use client'

import { useState } from 'react'
import useSWRMutation from 'swr/mutation'
import { getJson, postJson, type SampleClaim, type SearchMode, type SearchResult } from '@/lib/patents/client'
import { ClaimForm } from './claim-form'
import { ResultsPanel } from './results-panel'

type SearchArgs = { claim: string; mode: SearchMode; rerank: boolean; appId: string | null }

export function SearchWorkbench({ corpus }: { corpus: { docs: number; passages: number } }) {
  const [claim, setClaim] = useState('')
  const [mode, setMode] = useState<SearchMode>('adapted')
  const [rerank, setRerank] = useState(true)
  const [sample, setSample] = useState<SampleClaim | null>(null)
  const [searchedClaim, setSearchedClaim] = useState('')

  const search = useSWRMutation<SearchResult, Error, string, SearchArgs>('/api/search', postJson)
  const sampler = useSWRMutation<SampleClaim, Error, string>('/api/sample', (url: string) => getJson<SampleClaim>(url))

  const activeSample = sample && sample.claim === claim ? sample : null

  function run(overrides: Partial<SearchArgs> = {}) {
    const args: SearchArgs = { claim, mode, rerank, appId: activeSample?.appId ?? null, ...overrides }
    setSearchedClaim(args.claim)
    search.trigger(args).catch(() => {})
  }

  async function loadSample() {
    try {
      const s = await sampler.trigger()
      setSample(s)
      setClaim(s.claim)
      run({ claim: s.claim, appId: s.appId })
    } catch {}
  }

  const error = search.error?.message ?? sampler.error?.message ?? null

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <ClaimForm
          claim={claim}
          onClaimChange={setClaim}
          mode={mode}
          onModeChange={(m) => {
            setMode(m)
            if (search.data) run({ mode: m })
          }}
          rerank={rerank}
          onRerankChange={(v) => {
            setRerank(v)
            if (search.data) run({ rerank: v })
          }}
          onSubmit={() => run()}
          onSample={loadSample}
          searching={search.isMutating}
          sampling={sampler.isMutating}
          sample={activeSample}
          error={error}
        />
      </aside>

      <div aria-live="polite" aria-busy={search.isMutating}>
        {search.isMutating && !search.data ? (
          <ResultsSkeleton />
        ) : search.data ? (
          <div className={search.isMutating ? 'opacity-60 transition-opacity' : undefined}>
            <ResultsPanel result={search.data} claim={searchedClaim} />
          </div>
        ) : (
          <EmptyState corpus={corpus} />
        )}
      </div>
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Loading results">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex h-36 animate-pulse flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="h-3 w-40 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
          <div className="mt-auto h-1.5 w-full rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ corpus }: { corpus: { docs: number; passages: number } }) {
  const steps = [
    ['Encode', 'The claim is embedded with a sentence encoder adapted on examiner citation pairs.'],
    ['Retrieve', `Nearest-neighbour search over ${corpus.docs.toLocaleString()} prior-art documents (HNSW, pgvector).`],
    ['Re-rank', `Each claim element is matched against ${corpus.passages.toLocaleString()} cited passages; documents disclosing more elements move up.`],
  ]
  return (
    <div className="flex flex-col gap-6 rounded-lg border border-dashed border-border p-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-balance">Find prior art described in different words</h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Paste a claim, or load a held-out test claim to see how the results line up with the documents an EPO
          examiner actually cited against it.
        </p>
      </div>
      <ol className="flex flex-col gap-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-4">
            <span className="font-mono text-xs leading-6 text-muted-foreground">{i + 1}</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{body}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
