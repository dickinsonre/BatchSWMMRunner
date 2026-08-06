-- Add anonymous-session ownership to batch jobs.
-- Nullable so existing rows remain valid; the app denies access to
-- null-owner (legacy) jobs when sessions are enabled, and they expire
-- within the 24h retention sweep.
ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS owner_id text;

-- Speeds up the owner-scoped "latest completed job" lookup.
CREATE INDEX IF NOT EXISTS batch_jobs_owner_status_created_idx
  ON batch_jobs (owner_id, status, created_at DESC);
