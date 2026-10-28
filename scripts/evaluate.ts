/**
 * Recall@K / nDCG@10 / MRR against examiner citations for every retrieval stage.
 * λ (dense vs element-coverage fusion) and the element "covered" threshold are tuned on the
 * validation slice only, then frozen and applied to the untouched test split.
 *
 * Run: pnpm tsx --env-file=.env.development.local scripts/evaluate.ts
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pool } from '@/lib/db'
import { applyAdapter, loadAdapter } from '@/lib/patents/adapter'
import { loadBenchmark, type BenchQuery } from '@/lib/patents/benchmark'
import { splitClaimElements } from '@/lib/patents/claims'
import { BASE_MODEL, embedBase } from '@/lib/patents/embed'
import { aggregate, scoreRanking, type AggregateMetrics, type QueryMetrics } from '@/lib/patents/metrics'
import { elementOverlap, fuse, type RerankConfig } from '@/lib/patents/overlap'
import { keywordSearch } from '@/lib/patents/search'
import { dot, fromPgVector } from '@/lib/patents/vector'

const DEPTH = 100
const LAMBDAS = Array.from({ length: 17 }, (_, i) => Number((i * 0.05).toFixed(2)))

export const SYSTEMS = ['keyword', 'keyword_rerank', 'base', 'adapted', 'adapted_rerank'] as const
type System = (typeof SYSTEMS)[number]

type Prepared = {
  q: BenchQuery
  first: Record<'keyword' | 'base' | 'adapted', { docId: string; score: number }[]>
  coverage: Map<string, number>
  elementSims: { docId: string; sims: number[] }[]
}

function topK(vec: Float32Array, docs: { docId: string; vec: Float32Array }[], k: number) {
  return docs
    .map((d) => ({ docId: d.docId, score: dot(vec, d.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

function rerank(list: { docId: string; score: number }[], coverage: Map<string, number>, lambda: number) {
  const max = Math.max(...list.map((h) => h.score), 1e-9)
  const normalise = list.some((h) => h.score > 1)
  return list
    .map((h) => ({ docId: h.docId, s: fuse(normalise ? h.score / max : h.score, coverage.get(h.docId) ?? 0, lambda) }))
    .sort((a, b) => b.s - a.s)
    .map((h) => h.docId)
}

function rankingFor(p: Prepared, system: System, lambda: number): string[] {
  switch (system) {
    case 'keyword':
      return p.first.keyword.map((h) => h.docId)
    case 'base':
      return p.first.base.map((h) => h.docId)
    case 'adapted':
      return p.first.adapted.map((h) => h.docId)
    case 'adapted_rerank':
      return rerank(p.first.adapted, p.coverage, lambda)
    case 'keyword_rerank':
      return rerank(p.first.keyword, p.coverage, lambda)
  }
}

function evaluate(prepared: Prepared[], system: System, lambda: number) {
  const rows = prepared.map((p) => scoreRanking(rankingFor(p, system, lambda), p.q.qrels))
  return { agg: aggregate(rows), rows }
}

async function main() {
  const { queries, docs } = await loadBenchmark()
  const { meta } = loadAdapter()
  if (!meta) console.warn('no trained adapter found; "adapted" equals the base encoder')

  const baseDocs = docs.map((d) => ({ docId: d.docId, vec: d.base }))
  const adaptedDocs = docs.map((d) => ({ docId: d.docId, vec: applyAdapter(d.base) }))

  console.log('loading passage embeddings')
  const { rows: passageRows } = await pool.query<{ doc_id: string; embedding: string }>(
    `SELECT doc_id, embedding::text FROM passages WHERE embedding IS NOT NULL ORDER BY doc_id, idx`,
  )
  const passagesByDoc = new Map<string, Float32Array[]>()
  for (const r of passageRows) {
    if (!passagesByDoc.has(r.doc_id)) passagesByDoc.set(r.doc_id, [])
    passagesByDoc.get(r.doc_id)!.push(fromPgVector(r.embedding))
  }

  const evalQueries = queries.filter((q) => q.split !== 'train' && q.qrels.size > 0)
  const elements = evalQueries.map((q) => splitClaimElements(q.claim))
  console.log(`embedding ${evalQueries.length} claims and ${elements.flat().length} claim elements`)
  const claimVecs = await embedBase(evalQueries.map((q) => q.claim))
  const flatElementVecs = await embedBase(elements.flat())

  const prepared: Prepared[] = []
  let offset = 0
  for (const [i, q] of evalQueries.entries()) {
    const elementVecs = flatElementVecs.slice(offset, offset + elements[i].length)
    offset += elements[i].length
    const first = {
      keyword: await keywordSearch(q.claim, DEPTH),
      base: topK(claimVecs[i], baseDocs, DEPTH),
      adapted: topK(applyAdapter(claimVecs[i]), adaptedDocs, DEPTH),
    }
    const coverage = new Map<string, number>()
    const elementSims: Prepared['elementSims'] = []
    const candidates = new Set([...first.keyword, ...first.adapted].map((h) => h.docId))
    for (const docId of candidates) {
      const overlap = elementOverlap(elementVecs, passagesByDoc.get(docId) ?? [], 1)
      coverage.set(docId, overlap.coverage)
      elementSims.push({ docId, sims: overlap.matches.map((m) => m.similarity) })
    }
    prepared.push({ q, first, coverage, elementSims })
    if ((i + 1) % 50 === 0) console.log(`prepared ${i + 1}/${evalQueries.length}`)
  }

  const val = prepared.filter((p) => p.q.split === 'val')
  const test = prepared.filter((p) => p.q.split === 'test')

  const objective = (a: AggregateMetrics) => a.ndcg10 + a.recall[10]
  const sweep = LAMBDAS.map((lambda) => ({ lambda, agg: evaluate(val, 'adapted_rerank', lambda).agg }))
  const bestLambda = sweep.reduce((best, s) => (objective(s.agg) > objective(best.agg) ? s : best)).lambda
  console.log('λ sweep (val nDCG@10):', sweep.map((s) => `${s.lambda}:${s.agg.ndcg10.toFixed(3)}`).join(' '))
  console.log(`chosen λ = ${bestLambda}`)

  // Threshold maximising F1 of "element best-match ≥ t" as a predictor of an X/A-cited document.
  const samples: { sim: number; rel: boolean }[] = []
  for (const p of val)
    for (const e of p.elementSims) for (const sim of e.sims) samples.push({ sim, rel: p.q.qrels.has(e.docId) })
  let coverThreshold = 0.5
  let bestF1 = -1
  for (let t = 0.3; t <= 0.85; t += 0.01) {
    const tp = samples.filter((s) => s.rel && s.sim >= t).length
    const fp = samples.filter((s) => !s.rel && s.sim >= t).length
    const fn = samples.filter((s) => s.rel && s.sim < t).length
    const f1 = (2 * tp) / (2 * tp + fp + fn || 1)
    if (f1 > bestF1) {
      bestF1 = f1
      coverThreshold = Number(t.toFixed(2))
    }
  }
  console.log(`element coverage threshold = ${coverThreshold} (val F1 ${bestF1.toFixed(3)})`)

  const results: Record<System, { val: AggregateMetrics; test: AggregateMetrics }> = {} as never
  const testRows: Record<System, QueryMetrics[]> = {} as never
  for (const s of SYSTEMS) {
    const v = evaluate(val, s, bestLambda)
    const t = evaluate(test, s, bestLambda)
    results[s] = { val: v.agg, test: t.agg }
    testRows[s] = t.rows
    console.log(
      `${s.padEnd(15)} test R@10 ${t.agg.recall[10].toFixed(3)} R@50 ${t.agg.recall[50].toFixed(3)} R@100 ${t.agg.recall[100].toFixed(3)} X-R@10 ${t.agg.xRecall[10].toFixed(3)} nDCG@10 ${t.agg.ndcg10.toFixed(3)} MRR ${t.agg.mrr.toFixed(3)}`,
    )
  }

  const perQuery = test.map((p, i) => ({
    appId: p.q.appId,
    nRelevant: p.q.qrels.size,
    nX: [...p.q.qrels.values()].filter((g) => g === 2).length,
    systems: Object.fromEntries(
      SYSTEMS.map((s) => [s, { firstHit: testRows[s][i].firstHit, recall100: testRows[s][i].recall[100], ndcg10: testRows[s][i].ndcg10 }]),
    ),
  }))

  const config: RerankConfig = { lambda: bestLambda, depth: DEPTH, coverThreshold, tunedOn: `val (${val.length} queries)` }
  writeFileSync(path.join(process.cwd(), 'lib/patents/rerank-config.json'), `${JSON.stringify(config, null, 2)}\n`)

  await pool.query(
    `INSERT INTO eval_runs (split, n_queries, results, per_query, config) VALUES ('test', $1, $2, $3, $4)`,
    [
      test.length,
      JSON.stringify({ systems: results, lambdaSweep: sweep.map((s) => ({ lambda: s.lambda, ndcg10: s.agg.ndcg10, recall10: s.agg.recall[10] })) }),
      JSON.stringify(perQuery),
      JSON.stringify({
        ...config,
        baseModel: BASE_MODEL,
        corpusDocs: docs.length,
        corpusPassages: passageRows.length,
        valQueries: val.length,
        adapter: meta,
      }),
    ],
  )
  console.log('saved eval run')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
