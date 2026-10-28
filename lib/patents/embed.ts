import type { FeatureExtractionPipeline } from '@huggingface/transformers'

export const BASE_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const EMBED_DIM = 384

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
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

/** Mean-pooled, L2-normalised sentence embeddings from the base encoder. */
export async function embedBase(texts: string[], batchSize = 32): Promise<Float32Array[]> {
  const extractor = await getExtractor()
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
    const data = tensor.data as Float32Array
    for (let j = 0; j < batch.length; j++) {
      out.push(data.slice(j * EMBED_DIM, (j + 1) * EMBED_DIM))
    }
  }
  return out
}
