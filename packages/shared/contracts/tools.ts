/**
 * Tool catalog and directory evaluation types.
 */

import { z } from 'zod';

export const toolCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  featured: z.boolean().optional(),
  installCmd: z.string().nullable().optional(),
  mcp_support: z.boolean().optional(),
});
export type ToolCatalogEntry = z.infer<typeof toolCatalogEntrySchema>;

export const toolCatalogResponseSchema = z.object({
  tools: z.array(toolCatalogEntrySchema),
  categories: z.record(z.string(), z.string()),
});
export type ToolCatalogResponse = z.infer<typeof toolCatalogResponseSchema>;

export const toolDirectoryEvaluationSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  verdict: z.string(),
  tagline: z.string().optional(),
  integration_tier: z.string().optional(),
  mcp_support: z.union([z.boolean(), z.string()]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ToolDirectoryEvaluation = z.infer<typeof toolDirectoryEvaluationSchema>;

export const toolDirectoryResponseSchema = z.object({
  evaluations: z.array(toolDirectoryEvaluationSchema),
  categories: z.record(z.string(), z.string()),
});
export type ToolDirectoryResponse = z.infer<typeof toolDirectoryResponseSchema>;
