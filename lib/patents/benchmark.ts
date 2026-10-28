import { pool } from '@/lib/db'
import { fromPgVector } from './vector'
import { splitOf, type Split } from './splits'

export type BenchQuery = { appId: string; claim: string; split: Split; qrels: Map<string, number> }
export type BenchDoc = { docId: string; base: Float32Array }

export async function loadBenchmark() {
  const [{ rows: q }, { rows: r }, { rows: d }] = await Promise.all([
    pool.query<{ app_id: string; claim: string; split: string }>(`SELECT app_id, claim, split FROM queries ORDER BY app_id`),
    pool.query<{ app_id: string; doc_id: string; grade: number }>(`SELECT app_id, doc_id, grade FROM qrels`),
    pool.query<{ doc_id: string; embedding_base: string }>(
      `SELECT doc_id, embedding_base::text FROM documents WHERE embedding_base IS NOT NULL ORDER BY doc_id`,
    ),
  ])
  const qrels = new Map<string, Map<string, number>>()
  for (const row of r) {
    if (!qrels.has(row.app_id)) qrels.set(row.app_id, new Map())
    qrels.get(row.app_id)!.set(row.doc_id, row.grade)
  }
  const queries: BenchQuery[] = q.map((row) => ({
    appId: row.app_id,
    claim: row.claim,
    split: splitOf(row),
    qrels: qrels.get(row.app_id) ?? new Map(),
  }))
  const docs: BenchDoc[] = d.map((row) => ({ docId: row.doc_id, base: fromPgVector(row.embedding_base) }))
  return { queries, docs }
}

/** Every document cited for a test query; excluded from training so the test signal stays clean. */
export function testGroundTruth(queries: BenchQuery[]) {
  return new Set(queries.filter((q) => q.split === 'test').flatMap((q) => [...q.qrels.keys()]))
}
