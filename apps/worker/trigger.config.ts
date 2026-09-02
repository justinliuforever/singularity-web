import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_lfwtogxhtvfemlfqeooh",
  // "node" is the legacy default, which is Node 21 — Trigger.dev stops accepting new
  // deployments on it from 2026-10-05. node-24 needs SDK >=4.5.5; 4.4.x had no such enum value.
  runtime: "node-24",
  logLevel: "log",
  maxDuration: 14400,
  dirs: ["./trigger"],
  build: {
    extensions: [ffmpeg()],
  },
  retries: {
    enabledInDev: true,
    // No blind task-level retry: inner LLM/ASR/TikHub calls already retry transient
    // blips, so a task-level retry only fires on a hard crash — re-running a 4h task
    // from scratch starves the shared concurrency pool and double-charges quota.
    default: {
      maxAttempts: 1,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      randomize: true,
    },
  },
});
