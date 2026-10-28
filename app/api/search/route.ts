import { NextResponse } from 'next/server'
import { z } from 'zod'
import { pool } from '@/lib/db'
import { claimHash } from '@/lib/patents/hash'
import { searchClaim } from '@/lib/patents/search'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  claim: z.string().trim().min(40, 'Paste a full claim (at least 40 characters).').max(8000),
  mode: z.enum(['keyword', 'base', 'adapted']).default('adapted'),
  rerank: z.boolean().default(true),
  appId: z.string().max(40).nullish(),
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const { claim, mode, rerank, appId } = parsed.data

  try {
    const [result, citations, judged] = await Promise.all([
      searchClaim(claim, { mode, rerank, k: 25 }),
      appId
        ? pool.query<{ doc_id: string; grade: number }>(
            `SELECT q.doc_id, q.grade FROM qrels q JOIN queries s USING (app_id) WHERE s.app_id = $1 AND s.claim = $2`,
            [appId, claim],
          )
        : Promise.resolve({ rows: [] as { doc_id: string; grade: number }[] }),
      pool.query<{ candidate: string; grade: number }>(
        `SELECT DISTINCT ON (candidate) candidate, grade FROM judgments WHERE query_hash = $1 ORDER BY candidate, created_at DESC`,
        [claimHash(claim)],
      ),
    ])
    return NextResponse.json({
      ...result,
      citations: Object.fromEntries(citations.rows.map((r) => [r.doc_id, r.grade])),
      judgments: Object.fromEntries(judged.rows.map((r) => [r.candidate, r.grade])),
    })
  } catch (err) {
    console.error('[search] failed', err)
    return NextResponse.json({ error: 'Search failed. Please try again.' }, { status: 500 })
  }
}
