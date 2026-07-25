import { z } from "zod";

// Loose URL (no platform-format refine) so a bad line is reported per-item as "invalid"
// instead of rejecting the whole paste.
export const importCompetitorsInput = z.object({
  projectId: z.string().uuid().optional(),
  competitors: z
    .array(z.object({ platform: z.enum(["youtube", "xhs", "douyin"]), url: z.string().min(1) }))
    .min(1)
    .max(50),
});
export type ImportCompetitorsInput = z.infer<typeof importCompetitorsInput>;

export const competitorIdInput = z.object({ competitorAccountId: z.string().uuid() });
export type CompetitorIdInput = z.infer<typeof competitorIdInput>;

export const bindCompetitorInput = z.object({
  projectId: z.string().uuid(),
  competitorAccountId: z.string().uuid(),
});
export type BindCompetitorInput = z.infer<typeof bindCompetitorInput>;
