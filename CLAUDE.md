# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目状态

已 scaffold 并部署到生产：Vercel（`hkg1` 函数）+ Trigger.dev cloud（`us-east-1` worker）+ Supabase（Singapore）+ Logto Cloud（Tokyo）。Closed beta 目标 Q3 2026。

三轮 feedback 已收口：IA 三层重构（账号/对标/项目 + SOP/Bible 跨项目复用）、Clerk 拆对标解耦、防编造、转写修复、进度条/ETA、工作台调度台、UIUX motion 层全部上线。各轮执行文档归档在 `notes/archive/`。

功能模块、运维注意、未来优化见 `notes/beta.md`；版本 release notes 在 `notes/releases/`；架构图与决策依据见 `notes/archive/architecture_final.md`。

## 它是什么

**搬砖小鹅 Goooose**（goooose.com，2026-07 由 Singularity 更名）。AI 内容教练 web SaaS。目标用户：中国小型创作者（主战 XHS + YouTube）。核心交付：看对标 → 出选题 → 写稿全链路。

## 锁定的技术栈

| 层 | 选择 |
|---|---|
| 主语言 | **TypeScript** |
| 前端 | Next.js 16 App Router on Vercel（函数 `hkg1`）|
| UI | Tailwind 4 + shadcn/ui (base-nova) + Radix |
| API | tRPC v11 |
| AI 流式 | Vercel AI SDK v6 |
| 长任务 | Trigger.dev v4 Hobby（cloud workers us-east-1）|
| Auth | Logto Cloud（Tokyo 区域）|
| DB | Supabase Pro（Postgres ap-southeast-1 + Drizzle ORM，不用 Realtime/Auth/Storage SDK）|
| LLM 主链 | DeepSeek V4 Pro + Flash |
| LLM vision | Claude Sonnet 5（`@ai-sdk/anthropic`，`vision.ts` 硬编码 `claude-sonnet-5`）|
| ASR | Deepgram Nova-3 主 + Qwen3-ASR-Flash 备（中文标题 qwenFirst、长音频 ffmpeg 分片拼接）|
| 视频元数据 | YouTube Data API v3 |
| 数据层 | TikHub（XHS + 抖音全套；YouTube 生产链已改走 yt-dlp+代理池 / YouTube Data API v3 / Deepgram，TikHub 仅 web 侧账号校验兜底）|
| Monorepo | pnpm + Turborepo |

## 任务分类决定代码放哪里

任务时长 + 运行时决定写在哪个 workspace：

- **Class A 短任务（< 800s）** → Next.js API 路由内 Vercel AI SDK（`streamText` / `useChat` 等）。**当前无任何落地**：`apps/web` 无 streamText/generateText 路由，所有 AI 生成（含短稿）统一走 Trigger.dev；此路径是未来选项，新增短任务型功能需从零搭 web 侧流式基建
- **Class B 长任务** → `apps/worker/trigger/` 下 Trigger.dev v4 任务，前端 `useRealtimeRun` 推进度。Clerk 频道分析、Muse 竞品监控、Poet 写稿（长短稿都在此）、Bible 生成都走这条

数据抓取全走 TypeScript 调 TikHub REST（`tikhub.ts` YT 兜底 + `xhs.ts` + `douyin.ts`）+ YouTube 生产链（`ytdlp.ts` 代理池 / `youtube-data.ts` Data API），无 Python sidecar。

## 约定

