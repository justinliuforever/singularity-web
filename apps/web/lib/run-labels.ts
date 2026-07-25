// Run display labels shared by the active-runs banner and the global indicator —
// a new task id must be added here exactly once.
export const AGENT_LABEL: Record<string, string> = {
  clerk: "Clerk",
  muse: "Muse",
  poet: "Poet",
};

export const COMMAND_LABEL: Record<string, string> = {
  "clerk-analyze-channel": "频道分析",
  "clerk-analyze-single-video": "单条拆解",
  "clerk-detect-channel-series": "系列归类",
  "muse-monitor-competitors": "巡视对标",
  "poet-generate-bible": "频道圣经",
  "poet-import-bible": "圣经导入",
  "poet-analyze-custom-topic": "选题拆解",
  "poet-generate-script": "脚本生成",
};

// Bible runs are stored as agent="poet"; show "频道圣经" as the badge so users don't see a misleading "Poet".
export function runBadgeLabel(agent: string, command: string): string {
  if (command === "poet-generate-bible") return "频道圣经";
  if (command === "poet-import-bible") return "圣经导入";
  return AGENT_LABEL[agent] ?? agent;
}
