import type { FeatureExtractionPipeline } from '@huggingface/transformers'

export const BASE_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const EMBED_DIM = 384

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // transformers loads onnxruntime-node via createRequire, which output file tracing cannot follow.
      // Importing it by name here makes the build bundle the native runtime into the function.
      await import('onnxruntime-node')
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = '/tmp/hf-cache'
      env.allowLocalModels = false
      return pipeline('feature-extraction', BASE_MODEL, { dtype: 'q8' })
    })()
    extractorPromise.catch(() => {
      extractorPromise = null
    })
  }
  return extractorPromise
}

const MAX_CHARS = 1400

/**
 * Mean-pooled, L2-normalised sentence embeddings from the base encoder.
 * Inputs are batched in length order so padding stays small, then returned in input order.
 */
export async function embedBase(texts: string[], batchSize = 32): Promise<Float32Array[]> {
  const extractor = await getExtractor()
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length)
  const out = new Array<Float32Array>(texts.length)
  for (let i = 0; i < order.length; i += batchSize) {
    const idx = order.slice(i, i + batchSize)
    const batch = idx.map((k) => texts[k].slice(0, MAX_CHARS))
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
    const data = tensor.data as Float32Array
    idx.forEach((k, j) => {
      out[k] = data.slice(j * EMBED_DIM, (j + 1) * EMBED_DIM)
    })
  }
  return out
}
