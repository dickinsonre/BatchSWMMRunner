import { z } from "zod";

export const batchJobSchema = z.object({
  id: z.string(),
  files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  })),
  status: z.enum(['idle', 'processing', 'completed', 'cancelled']),
  currentFile: z.number(),
  results: z.array(z.object({
    id: z.string(),
    fileName: z.string(),
    filePath: z.string(),
    status: z.enum(['success', 'failed']),
    error: z.string().optional(),
    processingTime: z.number().optional(),
    results: z.object({
      peakFlow: z.number().optional(),
      totalVolume: z.number().optional(),
    }).optional(),
  })),
});

export type BatchJob = z.infer<typeof batchJobSchema>;

export const uploadFileSchema = z.object({
  name: z.string(),
  path: z.string(),
});

export type UploadFile = z.infer<typeof uploadFileSchema>;

export const processResultSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  status: z.enum(['success', 'failed']),
  error: z.string().optional(),
  processingTime: z.number().optional(),
  results: z.object({
    peakFlow: z.number().optional(),
    totalVolume: z.number().optional(),
  }).optional(),
});

export type ProcessResult = z.infer<typeof processResultSchema>;
