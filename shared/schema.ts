import { z } from "zod";
import { pgTable, text, integer, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const parsedMetricsSchema = z.object({
  runoffContinuityError: z.number().optional(),
  routingContinuityError: z.number().optional(),
  totalPrecipitation: z.number().optional(),
  surfaceRunoff: z.number().optional(),
  nodesFlooded: z.number().optional(),
  floodingSummary: z.string().optional(),
  flowRoutingMethod: z.string().optional(),
  infiltrationMethod: z.string().optional(),
  totalInflow: z.number().optional(),
  totalOutflow: z.number().optional(),
  floodingLoss: z.number().optional(),
  reportWarnings: z.array(z.string()).optional(),
  reportErrors: z.array(z.string()).optional(),
});

export type ParsedMetrics = z.infer<typeof parsedMetricsSchema>;

export const processResultSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  status: z.enum(['success', 'failed', 'cancelled', 'timeout']),
  error: z.string().optional(),
  processingTime: z.number().optional(),
  reportContent: z.string().optional(),
  inpContent: z.string().optional(),
  results: z.object({
    peakFlow: z.number().optional(),
    totalVolume: z.number().optional(),
  }).optional(),
  parsedMetrics: parsedMetricsSchema.optional(),
  // Set on light summaries when the full report/input text is stored
  // separately and can be fetched on demand.
  hasReport: z.boolean().optional(),
  hasInp: z.boolean().optional(),
  provenance: z.object({
    requestedEngine: z.string(),
    actualEngine: z.string().optional(),
    engineVersion: z.string().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    exitCode: z.number().nullable().optional(),
  }).optional(),
});

export type ProcessResult = z.infer<typeof processResultSchema>;

export const batchJobSchema = z.object({
  id: z.string(),
  files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  })),
  status: z.enum(['idle', 'processing', 'completed', 'cancelled', 'failed']),
  currentFile: z.number(),
  results: z.array(processResultSchema),
  engineMode: z.string().optional(),
  createdAt: z.string().optional(),
  // Server-side only: anonymous session owner. Stripped before sending to clients.
  ownerId: z.string().nullable().optional(),
});

export type BatchJob = z.infer<typeof batchJobSchema>;

export const batchJobsTable = pgTable("batch_jobs", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default('idle'),
  currentFile: integer("current_file").notNull().default(0),
  files: jsonb("files").notNull().$type<{ id: string; name: string; path: string }[]>(),
  results: jsonb("results").notNull().default([]).$type<ProcessResult[]>(),
  engineMode: text("engine_mode"),
  ownerId: text("owner_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One row per processed file. Large artifacts (report/input text) live in
// their own columns so job reads can select the light summary only — the
// batch_jobs row is never rewritten with accumulated results.
export const batchResultsTable = pgTable("batch_results", {
  jobId: text("job_id").notNull(),
  resultId: text("result_id").notNull(),
  seq: integer("seq").notNull(),
  summary: jsonb("summary").notNull().$type<ProcessResult>(),
  reportContent: text("report_content"),
  inpContent: text("inp_content"),
}, (t) => [primaryKey({ columns: [t.jobId, t.resultId] })]);

export const uploadFileSchema = z.object({
  name: z.string(),
  path: z.string(),
});

export type UploadFile = z.infer<typeof uploadFileSchema>;

export const swmmStatusSchema = z.object({
  found: z.boolean(),
  // path/searchedPaths are server-side only; they are stripped from API
  // responses so filesystem paths never reach the browser.
  path: z.string().optional(),
  mode: z.enum(['live', 'unavailable']),
  searchedPaths: z.array(z.string()).optional(),
  apiAvailable: z.boolean().optional(),
  apiVersion: z.number().optional(),
});

export type SwmmStatus = z.infer<typeof swmmStatusSchema>;

export const sweepConfigSchema = z.object({
  parameterName: z.string(),
  values: z.array(z.number()),
});

export type SweepConfig = z.infer<typeof sweepConfigSchema>;

export const designStormEntrySchema = z.object({
  returnPeriod: z.string(),
  depth: z.number(),
  selected: z.boolean(),
});

export type DesignStormEntry = z.infer<typeof designStormEntrySchema>;

export const designStormConfigSchema = z.object({
  storms: z.array(designStormEntrySchema),
  rainfallDistribution: z.enum(['SCS Type I', 'SCS Type IA', 'SCS Type II', 'SCS Type III']),
  duration: z.enum(['1hr', '2hr', '6hr', '12hr', '24hr']),
});

export type DesignStormConfig = z.infer<typeof designStormConfigSchema>;

export const sweepResultSchema = processResultSchema.extend({
  parameterValue: z.number().optional(),
  stormLabel: z.string().optional(),
});

export type SweepResult = z.infer<typeof sweepResultSchema>;
