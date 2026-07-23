import { type BatchJob, type ProcessResult, batchJobsTable } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, desc, lt } from "drizzle-orm";

export interface IStorage {
  getBatchJob(id: string): Promise<BatchJob | undefined>;
  createBatchJob(files: { id: string; name: string; path: string }[], engineMode?: string): Promise<BatchJob>;
  updateBatchJob(id: string, updates: Partial<BatchJob>): Promise<BatchJob | undefined>;
  deleteBatchJob(id: string): Promise<boolean>;
  listBatchJobs(): Promise<BatchJob[]>;
  getLatestCompletedJob(): Promise<BatchJob | undefined>;
  deleteJobsOlderThan(date: Date): Promise<string[]>;
}

function rowToJob(row: typeof batchJobsTable.$inferSelect): BatchJob {
  return {
    id: row.id,
    files: row.files,
    status: row.status as BatchJob['status'],
    currentFile: row.currentFile,
    results: (row.results || []) as ProcessResult[],
    engineMode: row.engineMode ?? undefined,
    createdAt: row.createdAt?.toISOString(),
  };
}

export class DatabaseStorage implements IStorage {
  async getBatchJob(id: string): Promise<BatchJob | undefined> {
    const [row] = await db.select().from(batchJobsTable).where(eq(batchJobsTable.id, id));
    return row ? rowToJob(row) : undefined;
  }

  async createBatchJob(files: { id: string; name: string; path: string }[], engineMode?: string): Promise<BatchJob> {
    const id = randomUUID();
    const [row] = await db.insert(batchJobsTable).values({
      id,
      status: 'idle',
      currentFile: 0,
      files,
      results: [],
      engineMode: engineMode ?? null,
    }).returning();
    return rowToJob(row);
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
    return row ? rowToJob(row) : undefined;
  }

  async deleteBatchJob(id: string): Promise<boolean> {
    const rows = await db.delete(batchJobsTable).where(eq(batchJobsTable.id, id)).returning({ id: batchJobsTable.id });
    return rows.length > 0;
  }

  async listBatchJobs(): Promise<BatchJob[]> {
    const rows = await db.select().from(batchJobsTable).orderBy(desc(batchJobsTable.createdAt));
    return rows.map(rowToJob);
  }

  async getLatestCompletedJob(): Promise<BatchJob | undefined> {
    const rows = await db.select().from(batchJobsTable)
      .where(eq(batchJobsTable.status, 'completed'))
      .orderBy(desc(batchJobsTable.createdAt))
      .limit(1);
    return rows.length > 0 ? rowToJob(rows[0]) : undefined;
  }

  async deleteJobsOlderThan(date: Date): Promise<string[]> {
    const rows = await db.delete(batchJobsTable)
      .where(lt(batchJobsTable.createdAt, date))
      .returning({ id: batchJobsTable.id });
    return rows.map(r => r.id);
  }
}

export const storage = new DatabaseStorage();
