export const SOP_LABEL: Record<string, string> = {
  human: "写稿打法",
  hottest: "爆款拆解",
  ai_reference: "AI 底稿",
  single_video: "单条拆解",
};

export const SOP_ORDER: Record<string, number> = {
  human: 0,
  hottest: 1,
  single_video: 2,
  ai_reference: 3,
};

export function sopTypeLabel(sopType: string): string {
  return SOP_LABEL[sopType] ?? sopType.replace(/_/g, " ");
}
