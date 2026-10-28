import type { SearchHit, SearchMode, SearchResponse } from './search'

export type { SearchHit, SearchMode }

export type SearchResult = SearchResponse & {
  citations: Record<string, number>
  judgments: Record<string, number>
}

export type SampleClaim = {
  appId: string
  claim: string
  appDate: string | null
  citations: number
  xCitations: number
}

export const MODE_LABELS: Record<SearchMode, { label: string; hint: string }> = {
  keyword: { label: 'Keyword', hint: 'Postgres full-text ranking over shared vocabulary' },
  base: { label: 'Base embeddings', hint: 'General-purpose MiniLM sentence encoder' },
  adapted: { label: 'Patent-adapted', hint: 'Encoder adapted on examiner citation pairs' },
}

export function espacenetUrl(docId: string) {
  return `https://worldwide.espacenet.com/patent/search?q=pn%3D${encodeURIComponent(docId)}`
}

export async function postJson<T>(url: string, { arg }: { arg: unknown }): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}
