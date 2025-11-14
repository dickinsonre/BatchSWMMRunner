import { type BatchJob } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getBatchJob(id: string): Promise<BatchJob | undefined>;
  createBatchJob(files: { id: string; name: string; path: string }[]): Promise<BatchJob>;
  updateBatchJob(id: string, updates: Partial<BatchJob>): Promise<BatchJob | undefined>;
}

export class MemStorage implements IStorage {
  private batchJobs: Map<string, BatchJob>;

  constructor() {
    this.batchJobs = new Map();
  }

  async getBatchJob(id: string): Promise<BatchJob | undefined> {
    return this.batchJobs.get(id);
  }

  async createBatchJob(files: { id: string; name: string; path: string }[]): Promise<BatchJob> {
    const id = randomUUID();
    const batchJob: BatchJob = {
      id,
      files,
      status: 'idle',
      currentFile: 0,
      results: [],
    };
    this.batchJobs.set(id, batchJob);
    return batchJob;
  }

  async updateBatchJob(id: string, updates: Partial<BatchJob>): Promise<BatchJob | undefined> {
    const job = this.batchJobs.get(id);
    if (!job) return undefined;
    
    const updatedJob = { ...job, ...updates };
    this.batchJobs.set(id, updatedJob);
    return updatedJob;
  }
}

export const storage = new MemStorage();
