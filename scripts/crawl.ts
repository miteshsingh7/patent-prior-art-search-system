/**
 * Builds the evaluation corpus from Google Patents public pages.
 *   targets      — granted US patents (priority 2016–2019) used as queries
 *   cited        — their US backward citations (ground truth prior art)
 *   similar      — Google "similar documents" (hard negatives)
 *   distractor   — older same-domain patents (hard negatives)
 *
 * Run: pnpm tsx --env-file=.env.development.local scripts/crawl.ts
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { citations, evalTargets, patents } from '@/lib/db/schema'
import { parsePatentPage, type ParsedPatent } from '@/lib/patents/parse'

const TOPICS = [
  'lidar detector array time of flight',
  'lithium ion battery silicon anode',
  'neural network accelerator matrix multiplication',
  'drug eluting stent polymer coating',
  'phased array antenna beamforming millimeter wave',
  'wind turbine blade pitch control',
]
const TARGETS_PER_TOPIC = 12
const MIN_US_CITATIONS = 6
const MAX_CITED_PER_TARGET = 20
const SIMILAR_PER_TARGET = 4
const DISTRACTORS_PER_TOPIC = 40
const TEST_FRACTION = 0.35
const CACHE_DIR = '/tmp/gp-cache'
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

mkdirSync(CACHE_DIR, { recursive: true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url: string, attempt = 0): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.status === 404) return null
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
    if (!res.ok) return null
    return await res.text()
  } catch (err) {
    if (attempt >= 4) {
      console.warn('give up', url, (err as Error).message)
      return null
    }
    await sleep(1500 * 2 ** attempt)
    return fetchText(url, attempt + 1)
  }
}

const parsedCache = new Map<string, ParsedPatent | null>()

async function getPatent(pub: string): Promise<ParsedPatent | null> {
  if (parsedCache.has(pub)) return parsedCache.get(pub)!
  const file = `${CACHE_DIR}/${pub}.html`
  let html: string | null = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (!html) {
    html = await fetchText(`https://patents.google.com/patent/${pub}/en`)
    if (html) writeFileSync(file, html)
  }
  const parsed = html ? parsePatentPage(pub, html) : null
  parsedCache.set(pub, parsed)
  return parsed
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i])
        done++
        if (done % 50 === 0) console.log(`  ${done}/${items.length}`)
      }
    }),
  )
  return results
}

async function searchPubs(query: string, after: string, before: string, num: number) {
  const inner = `q=(${query})&country=US&status=GRANT&language=ENGLISH&after=priority:${after}&before=priority:${before}&num=${num}`
  const raw = await fetchText(
    `https://patents.google.com/xhr/query?url=${encodeURIComponent(inner)}&exp=`,
  )
  if (!raw) return []
  const data = JSON.parse(raw)
  const results = data?.results?.cluster?.[0]?.result ?? []
  return results.map((r: { patent: { publication_number: string } }) => r.patent.publication_number)
}

async function upsertPatent(p: ParsedPatent, role: string) {
  await db
    .insert(patents)
    .values({
      pubNumber: p.pubNumber,
      title: p.title,
      abstract: p.abstract,
      assignee: p.assignee,
      priorityDate: p.priorityDate,
      publicationDate: p.publicationDate,
      cpc: p.cpc,
      firstClaim: p.independentClaims[0]?.text ?? null,
      independentClaims: p.independentClaims,
      role,
    })
    .onConflictDoUpdate({
      target: patents.pubNumber,
      set: {
        title: p.title,
        abstract: p.abstract,
        independentClaims: p.independentClaims,
        firstClaim: p.independentClaims[0]?.text ?? null,
        role: sql`CASE WHEN patents.role = 'target' THEN 'target' ELSE ${role} END`,
      },
    })
  if (p.citations.length) {
    await db
      .insert(citations)
      .values(p.citations.map((c) => ({ citing: p.pubNumber, cited: c.pubNumber, examinerCited: c.examinerCited })))
      .onConflictDoNothing()
  }
}

async function main() {
  const targets: ParsedPatent[] = []
  const distractorPubs = new Set<string>()

  for (const topic of TOPICS) {
    console.log(`topic: ${topic}`)
    const candidates: string[] = await searchPubs(topic, '20160101', '20191231', 60)
    const parsed = await mapPool(candidates, 4, getPatent)
    const good = parsed.filter(
      (p): p is ParsedPatent =>
        !!p && p.independentClaims.length > 0 && p.citations.length >= MIN_US_CITATIONS,
    )
    targets.push(...good.slice(0, TARGETS_PER_TOPIC))
    console.log(`  targets: ${Math.min(good.length, TARGETS_PER_TOPIC)} / ${candidates.length}`)
    const older: string[] = await searchPubs(topic, '20050101', '20151231', DISTRACTORS_PER_TOPIC)
    older.forEach((p) => distractorPubs.add(p))
  }

  const targetSet = new Set(targets.map((t) => t.pubNumber))
  const cited = new Set<string>()
  const similar = new Set<string>()
  for (const t of targets) {
    const ordered = [...t.citations].sort((a, b) => Number(b.examinerCited) - Number(a.examinerCited))
    ordered.slice(0, MAX_CITED_PER_TARGET).forEach((c) => cited.add(c.pubNumber))
    t.similar.slice(0, SIMILAR_PER_TARGET).forEach((s) => similar.add(s))
  }

  const toFetch = [
    ...[...cited].map((p) => [p, 'cited'] as const),
    ...[...similar].filter((p) => !cited.has(p)).map((p) => [p, 'similar'] as const),
    ...[...distractorPubs].filter((p) => !cited.has(p) && !similar.has(p)).map((p) => [p, 'distractor'] as const),
  ].filter(([p]) => !targetSet.has(p))
  console.log(`fetching ${toFetch.length} corpus documents`)

  for (const t of targets) await upsertPatent(t, 'target')
  let stored = 0
  await mapPool(toFetch, 5, async ([pub, role]) => {
    const p = await getPatent(pub)
    if (!p) return
    await upsertPatent(p, role)
    stored++
  })

  // Deterministic split: hash of the publication number.
  const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  await db
    .insert(evalTargets)
    .values(
      targets.map((t) => ({
        pubNumber: t.pubNumber,
        split: (hash(t.pubNumber) % 1000) / 1000 < TEST_FRACTION ? 'test' : 'train',
      })),
    )
    .onConflictDoNothing()

  console.log(`done: ${targets.length} targets, ${stored} corpus docs stored`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
