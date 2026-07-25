import { z } from "zod";

export const startMonitorInput = z.object({
  channelId: z.string().uuid(),
  projectId: z.string().uuid(),
  maxVideosPerCompetitor: z.number().int().min(1).max(50).default(10),
  numIdeasPerVideo: z.number().int().min(1).max(10).default(5),
  language: z.enum(["en", "zh"]).default("zh"),
  // Subset of bound competitors to monitor; omitted = all bound, [] = none (extras-only run).
  competitorAccountIds: z.array(z.string().uuid()).max(50).optional(),
  // Unbound competitors included just for this run, never permanently bound.
  extraCompetitorAccountIds: z.array(z.string().uuid()).max(50).optional(),
  // Video/image filter for XHS + Douyin competitors; YouTube unaffected.
  contentFilter: z.enum(["all", "video", "image"]).optional(),
  // Legacy alias for contentFilter; kept so older clients keep working.
  xhsContentType: z.enum(["all", "video", "image"]).optional(),
});

export type StartMonitorInput = z.infer<typeof startMonitorInput>;

export const approveIdeaInput = z.object({
  ideaId: z.string().uuid(),
  approved: z.boolean(),
});

export type ApproveIdeaInput = z.infer<typeof approveIdeaInput>;

export const dismissIdeaInput = z.object({
  ideaId: z.string().uuid(),
  dismissed: z.boolean(),
});

export type DismissIdeaInput = z.infer<typeof dismissIdeaInput>;
