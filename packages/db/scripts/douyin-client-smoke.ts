// Full smoke for the douyin.ts TikHub client. Exercises every public function on
// real accounts/videos verified in Phase 0. Asserts shape so schema regressions surface.
//
// Run: pnpm --filter @goooose/db douyin-client-smoke

import { config } from "dotenv";
config({ path: new URL("../../../.env.local", import.meta.url) });

import {
  buildDouyinVideoUrl,
  computeDouyinEngagement,
  extractDouyinAwemeId,
  extractDouyinSecUserId,
  getDouyinTopComments,
  getDouyinUserVideos,
  getDouyinVideoDetail,
  getDouyinVideoStats,
  resolveDouyinUser,
} from "@goooose/integrations/clients/douyin";
import { fetchReference } from "@goooose/integrations/clients/references";

const ACCOUNTS = {
  // 西奇i健身 — video account
  fitness: "MS4wLjABAAAAKuK9tPMPsmTkx1IO5risLyyO-cVpWqTsPDGxQ1Sf2JcuiJp81OWjQudlCnUOFJnk",
  // 穿搭服饰 — image (图文) account
  fashion: "MS4wLjABAAAASoC4v0ckClK2EDH-9qsSVKXei1jZ049w76DFnc7iky6lv7kizkxF3t7yTWorqm8S",
};

const VIDEO_ID = "7270744287271210255"; // detail / stats / comments target
const ORIGINAL_SOUND_VIDEO_ID = "7510462945756826906"; // 原声 guard passes

const pathOf = (u: string) => u.split("?")[0]!.toLowerCase();

