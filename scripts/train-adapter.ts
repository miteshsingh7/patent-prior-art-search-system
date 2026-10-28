/**
 * Domain-adapts the base sentence encoder to patent claim→prior-art retrieval by
 * learning a linear map W (d×d, initialised to identity) with an InfoNCE loss over
 * citation pairs (citing claim → cited document). In-batch positives plus random
 * corpus documents act as negatives; ||W − I||² keeps the map close to the base space.
 *
 * Leakage guard: no pair touches a test-split target or any of its ground-truth docs.
 *
 * Run: pnpm tsx --env-file=.env.development.local scripts/train-adapter.ts
 */
import { writeFileSync } from 'node:fs'
import { pool } from '@/lib/db'
import { ADAPTER_PATH, type AdapterFile } from '@/lib/patents/adapter'
import { BASE_MODEL, EMBED_DIM, embedBase } from '@/lib/patents/embed'
import { fromPgVector, toPgVector } from '@/lib/patents/vector'

const D = EMBED_DIM
const EPOCHS = 60
const BATCH = 48
const RANDOM_NEGATIVES = 96
const TAU = 0.05
const LR = 2e-3
const IDENTITY_PENALTY = 0.02
const VAL_FRACTION = 0.25

type Doc = { pub: string; vec: Float32Array; priority: string | null }

let seed = 42
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function project(W: Float64Array, x: Float32Array) {
  const z = new Float64Array(D)
  for (let i = 0; i < D; i++) {
    let s = 0
    const r = i * D
    for (let j = 0; j < D; j++) s += W[r + j] * x[j]
    z[i] = s
  }
  let n = 0
  for (let i = 0; i < D; i++) n += z[i] * z[i]
  n = Math.sqrt(n) || 1
  const u = new Float64Array(D)
  for (let i = 0; i < D; i++) u[i] = z[i] / n
  return { u, n }
}

function recallAt(
  W: Float64Array,
  queries: { vec: Float32Array; positives: Set<string>; cutoff: string | null; self: string }[],
  docs: Doc[],
  k: number,
) {
  const projected = docs.map((d) => project(W, d.vec).u)
  let total = 0
  for (const q of queries) {
    const uq = project(W, q.vec).u
    const scored = docs
      .map((d, i) => ({ d, s: dotF(uq, projected[i]) }))
      .filter(({ d }) => d.pub !== q.self && (!q.cutoff || !d.priority || d.priority < q.cutoff))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
    const hits = scored.filter(({ d }) => q.positives.has(d.pub)).length
    total += hits / q.positives.size
  }
  return total / queries.length
}

const dotF = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

