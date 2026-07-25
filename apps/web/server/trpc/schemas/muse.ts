import { z } from "zod";

import { detectVideoLinkPlatform } from "@goooose/integrations/validators";

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
  // Free-text topic direction/constraints, injected into idea generation as hard rules.
  direction: z.string().trim().max(500).optional(),
  // clerk_sops id used as a playbook reference during idea generation.
  sopId: z.string().uuid().optional(),
  // "links" patrols exactly the pasted video URLs instead of scanning bound competitors.
  sourceMode: z.enum(["batch", "links"]).default("batch"),
  videoUrls: z.array(z.string().trim().min(1).max(500)).min(1).max(10).optional(),
}).superRefine((val, ctx) => {
  if (val.sourceMode !== "links") return;
  if (!val.videoUrls || val.videoUrls.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "请至少粘贴一条视频链接" });
    return;
  }
  const bad = val.videoUrls
    .map((line, i) => (detectVideoLinkPlatform(line) === null ? i + 1 : null))
    .filter((i): i is number => i !== null);
  if (bad.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `第 ${bad.join("、")} 行无法识别平台 — 请粘贴小红书 / 抖音 / YouTube 的内容链接`,
    });
  }
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
