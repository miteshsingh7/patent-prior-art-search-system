const VAL_FRACTION = 0.2

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

/** Deterministic held-out slice of the train split, used for early stopping and λ tuning. */
export function isValidation(appId: string) {
  return (hash(appId) % 1000) / 1000 < VAL_FRACTION
}

export type Split = 'train' | 'val' | 'test'

export function splitOf(row: { app_id: string; split: string }): Split {
  if (row.split === 'test') return 'test'
  return isValidation(row.app_id) ? 'val' : 'train'
}
