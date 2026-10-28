import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { EMBED_DIM } from './embed'
import { l2normalize } from './vector'

export type AdapterMeta = {
  trainedAt: string
  baseModel: string
  trainQueries: number
  trainPairs: number
  epochs: number
  temperature: number
  identityPenalty: number
  lossCurve: number[]
  valCurve: { epoch: number; recall100: number; ndcg10: number }[]
  validation: {
    queries: number
    baseRecall100: number
    adaptedRecall100: number
    baseNdcg10: number
    adaptedNdcg10: number
  }
}

export type AdapterFile = { dim: number; weights: string; meta: AdapterMeta }

export const ADAPTER_PATH = path.join(process.cwd(), 'lib/patents/adapter.json')

let cached: { W: Float32Array; meta: AdapterMeta | null } | null = null

export function loadAdapter() {
  if (cached) return cached
  if (existsSync(ADAPTER_PATH)) {
    const file = JSON.parse(readFileSync(ADAPTER_PATH, 'utf8')) as AdapterFile
    const buf = Buffer.from(file.weights, 'base64')
    const W = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
    cached = { W: Float32Array.from(W), meta: file.meta }
  } else {
    const W = new Float32Array(EMBED_DIM * EMBED_DIM)
    for (let i = 0; i < EMBED_DIM; i++) W[i * EMBED_DIM + i] = 1
    cached = { W, meta: null }
  }
  return cached
}

/** Applies the learned linear map W (row-major) and re-normalises. */
export function applyAdapter(x: Float32Array, W = loadAdapter().W): Float32Array {
  const d = EMBED_DIM
  const out = new Float32Array(d)
  for (let i = 0; i < d; i++) {
    let s = 0
    const row = i * d
    for (let j = 0; j < d; j++) s += W[row + j] * x[j]
    out[i] = s
  }
  return l2normalize(out)
}

export function docEmbeddingText(p: { title: string; abstract: string | null }) {
  return `${p.title}. ${p.abstract ?? ''}`.slice(0, 2000)
}
