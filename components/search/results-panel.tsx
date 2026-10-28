import { espacenetUrl, MODE_LABELS, type SearchResult } from '@/lib/patents/client'
import { ResultCard } from './result-card'

function CitationSummary({ result }: { result: SearchResult }) {
  const cited = Object.entries(result.citations)
  if (!cited.length) return null
  const shown = new Set(result.hits.map((h) => h.docId))
  const found = cited.filter(([d]) => shown.has(d))
  const missed = cited.filter(([d]) => !shown.has(d))
  const xFound = found.filter(([, g]) => g === 2).length
  const xTotal = cited.filter(([, g]) => g === 2).length
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-sm">
      <p>
        <span className="font-medium">
          {found.length} of {cited.length}
        </span>{' '}
        examiner citations retrieved in the top {result.hits.length}
        {xTotal > 0 && (
          <span className="text-muted-foreground">
            {' '}
            · {xFound}/{xTotal} novelty-destroying (X)
          </span>
        )}
      </p>
      {missed.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Not in top {result.hits.length}:{' '}
          {missed.map(([d, g], i) => (
            <span key={d}>
              <a href={espacenetUrl(d)} target="_blank" rel="noreferrer" className="font-mono hover:text-foreground">
                {d}
              </a>
              <span className="font-mono">{g === 2 ? ' (X)' : ' (A)'}</span>
              {i < missed.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

export function ResultsPanel({ result, claim }: { result: SearchResult; claim: string }) {
  const total = Object.values(result.timings).reduce((a, b) => a + b, 0)
  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="results-heading" className="text-base font-medium">
          Candidate prior art
        </h2>
        <p className="font-mono text-xs text-muted-foreground">
          {MODE_LABELS[result.mode].label.toLowerCase()}
          {result.rerank ? ' + element re-rank' : ''} · {total} ms
        </p>
      </div>

      <CitationSummary result={result} />

      <details className="group rounded-lg border border-border bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm">
          <span className="font-medium">Claim parsed into {result.elements.length} elements</span>
          <span className="text-muted-foreground"> — used for overlap analysis</span>
        </summary>
        <ol className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {result.elements.map((e, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span className="font-mono text-xs leading-6 text-muted-foreground">E{i + 1}</span>
              <span>{e}</span>
            </li>
          ))}
        </ol>
      </details>

      <ol className="flex flex-col gap-3">
        {result.hits.map((hit) => (
          <ResultCard
            key={hit.docId}
            hit={hit}
            elements={result.elements}
            claim={claim}
            citationGrade={result.citations[hit.docId]}
            judgment={result.judgments[hit.docId]}
            reranked={result.rerank}
          />
        ))}
      </ol>
    </section>
  )
}
