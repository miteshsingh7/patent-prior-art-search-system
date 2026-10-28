import { NextResponse } from 'next/server'
import { z } from 'zod'
import { pool } from '@/lib/db'
import { claimHash } from '@/lib/patents/hash'

export const runtime = 'nodejs'

const Body = z.object({
  claim: z.string().trim().min(40).max(8000),
  docId: z.string().trim().min(2).max(40),
  grade: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  rank: z.number().int().min(1).max(500),
})

/** Examiner relevance judgment for one retrieved candidate: 2 = novelty-relevant (X), 1 = background (A), 0 = not relevant. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid judgment' }, { status: 400 })
  const { claim, docId, grade, rank } = parsed.data
  const hash = claimHash(claim)

  const { rows } = await pool.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM documents WHERE doc_id = $1)`, [docId])
  if (!rows[0]?.exists) return NextResponse.json({ error: 'Unknown document' }, { status: 404 })

  await pool.query(
    `WITH removed AS (DELETE FROM judgments WHERE query_hash = $1 AND candidate = $3)
     INSERT INTO judgments (query_hash, query_excerpt, candidate, grade, rank) VALUES ($1, $2, $3, $4, $5)`,
    [hash, claim.slice(0, 240), docId, grade, rank],
  )
  return NextResponse.json({ ok: true })
}
