import type { AggregateMetrics } from '@/lib/patents/metrics'
import { SYSTEM_LABELS, SYSTEM_ORDER, type EvalRun } from '@/lib/patents/report'
import { cn } from '@/lib/utils'

const COLUMNS: { key: string; label: string; title: string; get: (m: AggregateMetrics) => number }[] = [
  { key: 'r10', label: 'Recall@10', title: 'Share of examiner citations in the top 10', get: (m) => m.recall[10] },
  { key: 'r50', label: 'Recall@50', title: 'Share of examiner citations in the top 50', get: (m) => m.recall[50] },
  { key: 'r100', label: 'Recall@100', title: 'Share of examiner citations in the top 100', get: (m) => m.recall[100] },
  { key: 'x10', label: 'X-Recall@10', title: 'Share of novelty-destroying (X) citations in the top 10', get: (m) => m.xRecall[10] },
  { key: 'ndcg', label: 'nDCG@10', title: 'Graded ranking quality, X = 2, A = 1', get: (m) => m.ndcg10 },
  { key: 'mrr', label: 'MRR', title: 'Mean reciprocal rank of the first cited document', get: (m) => m.mrr },
]

export function MetricsTable({ run }: { run: EvalRun }) {
  const systems = SYSTEM_ORDER.filter((s) => run.results.systems[s])
  const best = Object.fromEntries(
    COLUMNS.map((c) => [c.key, Math.max(...systems.map((s) => c.get(run.results.systems[s].test)))]),
  )
  const keywordR100 = run.results.systems.keyword?.test.recall[100] ?? 0

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">Retrieval metrics on the held-out test split</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              System
            </th>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" title={c.title} className="px-3 py-3 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {systems.map((s) => {
            const m = run.results.systems[s].test
            const isPipeline = s === 'adapted_rerank'
            return (
              <tr key={s} className={cn(isPipeline && 'bg-secondary/60')}>
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className={cn('block', isPipeline && 'font-medium')}>{SYSTEM_LABELS[s].name}</span>
                  <span className="block text-xs text-muted-foreground">{SYSTEM_LABELS[s].detail}</span>
                </th>
                {COLUMNS.map((c) => {
                  const v = c.get(m)
                  const top = Math.abs(v - best[c.key]) < 1e-9
                  return (
                    <td key={c.key} className="px-3 py-3 text-right align-top">
                      <span className={cn('font-mono tabular-nums', top ? 'font-medium text-primary' : 'text-foreground')}>
                        {v.toFixed(3)}
                      </span>
                      {c.key === 'r100' && s !== 'keyword' && keywordR100 > 0 && (
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {v >= keywordR100 ? '+' : ''}
                          {(((v - keywordR100) / keywordR100) * 100).toFixed(0)}% vs kw
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
