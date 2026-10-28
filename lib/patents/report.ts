import { pool } from '@/lib/db'
import type { AdapterMeta } from './adapter'
import type { AggregateMetrics } from './metrics'

export const SYSTEM_ORDER = ['keyword', 'keyword_rerank', 'base', 'adapted', 'adapted_rerank'] as const
export type System = (typeof SYSTEM_ORDER)[number]

export const SYSTEM_LABELS: Record<System, { name: string; detail: string }> = {
  keyword: { name: 'Keyword', detail: 'Postgres full-text, ts_rank_cd' },
  keyword_rerank: { name: 'Keyword + element re-rank', detail: 'keyword top 100, re-ranked' },
  base: { name: 'Base embeddings', detail: 'all-MiniLM-L6-v2, no adaptation' },
  adapted: { name: 'Patent-adapted embeddings', detail: 'citation-trained linear adapter' },
  adapted_rerank: { name: 'Full pipeline', detail: 'adapted retrieval + element re-rank' },
}

export type EvalRun = {
  id: number
  createdAt: string
  nQueries: number
  results: {
    systems: Record<System, { val: AggregateMetrics; test: AggregateMetrics }>
    lambdaSweep: { lambda: number; ndcg10: number; recall10: number }[]
  }
  perQuery: {
    appId: string
    nRelevant: number
    nX: number
    systems: Record<System, { firstHit: number | null; recall100: number; ndcg10: number }>
  }[]
  config: {
    lambda: number
    depth: number
    coverThreshold: number
    tunedOn: string | null
    baseModel: string
    corpusDocs: number
    corpusPassages: number
    valQueries: number
    adapter: AdapterMeta | null
  }
}

export async function getLatestRun(): Promise<EvalRun | null> {
  const { rows } = await pool.query(
    `SELECT id, created_at, n_queries, results, per_query, config FROM eval_runs ORDER BY created_at DESC LIMIT 1`,
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    nQueries: r.n_queries,
    results: r.results,
    perQuery: r.per_query,
    config: r.config,
  }
}

export type JudgmentSummary = {
  total: number
  claims: number
  byGrade: Record<0 | 1 | 2, number>
  precisionAt: { k: number; judged: number; relevant: number }[]
  examiner: { citedJudged: number; citedAgreed: number; uncitedJudged: number; uncitedRelevant: number }
}

export async function getJudgmentSummary(): Promise<JudgmentSummary> {
  const { rows } = await pool.query<{
    grade: number
    rank: number
    query_hash: string
    cited: boolean | null
  }>(
    `WITH latest AS (
       SELECT DISTINCT ON (query_hash, candidate) query_hash, candidate, grade, rank
       FROM judgments ORDER BY query_hash, candidate, created_at DESC
     ),
     bench AS (
       SELECT app_id, encode(sha256(convert_to(regexp_replace(trim(claim), '\\s+', ' ', 'g'), 'UTF8')), 'hex') AS h
       FROM queries
     )
     SELECT l.grade, l.rank, l.query_hash,
            CASE WHEN b.app_id IS NULL THEN NULL ELSE EXISTS (
              SELECT 1 FROM qrels q WHERE q.app_id = b.app_id AND q.doc_id = l.candidate
            ) END AS cited
     FROM latest l LEFT JOIN bench b ON b.h = l.query_hash`,
  )
  const byGrade = { 0: 0, 1: 0, 2: 0 } as Record<0 | 1 | 2, number>
  for (const r of rows) byGrade[r.grade as 0 | 1 | 2]++
  const precisionAt = [5, 10, 25].map((k) => {
    const within = rows.filter((r) => r.rank <= k)
    return { k, judged: within.length, relevant: within.filter((r) => r.grade > 0).length }
  })
  const bench = rows.filter((r) => r.cited !== null)
  return {
    total: rows.length,
    claims: new Set(rows.map((r) => r.query_hash)).size,
    byGrade,
    precisionAt,
    examiner: {
      citedJudged: bench.filter((r) => r.cited).length,
      citedAgreed: bench.filter((r) => r.cited && r.grade > 0).length,
      uncitedJudged: bench.filter((r) => !r.cited).length,
      uncitedRelevant: bench.filter((r) => !r.cited && r.grade > 0).length,
    },
  }
}
