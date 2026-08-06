---
name: Neon serverless driver vs vanilla Postgres
description: Why DB connections hang in CI/local Postgres and the dual-driver fix
---

- The `@neondatabase/serverless` driver speaks Neon's WebSocket protocol. Pointed at a vanilla PostgreSQL server (GitHub Actions service container, local install) it **hangs indefinitely** — no error, jobs sit until killed.
- **Why:** caused ~15-minute hung CI runs that had to be cancelled; nothing in logs hints at the cause.
- **How to apply:** `server/db.ts` picks the driver by hostname — `localhost`/`127.0.0.1` → `pg` + `drizzle-orm/node-postgres`, anything else (Replit's `helium` Neon endpoint) → neon-serverless. Keep that switch intact when touching DB setup.
