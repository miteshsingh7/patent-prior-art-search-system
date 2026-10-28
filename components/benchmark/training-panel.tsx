import type { EvalRun } from '@/lib/patents/report'

function Sparkline({ values, best }: { values: number[]; best: number }) {
  if (values.length < 2) return null
  const w = 240
  const h = 56
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)])
  const bi = Math.max(0, best)
  return (
    <div className="relative h-14 w-full" role="img" aria-label="Validation Recall@100 by epoch">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
        <polyline
          points={pts.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
      </svg>
      {pts[bi] && (
        <span
          aria-hidden="true"
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${(pts[bi][0] / w) * 100}%`, top: `${(pts[bi][1] / h) * 100}%` }}
        />
      )}
    </div>
  )
}

export function TrainingPanel({ run }: { run: EvalRun }) {
  const meta = run.config.adapter
  const sweep = run.results.lambdaSweep
  const maxNdcg = Math.max(...sweep.map((s) => s.ndcg10), 1e-9)
  const minNdcg = Math.min(...sweep.map((s) => s.ndcg10))
  const floor = Math.max(0, minNdcg - (maxNdcg - minNdcg || 0.01))

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-medium">Domain adaptation</h3>
        {meta ? (
          <>
            <Sparkline
              values={meta.valCurve.map((c) => c.recall100)}
              best={meta.valCurve.findIndex((c) => c.epoch === meta.epochs)}
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Val Recall@100</dt>
              <dd className="text-right font-mono">
                {meta.validation.baseRecall100.toFixed(3)} → {meta.validation.adaptedRecall100.toFixed(3)}
              </dd>
              <dt className="text-muted-foreground">Val nDCG@10</dt>
              <dd className="text-right font-mono">
                {meta.validation.baseNdcg10.toFixed(3)} → {meta.validation.adaptedNdcg10.toFixed(3)}
              </dd>
              <dt className="text-muted-foreground">Citation pairs</dt>
              <dd className="text-right font-mono">
                {meta.trainPairs.toLocaleString()} from {meta.trainQueries} claims
              </dd>
              <dt className="text-muted-foreground">Selected epoch</dt>
              <dd className="text-right font-mono">{meta.epochs}</dd>
            </dl>
            <p className="text-xs leading-relaxed text-muted-foreground">
              A 384×384 linear map on top of {meta.baseModel}, trained with InfoNCE (τ = {meta.temperature}) and an
              identity penalty so it stays close to the general-purpose space.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No adapter trained yet.</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-medium">Re-rank weight λ</h3>
        <div className="flex h-20 items-end gap-1" role="img" aria-label="Validation nDCG@10 by lambda">
          {sweep.map((s) => (
            <div
              key={s.lambda}
              title={`λ ${s.lambda}: nDCG@10 ${s.ndcg10.toFixed(3)}`}
              className={s.lambda === run.config.lambda ? 'flex-1 rounded-t-sm bg-primary' : 'flex-1 rounded-t-sm bg-muted'}
              style={{ height: `${((s.ndcg10 - floor) / (maxNdcg - floor || 1)) * 100}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
          <span>λ 0</span>
          <span>{sweep.at(-1)?.lambda}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          score = (1 − λ)·similarity + λ·element coverage. Bars show validation nDCG@10; λ ={' '}
          <span className="font-mono text-foreground">{run.config.lambda}</span> maximises nDCG@10 + Recall@10 on{' '}
          {run.config.tunedOn}. An element
          counts as disclosed at similarity ≥ <span className="font-mono text-foreground">{run.config.coverThreshold}</span>.
        </p>
      </div>
    </div>
  )
}
