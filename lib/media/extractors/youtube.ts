import { Innertube } from "youtubei.js";
import type { MediaExtractResult, MediaFormat } from "../types";

let clientPromise: Promise<Innertube> | undefined;

function getClient(): Promise<Innertube> {
  if (!clientPromise) {
    clientPromise = Innertube.create({
      lang: "en",
      location: "US"
    });
  }
  return clientPromise;
}

function extractVideoId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function mimeType(value?: string): string | undefined {
  return value?.split(";")[0];
}

function toFormat(raw: any, url: string): MediaFormat {
  const hasAudio = Boolean(raw.has_audio ?? raw.hasAudio);
  const hasVideo = Boolean(raw.has_video ?? raw.hasVideo);

  return {
    url,
    mimeType: mimeType(raw.mime_type ?? raw.mimeType),
    quality: raw.quality_label ?? raw.qualityLabel ?? raw.quality,
    width: raw.width,
    height: raw.height,
    filesize: Number.isFinite(raw.content_length) ? raw.content_length : undefined,
    audio: hasAudio,
    video: hasVideo
  };
}

async function decipherFormat(client: Innertube, format: any): Promise<string | undefined> {
  try {
    if (format.url) return format.url;
    if (typeof format.decipher === "function") {
      return await format.decipher(client.session.player);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function extractYouTube(url: string): Promise<MediaExtractResult> {
  const videoId = extractVideoId(url);

  if (!videoId) {
    return {
      success: false,
      platform: "youtube",
      error: "Invalid or unsupported YouTube video URL.",
      extractor: "youtube"
    };
  }

  try {
    const client = await getClient();
    const info: any = await client.getInfo(videoId);
    const details = info.basic_info ?? {};
    const streaming = info.streaming_data;

    if (!streaming) {
      return {
        success: false,
        platform: "youtube",
        title: details.title,
        author: details.author,
        error: "YouTube did not provide streaming formats for this video.",
        extractor: "youtube"
      };
    }

    const rawFormats = [
      ...(streaming.formats ?? []),
      ...(streaming.adaptive_formats ?? [])
    ];

    const formats: MediaFormat[] = [];

    for (const raw of rawFormats) {
      const resolvedUrl = await decipherFormat(client, raw);
      if (!resolvedUrl) continue;

      formats.push(toFormat(raw, resolvedUrl));
    }

    const progressive = formats
      .filter((format) => format.video && format.audio)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    const audio = formats
      .filter((format) => format.audio && !format.video)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    const video = formats
      .filter((format) => format.video && !format.audio)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    const preferred = progressive[0] ?? video[0] ?? audio[0];

    const thumbnails = details.thumbnail?.thumbnails ?? details.thumbnails ?? [];
    const thumbnailUrl = thumbnails.length
      ? thumbnails[thumbnails.length - 1].url
      : undefined;

    return {
      success: Boolean(preferred?.url),
      platform: "youtube",
      type: preferred?.video ? "video" : preferred?.audio ? "audio" : "unknown",
      title: details.title,
      artist: details.author,
      author: details.author,
      thumbnailUrl,
      durationMs: Number(details.duration ?? 0) * 1000 || undefined,
      formats,
      media: preferred,
      extractor: "youtube",
      ...(preferred?.url
        ? {}
        : { error: "No downloadable YouTube format could be resolved." })
    };
  } catch (error) {
    return {
      success: false,
      platform: "youtube",
      error: error instanceof Error ? error.message : "YouTube extraction failed.",
      extractor: "youtube"
    };
  }
}
