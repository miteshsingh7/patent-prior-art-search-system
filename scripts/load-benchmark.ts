/**
 * Loads the PatentMatch-derived benchmark (output of prepare_patentmatch.py) into Postgres.
 * Run: pnpm tsx --env-file=.env.development.local scripts/load-benchmark.ts /tmp/pm/out
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pool } from '@/lib/db'

type Query = { app: string; claim: string; date: string; split: string; qrels: Record<string, number> }
type Doc = { doc: string; passages: string[] }

const dir = process.argv[2] ?? '/tmp/pm/out'
const CHUNK = 500

async function main() {
  const queries = JSON.parse(readFileSync(path.join(dir, 'queries.json'), 'utf8')) as Query[]
  const docs = JSON.parse(readFileSync(path.join(dir, 'docs.json'), 'utf8')) as Doc[]

  await pool.query('TRUNCATE qrels, queries, passages, documents RESTART IDENTITY CASCADE')

  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK)
    await pool.query(
      `INSERT INTO documents (doc_id, preview, full_text, n_passages)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])`,
      [
        chunk.map((d) => d.doc),
        chunk.map((d) => d.passages[0].slice(0, 400)),
        chunk.map((d) => d.passages.join('\n\n')),
        chunk.map((d) => d.passages.length),
      ],
    )
    const rows = chunk.flatMap((d) => d.passages.map((text, idx) => ({ doc: d.doc, idx, text })))
    await pool.query(
      `INSERT INTO passages (doc_id, idx, text)
       SELECT * FROM unnest($1::text[], $2::int[], $3::text[])`,
      [rows.map((r) => r.doc), rows.map((r) => r.idx), rows.map((r) => r.text)],
    )
    process.stdout.write(`\rdocuments ${Math.min(i + CHUNK, docs.length)}/${docs.length}`)
  }
  console.log()

  await pool.query(
    `INSERT INTO queries (app_id, claim, app_date, split)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])`,
    [queries.map((q) => q.app), queries.map((q) => q.claim), queries.map((q) => q.date), queries.map((q) => q.split)],
  )
  const qrels = queries.flatMap((q) => Object.entries(q.qrels).map(([doc, grade]) => ({ app: q.app, doc, grade })))
  await pool.query(
    `INSERT INTO qrels (app_id, doc_id, grade)
     SELECT * FROM unnest($1::text[], $2::text[], $3::smallint[])`,
    [qrels.map((r) => r.app), qrels.map((r) => r.doc), qrels.map((r) => r.grade)],
  )
  console.log(`queries ${queries.length}, qrels ${qrels.length}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
