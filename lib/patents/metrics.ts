export const CUTOFFS = [10, 50, 100] as const

export type QueryMetrics = {
  recall: Record<number, number>
  xRecall: Record<number, number>
  ndcg10: number
  mrr: number
  firstHit: number | null
}

/** Graded metrics against examiner citations: grade 2 = X citation, grade 1 = A citation. */
export function scoreRanking(ranked: string[], qrels: Map<string, number>): QueryMetrics {
  const relevant = [...qrels.keys()]
  const xDocs = relevant.filter((d) => qrels.get(d) === 2)
  const recall: Record<number, number> = {}
  const xRecall: Record<number, number> = {}
  for (const k of CUTOFFS) {
    const top = new Set(ranked.slice(0, k))
    recall[k] = relevant.filter((d) => top.has(d)).length / relevant.length
    xRecall[k] = xDocs.length ? xDocs.filter((d) => top.has(d)).length / xDocs.length : Number.NaN
  }
  let dcg = 0
  ranked.slice(0, 10).forEach((d, i) => {
    const g = qrels.get(d) ?? 0
    if (g) dcg += (2 ** g - 1) / Math.log2(i + 2)
  })
  const ideal = [...qrels.values()].sort((a, b) => b - a).slice(0, 10)
  const idcg = ideal.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0)
  const first = ranked.findIndex((d) => qrels.has(d))
  return { recall, xRecall, ndcg10: idcg ? dcg / idcg : 0, mrr: first >= 0 ? 1 / (first + 1) : 0, firstHit: first >= 0 ? first + 1 : null }
}

export type AggregateMetrics = {
  recall: Record<number, number>
  xRecall: Record<number, number>
  ndcg10: number
  mrr: number
  queries: number
}

export function aggregate(rows: QueryMetrics[]): AggregateMetrics {
  const avg = (xs: number[]) => {
    const v = xs.filter((x) => !Number.isNaN(x))
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
  }
  const recall: Record<number, number> = {}
  const xRecall: Record<number, number> = {}
  for (const k of CUTOFFS) {
    recall[k] = avg(rows.map((r) => r.recall[k]))
    xRecall[k] = avg(rows.map((r) => r.xRecall[k]))
  }
  return { recall, xRecall, ndcg10: avg(rows.map((r) => r.ndcg10)), mrr: avg(rows.map((r) => r.mrr)), queries: rows.length }
}
