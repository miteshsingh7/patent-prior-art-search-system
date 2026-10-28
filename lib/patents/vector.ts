export function l2normalize(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function mean(vectors: Float32Array[]): Float32Array {
  const out = new Float32Array(vectors[0].length)
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i] / vectors.length
  return out
}

export function toPgVector(v: ArrayLike<number>) {
  return `[${Array.from(v, (x) => x.toFixed(6)).join(',')}]`
}

export function fromPgVector(s: string | number[]): Float32Array {
  if (Array.isArray(s)) return Float32Array.from(s)
  return Float32Array.from(s.slice(1, -1).split(',').map(Number))
}
