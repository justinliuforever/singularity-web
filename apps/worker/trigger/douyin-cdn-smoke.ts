import { logger, task } from "@trigger.dev/sdk";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type ProbeResult = {
  label: string;
  host: string;
  ua: "browser" | "none";
  status: number | string;
  contentType?: string;
  contentLength?: string;
  finalHost?: string;
  via?: string;
  ms: number;
};

async function tikhub<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.tikhub.io${path}`, {
    headers: { Authorization: `Bearer ${process.env.TIKHUB_API_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`TikHub ${path} -> ${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

// A wrong Referer is the only known 403 trigger on Douyin CDN, so never send one.
async function probe(label: string, url: string, ua: "browser" | "none"): Promise<ProbeResult> {
  const host = new URL(url).host;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        Range: "bytes=0-1023",
        ...(ua === "browser" ? { "User-Agent": BROWSER_UA } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    await res.body?.cancel();
    return {
      label,
      host,
      ua,
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      contentLength: res.headers.get("content-length") ?? undefined,
      finalHost: new URL(res.url).host,
      via: res.headers.get("via") ?? undefined,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return { label, host, ua, status: (err as Error).message.slice(0, 120), ms: Date.now() - t0 };
  }
}

type Payload = {
  videoAwemeId?: string;
  imageAwemeId?: string;
};

export const douyinCdnSmoke = task({
  id: "douyin-cdn-smoke",
  machine: { preset: "small-1x" },
  maxDuration: 300,
  run: async (payload: Payload) => {
    const videoId = payload.videoAwemeId ?? "7270744287271210255";
    const imageId = payload.imageAwemeId ?? "7484087362142752060";

    const targets: Array<{ label: string; url: string }> = [];

    const video = await tikhub<{ aweme_detail: any }>(
      `/api/v1/douyin/app/v3/fetch_one_video?aweme_id=${videoId}`,
    );
    const detail = video?.aweme_detail;
    if (!detail) throw new Error("no aweme_detail in TikHub response");

    for (const u of detail.video?.play_addr?.url_list ?? []) {
      targets.push({ label: "play_addr", url: u });
    }

    const bitRates: any[] = detail.video?.bit_rate ?? [];
    const lowest = [...bitRates].sort((a, b) => (a?.bit_rate ?? 0) - (b?.bit_rate ?? 0))[0];
    const lowestUrl: string | undefined = lowest?.play_addr?.url_list?.[0];
    if (lowestUrl) targets.push({ label: `bit_rate_lowest_${lowest.gear_name ?? "?"}`, url: lowestUrl });

    const coverJpeg = (detail.video?.cover?.url_list ?? []).find((u: string) => u.includes(".jpeg"));
    if (coverJpeg) targets.push({ label: "cover_jpeg", url: coverJpeg });

    const musicUrl: string | undefined = detail.music?.play_url?.url_list?.[0];
    if (musicUrl?.startsWith("http")) targets.push({ label: "music_play_url", url: musicUrl });

    try {
      const img = await tikhub<{ aweme_detail: any }>(
        `/api/v1/douyin/app/v3/fetch_one_video?aweme_id=${imageId}`,
      );
      const first = img?.aweme_detail?.images?.[0];
      const imgUrl: string | undefined =
        (first?.url_list ?? []).find((u: string) => u.includes(".jpeg")) ?? first?.url_list?.[0];
      if (imgUrl) targets.push({ label: "image_post_jpeg", url: imgUrl });
    } catch (err) {
      logger.warn(`image post fetch failed: ${(err as Error).message}`);
    }

    const results: ProbeResult[] = [];
    for (const t of targets) {
      results.push(await probe(t.label, t.url, "browser"));
      results.push(await probe(t.label, t.url, "none"));
    }

    for (const r of results) {
      logger.info(
        `[${r.label}] ${r.host} ua=${r.ua} -> ${r.status} ct=${r.contentType ?? "?"} len=${r.contentLength ?? "?"} via=${r.via ?? "-"} final=${r.finalHost ?? "-"} ${r.ms}ms`,
      );
    }

    const ok = (r: ProbeResult) => r.status === 200 || r.status === 206;
    const verdict = {
      videoCdnOk: results.some(
        (r) => (r.label === "play_addr" || r.label.startsWith("bit_rate")) && ok(r),
      ),
      imageCdnOk: results.some(
        (r) => (r.label === "cover_jpeg" || r.label === "image_post_jpeg") && ok(r),
      ),
      musicCdnOk: results.some((r) => r.label === "music_play_url" && ok(r)),
    };
    logger.info(`VERDICT ${JSON.stringify(verdict)}`);
    return { verdict, results };
  },
});
