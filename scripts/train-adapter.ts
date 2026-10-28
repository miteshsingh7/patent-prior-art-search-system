/**
 * Domain-adapts the base sentence encoder to claim→prior-art retrieval by learning a
 * linear map W (d×d, initialised to identity) with an InfoNCE loss over examiner
 * citation pairs (application claim → cited document). In-batch positives plus random
 * corpus documents act as negatives; ||W − I||² keeps the map close to the base space.
 *
 * Leakage guard: test-split queries never contribute pairs, and no document cited for any
 * test query is used as a positive or a negative. Validation (hashed slice of the train
 * split) drives early stopping.
 *
 * Run: pnpm tsx --env-file=.env.development.local scripts/train-adapter.ts
 */
import { writeFileSync } from 'node:fs'
import { pool } from '@/lib/db'
import { ADAPTER_PATH, type AdapterFile } from '@/lib/patents/adapter'
import { loadBenchmark, testGroundTruth } from '@/lib/patents/benchmark'
import { BASE_MODEL, EMBED_DIM, embedBase } from '@/lib/patents/embed'
import { aggregate, scoreRanking } from '@/lib/patents/metrics'
import { toPgVector } from '@/lib/patents/vector'

const D = EMBED_DIM
const EPOCHS = Number(process.env.EPOCHS ?? 40)
const BATCH = 32
const RANDOM_NEGATIVES = 128
const TAU = 0.05
const LR = Number(process.env.LR ?? 1e-3)
const IDENTITY_PENALTY = Number(process.env.IDENTITY_PENALTY ?? 0.05)
const EVAL_EVERY = 2

let seed = 42
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function project(W: Float64Array, x: Float32Array) {
  const z = new Float64Array(D)
  for (let i = 0; i < D; i++) {
    let s = 0
    const r = i * D
    for (let j = 0; j < D; j++) s += W[r + j] * x[j]
    z[i] = s
  }
  const n = Math.sqrt(dot(z, z)) || 1
  const u = new Float64Array(D)
  for (let i = 0; i < D; i++) u[i] = z[i] / n
  return { u, n }
}

