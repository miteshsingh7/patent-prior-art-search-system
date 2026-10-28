import { pool } from '@/lib/db'
import { SearchWorkbench } from '@/components/search/search-workbench'

export const dynamic = 'force-dynamic'

async function getCorpus() {
  const { rows } = await pool.query<{ docs: number; passages: number }>(
    `SELECT (SELECT count(*) FROM documents)::int AS docs, (SELECT count(*) FROM passages)::int AS passages`,
  )
  return rows[0] ?? { docs: 0, passages: 0 }
}

export default async function Page() {
  const corpus = await getCorpus()
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10">
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Semantic prior-art search for patent claims
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          Retrieval by conceptual similarity rather than shared keywords, with an element-by-element claim chart for
          every candidate. Corpus: {corpus.docs.toLocaleString()} documents cited in EPO search reports.
        </p>
      </div>
      <SearchWorkbench corpus={corpus} />
    </main>
  )
}
