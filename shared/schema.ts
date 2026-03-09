import { z } from "zod";

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
});

export type ParsedMetrics = z.infer<typeof parsedMetricsSchema>;

export const processResultSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  status: z.enum(['success', 'failed']),
  error: z.string().optional(),
  processingTime: z.number().optional(),
  reportContent: z.string().optional(),
  inpContent: z.string().optional(),
  results: z.object({
    peakFlow: z.number().optional(),
    totalVolume: z.number().optional(),
  }).optional(),
  parsedMetrics: parsedMetricsSchema.optional(),
});

export type ProcessResult = z.infer<typeof processResultSchema>;

export const batchJobSchema = z.object({
  id: z.string(),
  files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  })),
  status: z.enum(['idle', 'processing', 'completed', 'cancelled']),
  currentFile: z.number(),
  results: z.array(processResultSchema),
});

export type BatchJob = z.infer<typeof batchJobSchema>;

export const uploadFileSchema = z.object({
  name: z.string(),
  path: z.string(),
});

export type UploadFile = z.infer<typeof uploadFileSchema>;

export const swmmStatusSchema = z.object({
  found: z.boolean(),
  path: z.string().optional(),
  mode: z.enum(['live', 'simulation']),
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