function evaluate(W: Float64Array, queries: { vec: Float32Array; qrels: Map<string, number> }[], docs: { docId: string; base: Float32Array }[]) {
  const projected = docs.map((d) => project(W, d.base).u)
  const rows = queries.map((q) => {
    const uq = project(W, q.vec).u
    const ranked = docs
      .map((d, i) => ({ id: d.docId, s: dot(uq, projected[i]) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 100)
      .map((x) => x.id)
    return scoreRanking(ranked, q.qrels)
  })
  return aggregate(rows)
}

async function main() {
  const { queries, docs } = await loadBenchmark()
  const docIndex = new Map(docs.map((d, i) => [d.docId, i]))
  const blocked = testGroundTruth(queries)
  const trainDocs = docs.filter((d) => !blocked.has(d.docId))

  const used = queries.filter((q) => q.split !== 'test')
  console.log(`embedding ${used.length} train/val claims`)
  const vecs = await embedBase(used.map((q) => q.claim))
  const withVec = used.map((q, i) => ({ ...q, vec: vecs[i] }))

  const train = withVec.filter((q) => q.split === 'train')
  const val = withVec.filter((q) => q.split === 'val' && [...q.qrels.keys()].some((d) => docIndex.has(d)))

  const pairs = train.flatMap((q) =>
    [...q.qrels.keys()].filter((d) => docIndex.has(d) && !blocked.has(d)).map((doc) => ({ q, doc })),
  )
  console.log(`train pairs ${pairs.length} from ${train.length} queries; val ${val.length}; negatives pool ${trainDocs.length}`)

  const W = new Float64Array(D * D)
  for (let i = 0; i < D; i++) W[i * D + i] = 1
  const baseVal = evaluate(W, val, docs)
  console.log(`val identity: R@10 ${baseVal.recall[10].toFixed(4)} R@100 ${baseVal.recall[100].toFixed(4)} nDCG@10 ${baseVal.ndcg10.toFixed(4)}`)

  const m = new Float64Array(D * D)
  const v = new Float64Array(D * D)
  let step = 0
  let best = { score: baseVal.recall[100] + baseVal.ndcg10, W: Float64Array.from(W), epoch: 0, val: baseVal }
  const lossCurve: number[] = []
  const valCurve: { epoch: number; recall100: number; ndcg10: number }[] = [
    { epoch: 0, recall100: baseVal.recall[100], ndcg10: baseVal.ndcg10 },
  ]

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    shuffle(pairs)
    let epochLoss = 0
    let batches = 0
    for (let b = 0; b < pairs.length; b += BATCH) {
      const batch = pairs.slice(b, b + BATCH)
      const candIds = batch.map((p) => p.doc)
      for (let r = 0; r < RANDOM_NEGATIVES; r++) candIds.push(trainDocs[Math.floor(rand() * trainDocs.length)].docId)
      const cands = [...new Set(candIds)]
      const candIdx = new Map(cands.map((p, i) => [p, i]))

      const Q = batch.map((p) => p.q.vec)
      const C = cands.map((id) => docs[docIndex.get(id)!].base)
      const PQ = Q.map((x) => project(W, x))
      const PC = C.map((x) => project(W, x))
      const gUq = PQ.map(() => new Float64Array(D))
      const gUc = PC.map(() => new Float64Array(D))
      let loss = 0

      for (let i = 0; i < batch.length; i++) {
        const target = candIdx.get(batch[i].doc)!
        const logits = new Float64Array(cands.length)
        let max = -Infinity
        for (let c = 0; c < cands.length; c++) {
          const masked = c !== target && batch[i].q.qrels.has(cands[c])
          logits[c] = masked ? -Infinity : dot(PQ[i].u, PC[c].u) / TAU
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
          for (let k = 0; k < D; k++) {
            gUq[i][k] += g * PC[c].u[k]
            gUc[c][k] += g * PQ[i].u[k]
          }
        }
      }

      const grad = new Float64Array(D * D)
      const accumulate = (gu: Float64Array, proj: { u: Float64Array; n: number }, x: Float32Array) => {
        const along = dot(gu, proj.u)
        for (let r = 0; r < D; r++) {
          const gz = (gu[r] - along * proj.u[r]) / proj.n
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
        W[k] -= (LR * (m[k] / (1 - b1 ** step))) / (Math.sqrt(v[k] / (1 - b2 ** step)) + 1e-8)
      }
      epochLoss += loss / batch.length
      batches++
    }
    lossCurve.push(Number((epochLoss / batches).toFixed(4)))
    if (epoch % EVAL_EVERY === 0) {
      const res = evaluate(W, val, docs)
      valCurve.push({ epoch, recall100: res.recall[100], ndcg10: res.ndcg10 })
      const score = res.recall[100] + res.ndcg10
      console.log(
        `epoch ${epoch} loss ${lossCurve.at(-1)} val R@10 ${res.recall[10].toFixed(4)} R@100 ${res.recall[100].toFixed(4)} nDCG@10 ${res.ndcg10.toFixed(4)}`,
      )
      if (score > best.score) best = { score, W: Float64Array.from(W), epoch, val: res }
    }
  }

  console.log(
    `best epoch ${best.epoch}: val R@100 ${best.val.recall[100].toFixed(4)} nDCG@10 ${best.val.ndcg10.toFixed(4)} (identity ${baseVal.recall[100].toFixed(4)} / ${baseVal.ndcg10.toFixed(4)})`,
  )
  const weights = Float32Array.from(best.W)
  const file: AdapterFile = {
    dim: D,
    weights: Buffer.from(weights.buffer).toString('base64'),
    meta: {
      trainedAt: new Date().toISOString(),
      baseModel: BASE_MODEL,
      trainQueries: train.length,
      trainPairs: pairs.length,
      epochs: best.epoch,
      temperature: TAU,
      identityPenalty: IDENTITY_PENALTY,
      lossCurve,
      valCurve,
      validation: {
        queries: val.length,
        baseRecall100: Number(baseVal.recall[100].toFixed(4)),
        adaptedRecall100: Number(best.val.recall[100].toFixed(4)),
        baseNdcg10: Number(baseVal.ndcg10.toFixed(4)),
        adaptedNdcg10: Number(best.val.ndcg10.toFixed(4)),
      },
    },
  }
  writeFileSync(ADAPTER_PATH, JSON.stringify(file))

  for (let i = 0; i < docs.length; i += 500) {
    const chunk = docs.slice(i, i + 500)
    await pool.query(
      `UPDATE documents d SET embedding_adapted = v.e::vector
       FROM unnest($1::text[], $2::text[]) AS v(id, e) WHERE d.doc_id = v.id`,
      [chunk.map((d) => d.docId), chunk.map((d) => toPgVector(project(best.W, d.base).u))],
    )
  }
  console.log(`wrote ${ADAPTER_PATH} and ${docs.length} adapted document embeddings`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
