import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core'

export type IndependentClaim = {
  number: number
  text: string
  elements: string[]
}

export const patents = pgTable('patents', {
  pubNumber: text('pub_number').primaryKey(),
  title: text('title').notNull(),
  abstract: text('abstract'),
  assignee: text('assignee'),
  priorityDate: date('priority_date'),
  publicationDate: date('publication_date'),
  cpc: text('cpc').array().notNull().default([]),
  firstClaim: text('first_claim'),
  independentClaims: jsonb('independent_claims')
    .$type<IndependentClaim[]>()
    .notNull()
    .default([]),
  role: text('role').notNull().default('corpus'),
  embeddingBase: vector('embedding_base', { dimensions: 384 }),
  embeddingAdapted: vector('embedding_adapted', { dimensions: 384 }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const claimElements = pgTable('claim_elements', {
  id: serial('id').primaryKey(),
  pubNumber: text('pub_number').notNull(),
  claimNo: integer('claim_no').notNull(),
  elementIdx: integer('element_idx').notNull(),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 384 }),
})

export const citations = pgTable(
  'citations',
  {
    citing: text('citing').notNull(),
    cited: text('cited').notNull(),
    examinerCited: boolean('examiner_cited').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.citing, t.cited] })],
)

export const evalTargets = pgTable('eval_targets', {
  pubNumber: text('pub_number').primaryKey(),
  split: text('split').notNull(),
})

export const evalRuns = pgTable('eval_runs', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  split: text('split').notNull(),
  nQueries: integer('n_queries').notNull(),
  results: jsonb('results').notNull(),
  perQuery: jsonb('per_query').notNull(),
  config: jsonb('config').notNull().default({}),
})

export const judgments = pgTable('judgments', {
  id: serial('id').primaryKey(),
  queryHash: text('query_hash').notNull(),
  queryExcerpt: text('query_excerpt').notNull(),
  candidate: text('candidate').notNull(),
  grade: smallint('grade').notNull(),
  rank: integer('rank').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
