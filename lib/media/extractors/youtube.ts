import ytdl from "@distube/ytdl-core";
import type { MediaExtractResult, MediaFormat } from "../types";

function thumbnailUrl(thumbnails: Array<{ url: string }> | undefined): string | undefined {
  return thumbnails?.length ? thumbnails[thumbnails.length - 1].url : undefined;
}

export async function extractYouTube(url: string): Promise<MediaExtractResult> {
  if (!ytdl.validateURL(url)) {
    return {
      success: false,
      platform: "youtube",
      error: "Invalid YouTube URL.",
      extractor: "youtube"
    };
  }

  const info = await ytdl.getInfo(url);
  const details = info.videoDetails;

  const formats: MediaFormat[] = info.formats
    .filter((format) => Boolean(format.url))
    .map((format) => ({
      url: format.url,
      mimeType: format.mimeType?.split(";")[0],
      quality: format.qualityLabel ?? format.audioQuality ?? undefined,
      width: format.width,
      height: format.height,
      filesize: format.contentLength ? Number(format.contentLength) : undefined,
      audio: Boolean(format.hasAudio),
      video: Boolean(format.hasVideo)
    }));

  const progressive = formats.filter((format) => format.audio && format.video);
  const preferred = [...progressive]
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0] ?? formats[0];

  return {
    success: Boolean(preferred?.url),
    platform: "youtube",
    type: "video",
    title: details.title,
    artist: details.author?.name,
    author: details.author?.name,
    thumbnailUrl: thumbnailUrl(details.thumbnails),
    durationMs: Number(details.lengthSeconds || 0) * 1000,
    formats,
    media: preferred,
    extractor: "youtube",
    ...(preferred?.url ? {} : { error: "No downloadable YouTube format was found." })
  };
}
