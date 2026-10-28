import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A random held-out test claim, so results can be checked against the examiner's actual citations. */
export async function GET() {
  const { rows } = await pool.query<{ app_id: string; claim: string; app_date: string | null; n: number; nx: number }>(
    `SELECT q.app_id, q.claim, q.app_date,
            count(r.*)::int AS n, count(r.*) FILTER (WHERE r.grade = 2)::int AS nx
     FROM queries q JOIN qrels r USING (app_id)
     WHERE q.split = 'test' AND length(q.claim) BETWEEN 200 AND 1600
     GROUP BY q.app_id
     ORDER BY random() LIMIT 1`,
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'Benchmark not loaded' }, { status: 404 })
  return NextResponse.json({
    appId: row.app_id,
    claim: row.claim,
    appDate: row.app_date,
    citations: row.n,
    xCitations: row.nx,
  })
}
