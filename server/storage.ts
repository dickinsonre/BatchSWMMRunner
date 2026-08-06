import { type BatchJob, type ProcessResult, batchJobsTable, batchResultsTable } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, desc, lt, and, sql, asc, inArray } from "drizzle-orm";

export interface IStorage {
  getBatchJob(id: string): Promise<BatchJob | undefined>;
  createBatchJob(files: { id: string; name: string; path: string }[], engineMode?: string, ownerId?: string | null): Promise<BatchJob>;
  updateBatchJob(id: string, updates: Partial<BatchJob>): Promise<BatchJob | undefined>;
  deleteBatchJob(id: string): Promise<boolean>;
  listBatchJobs(): Promise<BatchJob[]>;
  getLatestCompletedJob(ownerId?: string | null): Promise<BatchJob | undefined>;
  deleteJobsOlderThan(date: Date): Promise<string[]>;
  appendBatchResult(jobId: string, seq: number, result: ProcessResult): Promise<ProcessResult>;
  getBatchResultSummaries(jobId: string): Promise<ProcessResult[]>;
  getBatchResultArtifacts(jobId: string, resultId: string): Promise<{ reportContent?: string; inpContent?: string } | undefined>;
}

/** Light summary of a result: large artifact text replaced by has* flags. */
export function toResultSummary(result: ProcessResult): ProcessResult {
  const { reportContent, inpContent, ...rest } = result;
  return {
    ...rest,
    hasReport: reportContent !== undefined && reportContent !== null,
    hasInp: inpContent !== undefined && inpContent !== null,
  };
}

function rowToJob(row: typeof batchJobsTable.$inferSelect, results: ProcessResult[]): BatchJob {
  return {
    id: row.id,
    files: row.files,
    status: row.status as BatchJob['status'],
    currentFile: row.currentFile,
    results,
    engineMode: row.engineMode ?? undefined,
    ownerId: row.ownerId ?? null,
    createdAt: row.createdAt?.toISOString(),
  };
}

/**
 * Results for a job as light summaries: read from batch_results (never
 * selecting the artifact columns); fall back to the legacy JSONB blob for
 * jobs created before the results table existed.
 */
function legacyResultSummaries(row: typeof batchJobsTable.$inferSelect): ProcessResult[] {
  return ((row.results || []) as ProcessResult[]).map(toResultSummary);
}

export class DatabaseStorage implements IStorage {
  private async resultSummariesFor(row: typeof batchJobsTable.$inferSelect): Promise<ProcessResult[]> {
    const summaries = await this.getBatchResultSummaries(row.id);
    const legacy = legacyResultSummaries(row);
    if (legacy.length === 0) return summaries;
    if (summaries.length === 0) return legacy;
    // Mixed state: a pre-migration job gained new rows (e.g. it was still
    // processing during the deployment). Keep legacy results first, then
    // append new rows, deduplicating by result id (new rows win).
    const newIds = new Set(summaries.map(s => s.id));
    return [...legacy.filter(l => !newIds.has(l.id)), ...summaries];
  }

  async getBatchJob(id: string): Promise<BatchJob | undefined> {
    const [row] = await db.select().from(batchJobsTable).where(eq(batchJobsTable.id, id));
    if (!row) return undefined;
    return rowToJob(row, await this.resultSummariesFor(row));
  }

  async appendBatchResult(jobId: string, seq: number, result: ProcessResult): Promise<ProcessResult> {
    const summary = toResultSummary(result);
    await db.insert(batchResultsTable).values({
      jobId,
      resultId: result.id,
      seq,
      summary,
      reportContent: result.reportContent ?? null,
      inpContent: result.inpContent ?? null,
    }).onConflictDoUpdate({
      target: [batchResultsTable.jobId, batchResultsTable.resultId],
      set: {
        seq,
        summary,
        reportContent: result.reportContent ?? null,
        inpContent: result.inpContent ?? null,
      },
    });
    return summary;
  }

  async getBatchResultSummaries(jobId: string): Promise<ProcessResult[]> {
    // Deliberately never selects report_content/inp_content — summaries stay light.
    const rows = await db.select({ summary: batchResultsTable.summary })
      .from(batchResultsTable)
      .where(eq(batchResultsTable.jobId, jobId))
      .orderBy(asc(batchResultsTable.seq));
    return rows.map(r => r.summary);
  }

