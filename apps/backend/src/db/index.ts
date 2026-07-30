// apps/backend/src/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { runtimeConfig } from '../config.js';

// Create a node-postgres connection pool
const pool = new pg.Pool({
  connectionString: runtimeConfig.databaseUrl,
});

// Initialize Drizzle ORM with the connection pool
export const db = drizzle(pool);
