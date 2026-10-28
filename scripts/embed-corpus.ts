/**
 * Computes base-encoder embeddings for every patent (doc vector = mean of the
 * title+abstract and first-claim embeddings) and for every claim element.
 *
 * Run: pnpm tsx --env-file=.env.development.local scripts/embed-corpus.ts
 */
import { sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { claimElements, type IndependentClaim } from '@/lib/db/schema'
import { docEmbeddingText } from '@/lib/patents/adapter'
import { embedBase } from '@/lib/patents/embed'
import { l2normalize, mean, toPgVector } from '@/lib/patents/vector'

type Row = {
  pub_number: string
  title: string
  abstract: string | null
  first_claim: string | null
  independent_claims: IndependentClaim[]
}

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT pub_number, title, abstract, first_claim, independent_claims
     FROM patents WHERE embedding_base IS NULL`,
  )
  console.log(`embedding ${rows.length} patents`)

  for (let start = 0; start < rows.length; start += 64) {
    const batch = rows.slice(start, start + 64)
    const meta = await embedBase(batch.map(docEmbeddingText))
    const claims = await embedBase(batch.map((r) => r.first_claim ?? r.title))

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i]
      const vec = r.first_claim ? l2normalize(mean([meta[i], claims[i]])) : meta[i]
      await db.execute(
        sql`UPDATE patents SET embedding_base = ${toPgVector(vec)}::vector WHERE pub_number = ${r.pub_number}`,
      )

      const elements = r.independent_claims.flatMap((c) =>
        c.elements.map((text, idx) => ({ claimNo: c.number, idx, text })),
      )
      if (!elements.length) continue
      const vecs = await embedBase(elements.map((e) => e.text))
      await db.delete(claimElements).where(sql`${claimElements.pubNumber} = ${r.pub_number}`)
      await db.insert(claimElements).values(
        elements.map((e, j) => ({
          pubNumber: r.pub_number,
          claimNo: e.claimNo,
          elementIdx: e.idx,
          text: e.text,
          embedding: Array.from(vecs[j]),
        })),
      )
    }
    console.log(`  ${Math.min(start + 64, rows.length)}/${rows.length}`)
  }
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
