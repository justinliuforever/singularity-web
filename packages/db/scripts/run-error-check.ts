// Verifies friendlyRunError against the exact strings production has produced.
// apps/web has no "type": "module", so a static cross-package import lands on the CJS interop
// path; the namespace object from a dynamic import carries the named export either way.
const mod: { friendlyRunError: (s?: string | null) => string } = await import(
  "../../../apps/web/lib/run-error"
);
const { friendlyRunError } = mod;

const cases: Array<[string, "connection" | "passthrough" | "unknown"]> = [
  ["terminated", "connection"],
  [
    "TikHub /api/v1/douyin/app/v3/fetch_user_post_videos network failure after 6 attempts: terminated (other side closed)",
    "connection",
  ],
  // Already Chinese: must survive verbatim, it names the step the generic text cannot.
  ["抖音作品列表获取失败：上游接口暂时不可用，请稍后重试（terminated）", "passthrough"],
  ["抖音账号信息获取失败：请确认主页链接有效，且账号未设为私密或已注销", "passthrough"],
  ["Could not parse analysis JSON. Raw response head: ", "passthrough"],
  ["", "unknown"],
];

let fail = 0;
for (const [input, kind] of cases) {
  const out = friendlyRunError(input);
  const ok =
    kind === "connection"
      ? out.includes("连接中断")
      : kind === "unknown"
        ? out.includes("原因未知")
        : out === input.trim();
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${kind}] ${JSON.stringify(input).slice(0, 60)}`);
  console.log(`        -> ${out}`);
}
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