let pass = 0;
let fail = 0;
function t(name: string, ok: boolean, detail?: string) {
  const marker = ok ? "✓" : "✗";
  console.log(`  ${marker} ${name}${detail ? ` · ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
}

async function main() {
  console.log("\n══════ ⑦ URL / ID extractors (pure unit) ══════");
  t("extractDouyinSecUserId from bare sec_uid", extractDouyinSecUserId(ACCOUNTS.fitness) === ACCOUNTS.fitness);
  t(
    "extractDouyinSecUserId from profile URL",
    extractDouyinSecUserId(`https://www.douyin.com/user/${ACCOUNTS.fitness}?vid=x`) === ACCOUNTS.fitness,
  );
  t(
    "extractDouyinSecUserId from iesdouyin share URL",
    extractDouyinSecUserId(`https://www.iesdouyin.com/share/user/${ACCOUNTS.fitness}`) === ACCOUNTS.fitness,
  );
  t(
    "extractDouyinSecUserId from share-口令 text",
    extractDouyinSecUserId(`看看西奇i健身的抖音 😄 https://www.douyin.com/user/${ACCOUNTS.fitness}?_=1 复制打开`) ===
      ACCOUNTS.fitness,
  );
  t("extractDouyinSecUserId rejects garbage", extractDouyinSecUserId("not-a-sec-uid") === null);
  t("extractDouyinAwemeId from bare 19-digit", extractDouyinAwemeId(VIDEO_ID) === VIDEO_ID);
  t(
    "extractDouyinAwemeId from video URL",
    extractDouyinAwemeId(`https://www.douyin.com/video/${VIDEO_ID}`) === VIDEO_ID,
  );
  t(
    "extractDouyinAwemeId from iesdouyin share URL",
    extractDouyinAwemeId(`https://www.iesdouyin.com/share/video/${VIDEO_ID}/?region=CN`) === VIDEO_ID,
  );
  t(
    "extractDouyinAwemeId from share-口令 text",
    extractDouyinAwemeId(`复制打开抖音，看看！ https://www.douyin.com/video/${VIDEO_ID} 3.14`) === VIDEO_ID,
  );
  t("extractDouyinAwemeId rejects garbage", extractDouyinAwemeId("abc123") === null);
  t("buildDouyinVideoUrl", buildDouyinVideoUrl(VIDEO_ID) === `https://www.douyin.com/video/${VIDEO_ID}`);

  console.log("\n══════ ① resolveDouyinUser (real API) ══════");
  const fit = await resolveDouyinUser(ACCOUNTS.fitness);
  console.log(
    `  fitness: nickname="${fit.nickname}" uid=${fit.uid} uniqueId=${fit.uniqueId} followers=${fit.followerCount} awemes=${fit.awemeCount} ip=${fit.ipLocation}`,
  );
  t("fitness nickname non-empty", fit.nickname.length > 0);
  t("fitness followerCount > 0", (fit.followerCount ?? 0) > 0);
  t("fitness secUserId echoed", fit.secUserId === ACCOUNTS.fitness);
  t("fitness avatar is jpeg path", fit.avatarUrl !== null && pathOf(fit.avatarUrl).endsWith(".jpeg"));

  const fash = await resolveDouyinUser(ACCOUNTS.fashion);
  console.log(`  fashion: nickname="${fash.nickname}" followers=${fash.followerCount} awemes=${fash.awemeCount}`);
  t("fashion nickname non-empty", fash.nickname.length > 0);
  t("fashion followerCount > 0", (fash.followerCount ?? 0) > 0);

  console.log("\n══════ ② getDouyinUserVideos — video account ══════");
  const { videos: fitVids } = await getDouyinUserVideos(ACCOUNTS.fitness, 8);
  console.log(`  fitness returned ${fitVids.length} videos; is_top=[${fitVids.map((v) => (v.isTop ? 1 : 0)).join(",")}]`);
  for (const v of fitVids.slice(0, 3)) {
    console.log(
      `    [${v.contentType}] top=${v.isTop} dur=${v.durationSec}s play=${v.stats.playCount} eng=${v.engagementScore} cover=${v.coverUrl ? pathOf(v.coverUrl).slice(-5) : "null"} "${v.title.slice(0, 24)}"`,
    );
  }
  t("fitness returned ≥ 8 videos", fitVids.length >= 8);
  t("fitness list contains a pinned (is_top) video", fitVids.some((v) => v.isTop));
  t("fitness all contentType=douyin_video", fitVids.every((v) => v.contentType === "douyin_video"));
  t("fitness all durationSec > 0", fitVids.every((v) => v.durationSec !== null && v.durationSec > 0));
  t(
    "fitness all coverUrl path ends .jpeg",
    fitVids.every((v) => v.coverUrl !== null && pathOf(v.coverUrl).endsWith(".jpeg")),
  );
  t("fitness all playCount === null", fitVids.every((v) => v.stats.playCount === null));
  t("fitness all engagementScore > 0", fitVids.every((v) => v.engagementScore > 0));
  t(
    "engagement formula matches computeDouyinEngagement",
    fitVids.every((v) => v.engagementScore === computeDouyinEngagement(v.stats)),
  );

  console.log("\n══════ ③ getDouyinUserVideos — image (图文) account ══════");
  const { videos: fashVids } = await getDouyinUserVideos(ACCOUNTS.fashion, 8);
  const typeDist = fashVids.reduce<Record<string, number>>((acc, v) => {
    acc[v.contentType] = (acc[v.contentType] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  fashion returned ${fashVids.length}; types=${JSON.stringify(typeDist)}`);
  const imgPost = fashVids.find((v) => v.contentType === "douyin_image");
  if (imgPost) {
    console.log(`    image post: images=${imgPost.images.length} dur=${imgPost.durationSec} img0=${imgPost.images[0]?.width}x${imgPost.images[0]?.height}`);
  }
  t("fashion list has an image post", imgPost !== undefined);
  t("image post images.length > 0", (imgPost?.images.length ?? 0) > 0);
  t("image post durationSec === null", imgPost?.durationSec === null);
  t(
    "image post image[0] path ends .jpeg or .webp",
    imgPost !== undefined &&
      imgPost.images[0] !== undefined &&
      (pathOf(imgPost.images[0].url).endsWith(".jpeg") || pathOf(imgPost.images[0].url).endsWith(".webp")),
  );

  console.log("\n══════ ④ getDouyinVideoDetail (real API) ══════");
  const detail = await getDouyinVideoDetail(VIDEO_ID);
  console.log(
    `  detail: ${detail ? `"${detail.title.slice(0, 24)}" playUrls=${detail.play.playUrls.length} lowest=${detail.play.lowestBitratePlayUrls.length} cdnExp=${detail.play.cdnUrlExpiresAt}` : "(null)"}`,
  );
  t("detail non-null", detail !== null);
  if (detail) {
    t("detail play.playUrls non-empty", detail.play.playUrls.length > 0);
    t(
      "detail cdnUrlExpiresAt is in the future",
      detail.play.cdnUrlExpiresAt !== null && detail.play.cdnUrlExpiresAt > Date.now() / 1000,
    );
    t("detail authorSecUserId matches fitness", detail.authorSecUserId === ACCOUNTS.fitness);
  }

  const soundDetail = await getDouyinVideoDetail(ORIGINAL_SOUND_VIDEO_ID);
  console.log(`  原声 video: originalSoundUrl=${soundDetail?.play.originalSoundUrl ? "present" : "null"}`);
  t("原声 video originalSoundUrl non-null (guard passes)", soundDetail?.play.originalSoundUrl != null);

  console.log("\n══════ ⑤ getDouyinVideoStats (real API) ══════");
  const stats = await getDouyinVideoStats([VIDEO_ID]);
  console.log(`  stats[${VIDEO_ID}]: ${JSON.stringify(stats[VIDEO_ID])}`);
  t("stats has entry for video", stats[VIDEO_ID] !== undefined);
  t("stats playCount > 1,000,000", (stats[VIDEO_ID]?.playCount ?? 0) > 1_000_000);

  console.log("\n══════ ⑥ getDouyinTopComments (real API) ══════");
  const comments = await getDouyinTopComments(VIDEO_ID, 50);
  console.log(`  returned ${comments.length} comments; top digg=${comments[0]?.diggCount}`);
  for (const c of comments.slice(0, 3)) {
    console.log(`    digg=${c.diggCount} reply=${c.replyCount} "${c.text.slice(0, 30)}"`);
  }
  t("comments returned ≥ 50", comments.length >= 50);
  t("comments all have non-empty text", comments.every((c) => c.text.length > 0));
  t(
    "comments sorted by diggCount desc",
    comments.every((c, i, arr) => i === 0 || c.diggCount <= arr[i - 1]!.diggCount),
  );

  console.log("\n══════ fetchReference → Douyin path (references.ts) ══════");
  const ref = await fetchReference({ kind: "douyin", url: `https://www.douyin.com/video/${VIDEO_ID}` });
  console.log(`  ref: title="${ref.title.slice(0, 30)}" content=${ref.content.length} chars source=${ref.source}`);
  t("douyin ref no error", !ref.error);
  t("douyin ref content non-empty", ref.content.length > 0);
  t("douyin ref source=text", ref.source === "text");

  console.log("\n══════ ⑧ error shape: invalid sec_uid throws readable ══════");
  let threw = false;
  let msg = "";
  try {
    await resolveDouyinUser("MS4wLjABAAAA" + "x".repeat(43));
  } catch (e) {
    threw = true;
    msg = (e as Error).message;
  }
  console.log(`  threw=${threw} message="${msg.slice(0, 80)}"`);
  t("invalid sec_uid throws", threw);
  t("error message is readable (mentions status/UserId)", /status|UserId|not found/i.test(msg));

  console.log(`\n${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
