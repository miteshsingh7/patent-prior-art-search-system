import { parse, type HTMLElement } from 'node-html-parser'
import type { IndependentClaim } from '@/lib/db/schema'
import { normalizeWhitespace, splitClaimElements, stripClaimNumber } from './claims'

export type ParsedCitation = { pubNumber: string; examinerCited: boolean }

export type ParsedPatent = {
  pubNumber: string
  title: string
  abstract: string | null
  assignee: string | null
  priorityDate: string | null
  publicationDate: string | null
  cpc: string[]
  independentClaims: IndependentClaim[]
  citations: ParsedCitation[]
  similar: string[]
}

const US_PUB = /^US\d{6,11}[AB]\d?$/

function text(el: HTMLElement | null | undefined) {
  return el ? normalizeWhitespace(el.textContent) : ''
}

function meta(root: HTMLElement, name: string, scheme?: string) {
  const selector = scheme
    ? `meta[name="${name}"][scheme="${scheme}"]`
    : `meta[name="${name}"]`
  return root.querySelector(selector)?.getAttribute('content')?.trim() ?? null
}

function parseClaimElements(claimEl: HTMLElement, fullText: string): string[] {
  const outer = claimEl.querySelector('.claim-text')
  const nested = outer?.querySelectorAll(':scope > .claim-text') ?? []
  if (outer && nested.length >= 2) {
    const preambleNode = outer.clone() as HTMLElement
    preambleNode.querySelectorAll('.claim-text').forEach((n) => n.remove())
    const preamble = stripClaimNumber(text(preambleNode)).replace(/[:;,]\s*$/, '')
    const elements = nested
      .map((n) => text(n).replace(/[;,]\s*(and|or)?\s*$/i, '').replace(/\.\s*$/, ''))
      .filter((t) => t.split(' ').length >= 3)
    return (preamble ? [preamble, ...elements] : elements).slice(0, 25)
  }
  return splitClaimElements(fullText)
}

function parseClaims(root: HTMLElement): IndependentClaim[] {
  const section = root.querySelector('section[itemprop="claims"]')
  if (!section) return []
  const claims: IndependentClaim[] = []

  const claimNodes = section.querySelectorAll('div.claim[num], div.claim[id^="CLM"]')
  for (const node of claimNodes) {
    if (node.querySelector('claim-ref')) continue
    if (node.closest('.claim-dependent')) continue
    const full = stripClaimNumber(text(node))
    if (full.length < 40) continue
    if (/^(the|an?)\s.{0,80}\b(of|according to|as claimed in|as recited in)\s+claim\s+\d+/i.test(full)) continue
    const number = Number.parseInt(node.getAttribute('num') ?? '', 10) || claims.length + 1
    claims.push({ number, text: full, elements: parseClaimElements(node, full) })
    if (claims.length >= 3) break
  }

  if (claims.length === 0) {
    const raw = text(section).replace(/^Claims\s*\(\d+\)\s*/i, '')
    const first = raw.split(/\s(?=2\s*\.\s)/)[0]
    if (first.length > 40) {
      const full = stripClaimNumber(first)
      claims.push({ number: 1, text: full, elements: splitClaimElements(full) })
    }
  }
  return claims
}

function parseCpc(root: HTMLElement): string[] {
  const codes = new Set<string>()
  for (const leaf of root.querySelectorAll('meta[itemprop="Leaf"]')) {
    const code = text(leaf.parentNode?.querySelector('span[itemprop="Code"]'))
    if (code) codes.add(code)
    if (codes.size >= 8) break
  }
  return [...codes]
}

function parseCitations(root: HTMLElement): ParsedCitation[] {
  const found = new Map<string, boolean>()
  const rows = root.querySelectorAll(
    'tr[itemprop="backwardReferencesOrig"], tr[itemprop="backwardReferences"]',
  )
  for (const row of rows) {
    const pub = text(row.querySelector('span[itemprop="publicationNumber"]'))
    if (!US_PUB.test(pub)) continue
    const examiner = Boolean(row.querySelector('[itemprop="examinerCited"]'))
    found.set(pub, (found.get(pub) ?? false) || examiner)
  }
  return [...found].map(([pubNumber, examinerCited]) => ({ pubNumber, examinerCited }))
}

function parseSimilar(root: HTMLElement): string[] {
  return root
    .querySelectorAll('tr[itemprop="similarDocuments"] span[itemprop="publicationNumber"]')
    .map((el) => text(el))
    .filter((pub) => US_PUB.test(pub))
}

export function parsePatentPage(pubNumber: string, html: string): ParsedPatent | null {
  const root = parse(html)
  const title = meta(root, 'DC.title')
  if (!title) return null
  const abstractSection = root.querySelector('section[itemprop="abstract"] [itemprop="content"]')
  const priority =
    root.querySelector('time[itemprop="priorityDate"]')?.getAttribute('datetime') ?? null
  const issue =
    meta(root, 'DC.date', 'issue') ??
    root.querySelector('time[itemprop="publicationDate"]')?.getAttribute('datetime') ??
    null

  return {
    pubNumber,
    title: normalizeWhitespace(title),
    abstract: text(abstractSection) || null,
    assignee: meta(root, 'DC.contributor', 'assignee'),
    priorityDate: priority,
    publicationDate: issue,
    cpc: parseCpc(root),
    independentClaims: parseClaims(root),
    citations: parseCitations(root),
    similar: parseSimilar(root),
  }
}
