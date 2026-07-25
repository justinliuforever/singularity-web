// Every new task id must be registered here — the active-runs banner and the global
// indicator both read these labels.
export const AGENT_LABEL: Record<string, string> = {
  clerk: "操盘小鹅",
  muse: "灵感小鹅",
  poet: "神笔小鹅",
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

// Bible runs are stored as agent="poet", so badge them by command instead of agent.
export function runBadgeLabel(agent: string, command: string): string {
  if (command === "poet-generate-bible") return "频道圣经";
  if (command === "poet-import-bible") return "圣经导入";
  return AGENT_LABEL[agent] ?? agent;
}
