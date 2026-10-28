import Link from 'next/link'
import type { JudgmentSummary } from '@/lib/patents/report'

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

export function JudgmentPanel({ summary }: { summary: JudgmentSummary }) {
  if (!summary.total) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-5">
        <h3 className="text-sm font-medium">Examiner-judged relevance</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          No judgments yet. Run a search and grade candidates X, A or not relevant —{' '}
          <Link href="/" className="text-primary hover:underline">
            start with a test claim
          </Link>
          .
        </p>
      </div>
    )
  }
  const { examiner } = summary
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Examiner-judged relevance</h3>
        <p className="text-xs text-muted-foreground">
          {summary.total} candidates judged across {summary.claims} claims · X {summary.byGrade[2]} · A{' '}
          {summary.byGrade[1]} · not relevant {summary.byGrade[0]}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
        {summary.precisionAt.map((p) => (
          <div key={p.k} className="flex flex-col gap-1 bg-card p-3">
            <dt className="text-xs text-muted-foreground">Judged P@{p.k}</dt>
            <dd className="font-mono text-xl">{pct(p.relevant, p.judged)}</dd>
            <dd className="text-[11px] text-muted-foreground">n = {p.judged}</dd>
          </div>
        ))}
      </dl>
      {examiner.citedJudged + examiner.uncitedJudged > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          On benchmark claims, you agreed with the examiner on{' '}
          <span className="font-mono text-foreground">{pct(examiner.citedAgreed, examiner.citedJudged)}</span> of
          cited documents, and marked{' '}
          <span className="font-mono text-foreground">{pct(examiner.uncitedRelevant, examiner.uncitedJudged)}</span> of
          uncited candidates relevant — art the citation ground truth would count as a miss.
        </p>
      )}
    </div>
  )
}