async function main() {
  const { rows: docRows } = await pool.query<{
    pub_number: string
    embedding_base: string
    priority_date: string | null
  }>(
    `SELECT pub_number, embedding_base::text, to_char(priority_date, 'YYYY-MM-DD') AS priority_date
     FROM patents WHERE embedding_base IS NOT NULL`,
  )
  const docs: Doc[] = docRows.map((r) => ({
    pub: r.pub_number,
    vec: fromPgVector(r.embedding_base),
    priority: r.priority_date,
  }))
  const docIndex = new Map(docs.map((d, i) => [d.pub, i]))

  const { rows: targetRows } = await pool.query<{ pub_number: string; split: string }>(
    `SELECT pub_number, split FROM eval_targets`,
  )
  const testTargets = new Set(targetRows.filter((r) => r.split === 'test').map((r) => r.pub_number))
  const trainTargets = targetRows.filter((r) => r.split === 'train').map((r) => r.pub_number)
  const hash = (s: string) => [...s].reduce((h, c) => (h * 131 + c.charCodeAt(0)) >>> 0, 3)
  const valTargets = new Set(trainTargets.filter((p) => (hash(p) % 100) / 100 < VAL_FRACTION))

  const { rows: citeRows } = await pool.query<{ citing: string; cited: string }>(
    `SELECT citing, cited FROM citations`,
  )
  const testGroundTruth = new Set(
    citeRows.filter((c) => testTargets.has(c.citing)).map((c) => c.cited),
  )
  const valGroundTruth = new Set(citeRows.filter((c) => valTargets.has(c.citing)).map((c) => c.cited))

  const blocked = (p: string) => testTargets.has(p) || testGroundTruth.has(p)
  const pairs = citeRows.filter(
    (c) =>
      docIndex.has(c.cited) &&
      !blocked(c.citing) &&
      !blocked(c.cited) &&
      !valTargets.has(c.citing) &&
      !valGroundTruth.has(c.cited),
  )

  const queryPubs = [...new Set([...pairs.map((p) => p.citing), ...valTargets])]
  const { rows: claimRows } = await pool.query<{
    pub_number: string
    first_claim: string | null
    priority_date: string | null
  }>(
    `SELECT pub_number, first_claim, to_char(priority_date, 'YYYY-MM-DD') AS priority_date
     FROM patents WHERE pub_number = ANY($1) AND first_claim IS NOT NULL`,
    [queryPubs],
  )
  console.log(`embedding ${claimRows.length} query claims`)
  const claimVecs = await embedBase(claimRows.map((r) => r.first_claim!))
  const queryVec = new Map(claimRows.map((r, i) => [r.pub_number, claimVecs[i]]))
  const queryPriority = new Map(claimRows.map((r) => [r.pub_number, r.priority_date]))

  const trainPairs = pairs.filter((p) => queryVec.has(p.citing))
  const positivesOf = new Map<string, Set<string>>()
  for (const p of trainPairs) {
    if (!positivesOf.has(p.citing)) positivesOf.set(p.citing, new Set())
    positivesOf.get(p.citing)!.add(p.cited)
  }

  const valQueries = [...valTargets]
    .filter((p) => queryVec.has(p))
    .map((p) => ({
      self: p,
      vec: queryVec.get(p)!,
      cutoff: queryPriority.get(p) ?? null,
      positives: new Set(
        citeRows.filter((c) => c.citing === p && docIndex.has(c.cited)).map((c) => c.cited),
      ),
    }))
    .filter((q) => q.positives.size > 0)

  console.log(
    `train pairs: ${trainPairs.length} from ${positivesOf.size} queries; val queries: ${valQueries.length}; docs: ${docs.length}`,
  )

  const W = new Float64Array(D * D)
  for (let i = 0; i < D; i++) W[i * D + i] = 1
  const baseRecall = recallAt(W, valQueries, docs, 50)
  console.log(`val Recall@50 (identity): ${baseRecall.toFixed(4)}`)

  const m = new Float64Array(D * D)
  const v = new Float64Array(D * D)
  let step = 0
  let best = { recall: baseRecall, W: Float64Array.from(W), epoch: 0 }
  const lossCurve: number[] = []

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    shuffle(trainPairs)
    let epochLoss = 0
    let batches = 0
    for (let b = 0; b < trainPairs.length; b += BATCH) {
      const batch = trainPairs.slice(b, b + BATCH)
      const candPubs = [...new Set(batch.map((p) => p.cited))]
      for (let r = 0; r < RANDOM_NEGATIVES; r++) candPubs.push(docs[Math.floor(rand() * docs.length)].pub)
      const cands = [...new Set(candPubs)]
      const candIdx = new Map(cands.map((p, i) => [p, i]))

      const Q = batch.map((p) => queryVec.get(p.citing)!)
      const C = cands.map((p) => docs[docIndex.get(p)!].vec)
      const PQ = Q.map((x) => project(W, x))
      const PC = C.map((x) => project(W, x))

      const gUq = PQ.map(() => new Float64Array(D))
      const gUc = PC.map(() => new Float64Array(D))
      let loss = 0

      for (let i = 0; i < batch.length; i++) {
        const own = positivesOf.get(batch[i].citing)!
        const target = candIdx.get(batch[i].cited)!
        const logits = new Float64Array(cands.length)
        let max = -Infinity
        for (let c = 0; c < cands.length; c++) {
          const masked = c !== target && (own.has(cands[c]) || cands[c] === batch[i].citing)
          logits[c] = masked ? -Infinity : dotF(PQ[i].u, PC[c].u) / TAU
          if (logits[c] > max) max = logits[c]
        }
        let sum = 0
        const p = new Float64Array(cands.length)
        for (let c = 0; c < cands.length; c++) {
          p[c] = Number.isFinite(logits[c]) ? Math.exp(logits[c] - max) : 0
          sum += p[c]
        }
        for (let c = 0; c < cands.length; c++) p[c] /= sum
        loss += -Math.log(p[target] + 1e-12)
        for (let c = 0; c < cands.length; c++) {
          const g = (p[c] - (c === target ? 1 : 0)) / TAU / batch.length
          if (g === 0) continue
          const uc = PC[c].u
          const uq = PQ[i].u
          for (let k = 0; k < D; k++) {
            gUq[i][k] += g * uc[k]
            gUc[c][k] += g * uq[k]
          }
        }
      }

      // Back-propagate through normalisation and the linear map.
      const grad = new Float64Array(D * D)
      const accumulate = (gu: Float64Array, proj: { u: Float64Array; n: number }, x: Float32Array) => {
        const proj_ = dotF(gu, proj.u)
        for (let r = 0; r < D; r++) {
          const gz = (gu[r] - proj_ * proj.u[r]) / proj.n
          if (gz === 0) continue
          const row = r * D
          for (let c = 0; c < D; c++) grad[row + c] += gz * x[c]
        }
      }
      for (let i = 0; i < batch.length; i++) accumulate(gUq[i], PQ[i], Q[i])
      for (let c = 0; c < cands.length; c++) accumulate(gUc[c], PC[c], C[c])
      for (let r = 0; r < D; r++)
        for (let c = 0; c < D; c++) {
          const idx = r * D + c
          grad[idx] += 2 * IDENTITY_PENALTY * (W[idx] - (r === c ? 1 : 0))
        }

      step++
      const b1 = 0.9
      const b2 = 0.999
      for (let k = 0; k < W.length; k++) {
        m[k] = b1 * m[k] + (1 - b1) * grad[k]
        v[k] = b2 * v[k] + (1 - b2) * grad[k] * grad[k]
        const mh = m[k] / (1 - b1 ** step)
        const vh = v[k] / (1 - b2 ** step)
        W[k] -= (LR * mh) / (Math.sqrt(vh) + 1e-8)
      }
      epochLoss += loss / batch.length
      batches++
    }
    lossCurve.push(Number((epochLoss / batches).toFixed(4)))
    if (epoch % 5 === 0) {
      const recall = recallAt(W, valQueries, docs, 50)
      console.log(`epoch ${epoch} loss ${lossCurve.at(-1)} val Recall@50 ${recall.toFixed(4)}`)
      if (recall > best.recall) best = { recall, W: Float64Array.from(W), epoch }
    }
  }

  console.log(`best epoch ${best.epoch}: val Recall@50 ${best.recall.toFixed(4)} (identity ${baseRecall.toFixed(4)})`)
  const weights = Float32Array.from(best.W)
  const file: AdapterFile = {
    dim: D,
    weights: Buffer.from(weights.buffer).toString('base64'),
    meta: {
      trainedAt: new Date().toISOString(),
      baseModel: BASE_MODEL,
      trainQueries: positivesOf.size,
      trainPairs: trainPairs.length,
      epochs: best.epoch,
      temperature: TAU,
      identityPenalty: IDENTITY_PENALTY,
      lossCurve,
      validation: {
        baseRecall50: Number(baseRecall.toFixed(4)),
        adaptedRecall50: Number(best.recall.toFixed(4)),
        queries: valQueries.length,
      },
      rerankLambda: 0.5,
    },
  }
  writeFileSync(ADAPTER_PATH, JSON.stringify(file))

  const pubs: string[] = []
  const vecs: string[] = []
  for (const d of docs) {
    const { u } = project(best.W, d.vec)
    pubs.push(d.pub)
    vecs.push(toPgVector(u))
  }
  for (let i = 0; i < pubs.length; i += 500) {
    await pool.query(
      `UPDATE patents p SET embedding_adapted = v.e::vector
       FROM unnest($1::text[], $2::text[]) AS v(pub, e) WHERE p.pub_number = v.pub`,
      [pubs.slice(i, i + 500), vecs.slice(i, i + 500)],
    )
  }
  console.log(`wrote ${ADAPTER_PATH} and ${pubs.length} adapted doc embeddings`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
