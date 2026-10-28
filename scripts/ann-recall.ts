/**
 * Measures how faithfully the HNSW index reproduces exact nearest-neighbour search
 * on the held-out test claims, and records the result for the benchmark page.
 *
 *   npx tsx --env-file=.env.development.local scripts/ann-recall.ts
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pool } from '@/lib/db'
import { applyAdapter } from '@/lib/patents/adapter'
import { embedBase } from '@/lib/patents/embed'
import { denseSearch } from '@/lib/patents/search'

const K = 100

async function main() {
  const { rows } = await pool.query<{ claim: string }>(`SELECT claim FROM queries WHERE split = 'test' ORDER BY app_id`)
  const claimVecs = await embedBase(rows.map((r) => r.claim))

  const { rows: plan } = await pool.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN SELECT doc_id FROM documents ORDER BY embedding_adapted <=> (SELECT embedding_adapted FROM documents LIMIT 1) LIMIT ${K}`,
  )
  const usesIndex = plan.some((p) => p['QUERY PLAN'].includes('hnsw'))

  const result: Record<string, { recall: number; annMs: number; exactMs: number }> = {}
  for (const mode of ['base', 'adapted'] as const) {
    let overlap = 0
    let annMs = 0
    let exactMs = 0
    for (const v of claimVecs) {
      const q = mode === 'adapted' ? applyAdapter(v) : v
      let t = performance.now()
      const ann = await denseSearch(q, mode, K)
      annMs += performance.now() - t
      t = performance.now()
      const exact = await denseSearch(q, mode, K, { exact: true })
      exactMs += performance.now() - t
      const truth = new Set(exact.map((h) => h.docId))
      overlap += ann.filter((h) => truth.has(h.docId)).length / truth.size
    }
    const n = claimVecs.length
    result[mode] = {
      recall: Number((overlap / n).toFixed(4)),
      annMs: Math.round(annMs / n),
      exactMs: Math.round(exactMs / n),
    }
    console.log(`${mode}: HNSW recall@${K} vs exact = ${result[mode].recall} (ann ${result[mode].annMs}ms, exact ${result[mode].exactMs}ms)`)
  }

  const out = { k: K, queries: claimVecs.length, usesIndex, index: 'hnsw m=16 ef_construction=128 ef_search=200', ...result }
  writeFileSync(path.join(process.cwd(), 'lib/patents/ann-check.json'), JSON.stringify(out, null, 2) + '\n')
  console.log('index used by planner:', usesIndex)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
