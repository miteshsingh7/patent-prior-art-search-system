'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/', label: 'Search' },
  { href: '/benchmark', label: 'Benchmark' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              active ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
