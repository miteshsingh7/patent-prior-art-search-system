import {
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

/** Prior-art corpus: every document an EPO examiner cited, represented by its cited passages. */
export const documents = pgTable('documents', {
  docId: text('doc_id').primaryKey(),
  preview: text('preview').notNull(),
  fullText: text('full_text').notNull(),
  nPassages: integer('n_passages').notNull(),
  embeddingBase: vector('embedding_base', { dimensions: 384 }),
  embeddingAdapted: vector('embedding_adapted', { dimensions: 384 }),
})

export const passages = pgTable('passages', {
  id: serial('id').primaryKey(),
  docId: text('doc_id').notNull(),
  idx: integer('idx').notNull(),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 384 }),
})

/** One independent claim per EP application (the search target). */
export const queries = pgTable('queries', {
  appId: text('app_id').primaryKey(),
  claim: text('claim').notNull(),
  appDate: text('app_date'),
  split: text('split').notNull(),
})

/** Examiner citations from the search report: grade 2 = X (novelty-destroying), 1 = A (background). */
export const qrels = pgTable(
  'qrels',
  {
    appId: text('app_id').notNull(),
    docId: text('doc_id').notNull(),
    grade: smallint('grade').notNull(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.docId] })],
)

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
