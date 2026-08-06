import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// The Neon serverless driver speaks Neon's WebSocket protocol and hangs when
// pointed at a vanilla PostgreSQL server (e.g. the CI service container or a
// local install). Use it only for non-local hosts; plain node-postgres
// otherwise.
const dbHost = new URL(process.env.DATABASE_URL).hostname;
const isLocalPostgres = dbHost === "localhost" || dbHost === "127.0.0.1";

type AnyPool = { query: Function; end: (...args: any[]) => any };
type Db = import("drizzle-orm/neon-serverless").NeonDatabase<typeof schema>;

let pool: AnyPool;
let db: Db;

if (isLocalPostgres) {
  const pgMod = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pgPool = new pgMod.default.Pool({ connectionString: process.env.DATABASE_URL });
  pool = pgPool;
  // Structurally compatible for every query-builder call we use; only the
  // session/driver internals differ between the two drizzle drivers.
  db = drizzle(pgPool, { schema }) as unknown as Db;
} else {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const neonPool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool = neonPool;
  db = drizzle(neonPool, { schema });
}

export { pool, db };
