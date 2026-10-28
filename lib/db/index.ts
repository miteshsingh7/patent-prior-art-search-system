import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const globalForDb = globalThis as unknown as { pool?: Pool }

// pg already treats sslmode=require as verify-full; stating it explicitly keeps that behaviour across pg v9.
const connectionString = process.env.DATABASE_URL?.replace(/sslmode=(prefer|require|verify-ca)/, 'sslmode=verify-full')

export const pool = globalForDb.pool ?? new Pool({ connectionString, max: 5 })

if (process.env.NODE_ENV !== 'production') globalForDb.pool = pool

export const db = drizzle(pool, { schema })
