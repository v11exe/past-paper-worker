import { z } from "zod";

export const aiProxyOperationSchema = z.enum([
  "suggestions",
  "page_inventory",
  "question_boundaries",
  "question_extraction",
  "mark_scheme_alignment",
  "paper_mark",
  "smoke_ping",
  "smoke_text",
  "smoke_extraction",
  "smoke_marking",
  "smoke_diagnostics",
]);

export type AIProxyOperation = z.infer<typeof aiProxyOperationSchema>;

export const structuredAiOperations = new Set<AIProxyOperation>([
  "page_inventory",
  "question_boundaries",
  "question_extraction",
  "mark_scheme_alignment",
  "paper_mark",
  "smoke_extraction",
  "smoke_marking",
]);

export const aiProxyRequestSchema = z.object({
  operation: aiProxyOperationSchema,
  model: z.string().min(1).max(120),
  prompt: z.string().min(1).max(120_000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(65_536).optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  requestLabel: z.string().max(140).optional(),
  retryCount: z.number().int().min(0).max(8).optional(),
  media: z
    .array(
      z.object({
        mimeType: z.string().min(1).max(120),
        dataBase64: z.string().min(1).max(9_000_000),
      }),
    )
    .default([]),
});

export type AIProxyRequest = z.infer<typeof aiProxyRequestSchema>;

export const aiProxyErrorSchema = z.object({
  type: z.enum(["invalid_request", "invalid_json", "timeout", "quota", "safety", "network", "empty_response", "provider", "server"]),
  message: z.string(),
  retryable: z.boolean().default(false),
  statusCode: z.number().int().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
  rawPreview: z.string().nullable().optional(),
});

export type AIProxyError = z.infer<typeof aiProxyErrorSchema>;

export const aiProxySuccessSchema = z.object({
  ok: z.literal(true),
  operation: aiProxyOperationSchema,
  model: z.string(),
  text: z.string(),
  usage: z.record(z.unknown()).optional(),
  finishReason: z.string().nullable().optional(),
});

export const aiProxyFailureSchema = z.object({
  ok: z.literal(false),
  operation: aiProxyOperationSchema.optional(),
  model: z.string().nullable().optional(),
  error: aiProxyErrorSchema,
});

export const aiProxyResponseSchema = z.union([aiProxySuccessSchema, aiProxyFailureSchema]);

export type AIProxySuccessResponse = z.infer<typeof aiProxySuccessSchema>;
export type AIProxyFailureResponse = z.infer<typeof aiProxyFailureSchema>;
export type AIProxyResponse = z.infer<typeof aiProxyResponseSchema>;
