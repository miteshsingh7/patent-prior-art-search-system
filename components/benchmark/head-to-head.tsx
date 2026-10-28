import type { EvalRun } from '@/lib/patents/report'

/** Per-query comparison: where does conceptual retrieval find art that shared vocabulary misses? */
export function HeadToHead({ run }: { run: EvalRun }) {
  const rows = run.perQuery
  const kwOnly = rows.filter((r) => r.systems.keyword.recall100 > 0 && r.systems.adapted_rerank.recall100 === 0).length
  const semOnly = rows.filter((r) => r.systems.keyword.recall100 === 0 && r.systems.adapted_rerank.recall100 > 0).length
  const neither = rows.filter((r) => r.systems.keyword.recall100 === 0 && r.systems.adapted_rerank.recall100 === 0).length
  const both = rows.length - kwOnly - semOnly - neither

  let better = 0
  let worse = 0
  for (const r of rows) {
    const a = r.systems.adapted_rerank.firstHit ?? Infinity
    const k = r.systems.keyword.firstHit ?? Infinity
    if (a < k) better++
    else if (a > k) worse++
  }

  const cells = [
    { label: 'Found by both', value: both },
    { label: 'Only the semantic pipeline', value: semOnly, emphasis: true },
    { label: 'Only keyword search', value: kwOnly },
    { label: 'Neither (top 100)', value: neither },
  ]

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Full pipeline vs keyword, per claim</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Of {rows.length} test claims, which method surfaces at least one examiner citation in its top 100.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
        {cells.map((c) => (
          <div key={c.label} className="flex flex-col gap-1 bg-card p-3">
            <dt className="text-xs text-muted-foreground">{c.label}</dt>
            <dd className={c.emphasis ? 'font-mono text-xl text-primary' : 'font-mono text-xl'}>{c.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        First cited document ranked higher by the pipeline on <span className="font-mono text-foreground">{better}</span>{' '}
        claims, lower on <span className="font-mono text-foreground">{worse}</span>, tied on{' '}
        <span className="font-mono text-foreground">{rows.length - better - worse}</span>.
      </p>
    </div>
  )
}
