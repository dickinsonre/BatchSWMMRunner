-- Base schema: the batch_jobs table (originally created via drizzle push,
-- captured here so a fresh database — e.g. CI — can be bootstrapped from
-- the migrations folder alone).
CREATE TABLE IF NOT EXISTS batch_jobs (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle',
  current_file integer NOT NULL DEFAULT 0,
  files jsonb NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_mode text,
  created_at timestamp NOT NULL DEFAULT now()
);
