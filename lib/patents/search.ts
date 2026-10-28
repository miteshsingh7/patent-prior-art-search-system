import { pool } from '@/lib/db'
import { applyAdapter } from './adapter'
import { splitClaimElements } from './claims'
import { embedBase } from './embed'
import { elementOverlap, fuse, RERANK, sharedTerms } from './overlap'
import { fromPgVector, toPgVector } from './vector'

export type SearchMode = 'keyword' | 'base' | 'adapted'

export type SearchHit = {
  docId: string
  preview: string
  rank: number
  firstStageRank: number
  dense: number
  coverage: number | null
  score: number
  matches: {
    element: number
    passage: string
    similarity: number
    covered: boolean
    terms: string[]
  }[]
}

export type SearchResponse = {
  mode: SearchMode
  rerank: boolean
  elements: string[]
  hits: SearchHit[]
  timings: Record<string, number>
}

const DENSE_COLUMN = { base: 'embedding_base', adapted: 'embedding_adapted' } as const

export async function keywordSearch(claim: string, k: number) {
  const { rows } = await pool.query<{ doc_id: string; score: number }>(
    `WITH q AS (
       SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) AS q
       FROM unnest(to_tsvector('english', $1))
     )
     SELECT doc_id, ts_rank_cd(tsv, q.q, 1)::float8 AS score
     FROM documents, q WHERE tsv @@ q.q
     ORDER BY score DESC LIMIT $2`,
    [claim, k],
  )
  return rows.map((r) => ({ docId: r.doc_id, score: Number(r.score) }))
}

export async function denseSearch(vec: Float32Array, mode: 'base' | 'adapted', k: number) {
  const col = DENSE_COLUMN[mode]
  const { rows } = await pool.query<{ doc_id: string; score: number }>(
    `SELECT doc_id, (1 - (${col} <=> $1::vector))::float8 AS score
     FROM documents WHERE ${col} IS NOT NULL
     ORDER BY ${col} <=> $1::vector LIMIT $2`,
    [toPgVector(vec), k],
  )
  return rows.map((r) => ({ docId: r.doc_id, score: Number(r.score) }))
}

export async function searchClaim(
  claim: string,
  { mode = 'adapted', rerank = true, k = 25 }: { mode?: SearchMode; rerank?: boolean; k?: number } = {},
): Promise<SearchResponse> {
  const timings: Record<string, number> = {}
  let t = performance.now()
  const lap = (name: string) => {
    const now = performance.now()
    timings[name] = Math.round(now - t)
    t = now
  }

  const elements = splitClaimElements(claim)
  const [claimVec, ...elementVecs] = await embedBase([claim, ...elements])
  lap('embed')

  const depth = rerank ? Math.max(RERANK.depth, k) : k
  const first =
    mode === 'keyword'
      ? await keywordSearch(claim, depth)
      : await denseSearch(mode === 'adapted' ? applyAdapter(claimVec) : claimVec, mode, depth)
  lap('retrieve')

  const ids = first.map((h) => h.docId)
  const [{ rows }, { rows: previewRows }] = await Promise.all([
    pool.query<{ doc_id: string; text: string; embedding: string }>(
      `SELECT doc_id, text, embedding::text FROM passages
       WHERE doc_id = ANY($1) AND embedding IS NOT NULL ORDER BY doc_id, idx`,
      [ids],
    ),
    pool.query<{ doc_id: string; preview: string }>(`SELECT doc_id, preview FROM documents WHERE doc_id = ANY($1)`, [ids]),
  ])
  const previews = new Map(previewRows.map((r) => [r.doc_id, r.preview]))
  const byDoc = new Map<string, { texts: string[]; vecs: Float32Array[] }>()
  for (const r of rows) {
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, { texts: [], vecs: [] })
    const d = byDoc.get(r.doc_id)!
    d.texts.push(r.text)
    d.vecs.push(fromPgVector(r.embedding))
  }
  lap('passages')

  const maxKeyword = mode === 'keyword' ? Math.max(...first.map((h) => h.score), 1e-9) : 1
  const scored = first.map((h, i) => {
    const doc = byDoc.get(h.docId)
    const overlap = doc ? elementOverlap(elementVecs, doc.vecs) : null
    const dense = h.score / maxKeyword
    const coverage = overlap?.coverage ?? null
    return {
      docId: h.docId,
      preview: previews.get(h.docId) ?? '',
      firstStageRank: i + 1,
      dense,
      coverage,
      score: rerank ? fuse(dense, coverage ?? 0) : dense,
      matches: (overlap?.matches ?? []).map((m) => ({
        element: m.element,
        passage: doc!.texts[m.passage],
        similarity: m.similarity,
        covered: m.covered,
        terms: sharedTerms(elements[m.element], doc!.texts[m.passage]),
      })),
    }
  })
  if (rerank) scored.sort((a, b) => b.score - a.score)
  lap('rerank')

  return {
    mode,
    rerank,
    elements,
    hits: scored.slice(0, k).map((h, i) => ({ ...h, rank: i + 1 })),
    timings,
  }
}