  async getBatchResultArtifacts(jobId: string, resultId: string): Promise<{ reportContent?: string; inpContent?: string } | undefined> {
    const [row] = await db.select({
      reportContent: batchResultsTable.reportContent,
      inpContent: batchResultsTable.inpContent,
    }).from(batchResultsTable)
      .where(and(eq(batchResultsTable.jobId, jobId), eq(batchResultsTable.resultId, resultId)));
    if (row) {
      return { reportContent: row.reportContent ?? undefined, inpContent: row.inpContent ?? undefined };
    }
    // Legacy jobs: artifacts still live in the JSONB blob.
    const [jobRow] = await db.select({ results: batchJobsTable.results }).from(batchJobsTable).where(eq(batchJobsTable.id, jobId));
    const legacy = ((jobRow?.results || []) as ProcessResult[]).find(r => r.id === resultId);
    if (!legacy) return undefined;
    return { reportContent: legacy.reportContent, inpContent: legacy.inpContent };
  }

  async createBatchJob(files: { id: string; name: string; path: string }[], engineMode?: string, ownerId?: string | null): Promise<BatchJob> {
    const id = randomUUID();
    const [row] = await db.insert(batchJobsTable).values({
      id,
      status: 'idle',
      currentFile: 0,
      files,
      results: [],
      engineMode: engineMode ?? null,
      ownerId: ownerId ?? null,
    }).returning();
    return rowToJob(row, []);
  }

  async updateBatchJob(id: string, updates: Partial<BatchJob>): Promise<BatchJob | undefined> {
    const values: Partial<typeof batchJobsTable.$inferInsert> = {};
    if (updates.status !== undefined) values.status = updates.status;
    if (updates.currentFile !== undefined) values.currentFile = updates.currentFile;
    if (updates.files !== undefined) values.files = updates.files;
    if (updates.results !== undefined) values.results = updates.results;
    if (updates.engineMode !== undefined) values.engineMode = updates.engineMode;
    if (Object.keys(values).length === 0) return this.getBatchJob(id);
    const [row] = await db.update(batchJobsTable).set(values).where(eq(batchJobsTable.id, id)).returning();
    return row ? rowToJob(row, await this.resultSummariesFor(row)) : undefined;
  }

  async deleteBatchJob(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.delete(batchResultsTable).where(eq(batchResultsTable.jobId, id));
      const rows = await tx.delete(batchJobsTable).where(eq(batchJobsTable.id, id)).returning({ id: batchJobsTable.id });
      return rows.length > 0;
    });
  }

  async listBatchJobs(): Promise<BatchJob[]> {
    const rows = await db.select().from(batchJobsTable).orderBy(desc(batchJobsTable.createdAt));
    return Promise.all(rows.map(async row => rowToJob(row, await this.resultSummariesFor(row))));
  }

  async getLatestCompletedJob(ownerId?: string | null): Promise<BatchJob | undefined> {
    const conditions = ownerId !== undefined
      ? and(eq(batchJobsTable.status, 'completed'), eq(batchJobsTable.ownerId, ownerId ?? ''))
      : eq(batchJobsTable.status, 'completed');
    const rows = await db.select().from(batchJobsTable)
      .where(conditions)
      .orderBy(desc(batchJobsTable.createdAt))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToJob(rows[0], await this.resultSummariesFor(rows[0]));
  }

  async deleteJobsOlderThan(date: Date): Promise<string[]> {
    return db.transaction(async (tx) => {
      const rows = await tx.delete(batchJobsTable)
        .where(lt(batchJobsTable.createdAt, date))
        .returning({ id: batchJobsTable.id });
      const ids = rows.map(r => r.id);
      if (ids.length > 0) {
        await tx.delete(batchResultsTable).where(inArray(batchResultsTable.jobId, ids));
      }
      return ids;
    });
  }
}

export const storage = new DatabaseStorage();

/**
 * Idempotent runtime migration so existing deployments (which only run
 * `npm run start`, with no migration step) pick up the owner_id column.
 * Mirrors migrations/0001_add_batch_jobs_owner_id.sql.
 */
export async function ensureStorageSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS owner_id text`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS batch_jobs_owner_status_created_idx
    ON batch_jobs (owner_id, status, created_at DESC)`);
  // Mirrors migrations/0002_add_batch_results.sql
  await db.execute(sql`CREATE TABLE IF NOT EXISTS batch_results (
    job_id text NOT NULL,
    result_id text NOT NULL,
    seq integer NOT NULL,
    summary jsonb NOT NULL,
    report_content text,
    inp_content text,
    PRIMARY KEY (job_id, result_id)
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS batch_results_job_seq_idx ON batch_results (job_id, seq)`);
}
