/**
 * Embeds every passage with the base encoder (resumable: only rows with NULL embedding),
 * then sets each document's base embedding to the normalised mean of its passages.
 *
 * Run: pnpm tsx --env-file=.env.development.local scripts/embed-corpus.ts [shard] [shards]
 */
import { pool } from '@/lib/db'
import { embedBase } from '@/lib/patents/embed'
import { fromPgVector, l2normalize, mean, toPgVector } from '@/lib/patents/vector'

const shard = Number(process.argv[2] ?? 0)
const shards = Number(process.argv[3] ?? 1)
const PAGE = 1024

async function embedPassages() {
  const { rows: count } = await pool.query<{ n: string }>(
    `SELECT count(*) n FROM passages WHERE embedding IS NULL AND id % $1 = $2`,
    [shards, shard],
  )
  const total = Number(count[0].n)
  let done = 0
  const started = Date.now()
  for (;;) {
    const { rows } = await pool.query<{ id: number; text: string }>(
      `SELECT id, text FROM passages WHERE embedding IS NULL AND id % $1 = $2 ORDER BY id LIMIT $3`,
      [shards, shard, PAGE],
    )
    if (!rows.length) break
    const vecs = await embedBase(rows.map((r) => r.text))
    await pool.query(
      `UPDATE passages p SET embedding = v.e::vector
       FROM unnest($1::int[], $2::text[]) AS v(id, e) WHERE p.id = v.id`,
      [rows.map((r) => r.id), vecs.map(toPgVector)],
    )
    done += rows.length
    const rate = done / ((Date.now() - started) / 1000)
    console.log(`[shard ${shard}] ${done}/${total} passages, ${rate.toFixed(1)}/s, eta ${((total - done) / rate / 60).toFixed(1)} min`)
  }
}

async function poolDocuments() {
  const { rows } = await pool.query<{ doc_id: string; embedding: string }>(
    `SELECT doc_id, embedding::text FROM passages WHERE embedding IS NOT NULL ORDER BY doc_id, idx`,
  )
  const byDoc = new Map<string, Float32Array[]>()
  for (const r of rows) {
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, [])
    byDoc.get(r.doc_id)!.push(fromPgVector(r.embedding))
  }
  const ids = [...byDoc.keys()]
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    await pool.query(
      `UPDATE documents d SET embedding_base = v.e::vector, embedding_adapted = v.e::vector
       FROM unnest($1::text[], $2::text[]) AS v(id, e) WHERE d.doc_id = v.id`,
      [chunk, chunk.map((id) => toPgVector(l2normalize(mean(byDoc.get(id)!))))],
    )
  }
  console.log(`pooled ${ids.length} document embeddings`)
}

async function main() {
  await embedPassages()
  if (shard === 0) {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*) n FROM passages WHERE embedding IS NULL`)
    if (Number(rows[0].n) === 0) await poolDocuments()
    else console.log(`${rows[0].n} passages still pending in other shards; rerun shard 0 to pool documents`)
  }
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
