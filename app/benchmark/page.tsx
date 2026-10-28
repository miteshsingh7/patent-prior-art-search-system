import type { Metadata } from 'next'
import { HeadToHead } from '@/components/benchmark/head-to-head'
import { JudgmentPanel } from '@/components/benchmark/judgment-panel'
import { MetricsTable } from '@/components/benchmark/metrics-table'
import { TrainingPanel } from '@/components/benchmark/training-panel'
import { getJudgmentSummary, getLatestRun } from '@/lib/patents/report'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Benchmark — Claimline',
  description: 'Recall@K and nDCG against EPO examiner citations for keyword, base, and patent-adapted retrieval.',
}

export default async function BenchmarkPage() {
  const [run, judgments] = await Promise.all([getLatestRun(), getJudgmentSummary()])

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 md:px-6 md:py-10">
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Measured against what examiners actually cited
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          Every test claim comes from an EP application whose search report lists the prior art the examiner relied on.
          Those citations are the ground truth: X citations (novelty-destroying) count double in nDCG.
        </p>
      </div>

      {!run ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No evaluation run stored yet. Run <code className="font-mono text-foreground">scripts/evaluate.ts</code>.
        </p>
      ) : (
        <>
          <section aria-labelledby="results" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="results" className="text-base font-medium">
                Held-out test split
              </h2>
              <p className="font-mono text-xs text-muted-foreground">
                {run.nQueries} claims · {run.config.corpusDocs.toLocaleString()} docs ·{' '}
                {run.config.corpusPassages.toLocaleString()} passages · run {run.createdAt.slice(0, 10)}
              </p>
            </div>
            <MetricsTable run={run} />
          </section>

          <section aria-labelledby="analysis" className="flex flex-col gap-4">
            <h2 id="analysis" className="text-base font-medium">
              Where the gain comes from
            </h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <HeadToHead run={run} />
              <TrainingPanel run={run} />
            </div>
          </section>
        </>
      )}

      <section aria-labelledby="judged" className="flex flex-col gap-4">
        <h2 id="judged" className="text-base font-medium">
          Human review sample
        </h2>
        <JudgmentPanel summary={judgments} />
      </section>

      <section aria-labelledby="method" className="flex max-w-3xl flex-col gap-3">
        <h2 id="method" className="text-base font-medium">
          Method
        </h2>
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="text-foreground">Data.</span> PatentMatch (Risch et al., 2020), built from EPO search
            reports: one independent claim per application, and the passages the examiner cited from each prior-art
            document.
          </li>
          <li>
            <span className="text-foreground">Splits.</span> Applications are hashed into train / validation / test.
            Documents cited for any test claim are excluded from adapter training as both positives and negatives.
          </li>
          <li>
            <span className="text-foreground">Tuning.</span> Early stopping, λ and the disclosure threshold are chosen
            on validation only; the test split is scored once with frozen settings.
          </li>
          <li>
            <span className="text-foreground">Caveat.</span> The corpus is the union of cited documents, so every
            candidate is citable for some claim — a harder, more realistic distractor pool than random patents, but
            smaller than a full patent database.
          </li>
        </ul>
      </section>
    </main>
  )
}
