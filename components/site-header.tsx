import Link from 'next/link'
import { NavLinks } from './nav-links'

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-medium tracking-tight">claimline</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">prior-art search</span>
        </Link>
        <NavLinks />
      </div>
    </header>
  )
}