- TS 一统天下，仓库当前**没有** Python。`apps/scraper/` 是未来选项（见 `notes/beta.md` 未来优化），尚未启用
- **不**预装 Zustand。客户端状态用 tRPC + React Query + useState/Context；只有跨页面复杂共享状态出现时才引入
- 所有 prompt 模板集中在 `packages/prompts/`（核心 IP，见下方清单）
- 所有 Trigger.dev 任务在 `apps/worker/trigger/`
- 文档输出统一 HTML + PDF（不做 `.docx`，npm `docx` 功能弱于 `python-docx`，2026-05-15 决策放弃）
- 长稿阈值：中文 ≥2000 字 / 英文 ≥1500 词（约 10 min+）触发 outline → section expand 路径（即走 Trigger.dev）。来源 archive `script_writer.py:_write_script_long_form()`
- 用词避免"拍死""完胜""硬伤"等口语化措辞
- **注释最简**：只写非常重要的（非显然的 WHY）；其余一律不写，保持代码文件简洁。注释用英文
- commit message 用简洁英文，**不**加 Co-Authored-By trailer；用 Conventional Commits + 版本 scope（如 `feat(v0.6): ...` / `fix(v0.6): ...` / `docs(v0.6): ...`），版本号随当前 Beta 版本走
- 圣经为锚点化格式：`TOPIC:`/`HOST:` 行 + 9 个英文锚点章节（POSITIONING/PERSONA/AUDIENCE/CONTENT_PILLARS/CONTENT_RULES/METHODOLOGY/INFORMATION_SOURCES/TOPIC_FRAMEWORK/FACT_SHEET）；下游用 `selectBibleSections` 按需取节（无锚点旧圣经回退整块）
- commit 后**不要**自动 `git push`；push 由用户自己执行，除非用户在当前消息里明确要求 push
- 改完 `packages/{db,domain,integrations,prompts}/**` 或 `apps/worker/**` 后**必须**重新部署 Trigger.dev（Vercel 自动部署，Trigger.dev 不会）。`packages/db` 同样算数：worker 从它 import schema、配额与结算函数

## 核心 IP（`packages/prompts` 提示词 + `packages/domain` 服务）

这些 prompt 与算法是产品壁垒。当前已落位：

- `packages/prompts/src/clerk.ts` — 视频分析 / SOP 生成（human / ai_reference / hottest 三种）
- `packages/prompts/src/poet.ts` — SCRIPT_WRITING / LONG_FORM_OUTLINE / SECTION_EXPAND / CHANNEL_BIBLE / TOPIC_ANALYSIS / HUMANIZER
- `packages/prompts/src/muse.ts` — VIRAL_TRIGGER / IDEA_GENERATION
- `packages/domain/src/services/poet/bible.ts` — drift detection（lexical overlap + stopwords，archive `bible_generator.py` 1:1 移植）
- `packages/domain/src/services/poet/humanizer.ts` — humanize_chinese
- `packages/domain/src/services/poet/scriptWriter.ts` — long-form thresholds
- `packages/domain/src/services/muse.ts` — classify / extract / generate ideas

archive 路径见文末"前身仓库"，仅用于追溯原始逻辑、查 prompt 变更动机。

## 开发命令

```bash
pnpm install
pnpm --filter @goooose/web dev          # Next.js dev
pnpm --filter @goooose/worker dev       # Trigger.dev worker（另开窗口）

pnpm build                                  # 全仓 turbo build
pnpm typecheck                              # 全仓 tsc --noEmit
pnpm lint
```

Smoke 测试（手动跑，未接 Playwright/Vitest）：

```bash
pnpm --filter @goooose/db poet-services-smoke
pnpm --filter @goooose/db muse-services-smoke
pnpm --filter @goooose/db xhs-client-smoke
pnpm --filter @goooose/db vision-and-verify-smoke
pnpm --filter @goooose/db asr-fallback-smoke
```

`.env.local` 只在仓库根目录维护一份；`apps/web/.env.local` 和 `apps/worker/.env.local` 由 `scripts/link-env.js` postinstall 自动 symlink 过去。

## 之后我们决定

- **D3**：1 人 8 周 vs 2 人 5 周开发节奏
- **D4**：ICP 备案 + 微信开放平台是否 Week 1 启动（备案周期 3-6 个月、$5-15K，启动越晚 WeChat 上线越晚）
- **D5**：YouTube CDN R9（IDC IP 被 403）解决方案 — BrightData / Smartproxy 残留代理 vs 自起 `apps/scraper/` yt-dlp sidecar

## 前身仓库（archive）

`~/Desktop/Singularity-Macos-Social-Media-AI-Agent/` — Electron 原型，含 6K Python LOC。
重写时从这里查阅：
- prompt 模板（`backend/app/prompts/*.py`）
- bible drift detection 算法（`backend/app/services/bible_generator.py`）
- long-form thresholds（`backend/app/services/script_writer.py`）
- XHS sign.js（`backend/app/services/xhs_fetcher.py`）
- LLM 调用 retry 模式（`backend/app/services/transcript.py`）
