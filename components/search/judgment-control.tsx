'use client'

import { useState } from 'react'
import { postJson } from '@/lib/patents/client'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { grade: 2, label: 'X', title: 'Novelty-relevant (X): discloses the claimed invention' },
  { grade: 1, label: 'A', title: 'Background (A): relevant state of the art' },
  { grade: 0, label: 'Not relevant', title: 'Not relevant to this claim' },
] as const

export function JudgmentControl({
  claim,
  docId,
  rank,
  initial,
}: {
  claim: string
  docId: string
  rank: number
  initial: number | undefined
}) {
  const [grade, setGrade] = useState<number | undefined>(initial)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')

  async function judge(next: number) {
    const previous = grade
    setGrade(next)
    setStatus('saving')
    try {
      await postJson('/api/judgments', { arg: { claim, docId, grade: next, rank } })
      setStatus('idle')
    } catch {
      setGrade(previous)
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground" id={`judge-${docId}`}>
        Your judgment
      </span>
      <div role="group" aria-labelledby={`judge-${docId}`} className="flex rounded-md border border-border">
        {OPTIONS.map((o) => (
          <button
            key={o.grade}
            type="button"
            title={o.title}
            aria-pressed={grade === o.grade}
            disabled={status === 'saving'}
            onClick={() => judge(o.grade)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md',
              grade === o.grade
                ? o.grade === 0
                  ? 'bg-foreground text-background'
                  : 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {status === 'error' && (
        <span role="alert" className="text-xs text-destructive">
          Not saved
        </span>
      )}
    </div>
  )
}
