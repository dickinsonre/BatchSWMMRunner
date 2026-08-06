-- One row per processed file. Large artifacts (report/input text) live in
-- dedicated columns so job reads select the light summary only, and the
-- batch_jobs row is never rewritten with an ever-growing results array.
CREATE TABLE IF NOT EXISTS batch_results (
  job_id text NOT NULL,
  result_id text NOT NULL,
  seq integer NOT NULL,
  summary jsonb NOT NULL,
  report_content text,
  inp_content text,
  PRIMARY KEY (job_id, result_id)
);

CREATE INDEX IF NOT EXISTS batch_results_job_seq_idx ON batch_results (job_id, seq);
