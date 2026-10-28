import { createHash } from 'node:crypto'

export function claimHash(claim: string) {
  return createHash('sha256').update(claim.trim().replace(/\s+/g, ' ')).digest('hex')
}
