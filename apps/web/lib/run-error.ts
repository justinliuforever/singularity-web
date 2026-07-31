// Worker failures reach the UI as raw infrastructure text — undici surfaces a socket abort as
// the single word "terminated". Map the shapes we have actually seen in production to something
// a creator can act on, and pass anything else through unchanged rather than guessing.
const PATTERNS: Array<{ match: RegExp; text: string }> = [
  {
    match: /terminated|UND_ERR_SOCKET|other side closed|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i,
    text: "与数据源的连接中断了（对方站点或网络波动）。稍后重试通常就能过。",
  },
  {
    match: /上游接口暂时不可用|Please retry|HTTP 5\d\d|HTTP 429/i,
    text: "数据源暂时不可用或限流了，等几分钟再试。",
  },
  { match: /timed out|timeout|AbortError|TimeoutError/i, text: "等待数据源响应超时，稍后重试。" },
];

export function friendlyRunError(raw: string | undefined | null): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "运行失败，原因未知。可以重试一次；如果反复失败请联系我们。";
  // A message the worker already wrote in Chinese was written for this screen and names the
  // step; the generic text below would throw that away just because it quotes the raw cause.
  if (/[一-龥]/.test(msg)) return msg;
  for (const p of PATTERNS) if (p.match.test(msg)) return p.text;
  return msg;
}
