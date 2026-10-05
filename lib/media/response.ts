import type { MediaExtractResult } from "./types";

export function normalizeMediaResult(result: MediaExtractResult): MediaExtractResult {
  const formats = result.formats?.filter((format) => {
    try {
      const url = new URL(format.url);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });

  return {
    ...result,
    title: result.title?.trim() || undefined,
    artist: result.artist?.trim() || undefined,
    author: result.author?.trim() || undefined,
    thumbnailUrl: normalizeHttpUrl(result.thumbnailUrl),
    formats,
    media: result.media?.url ? {
      ...result.media,
      url: normalizeHttpUrl(result.media.url) ?? result.media.url
    } : undefined,
  };
}

export function failureResult(
  platform: MediaExtractResult["platform"],
  error: string,
  extractor = "orchestrator"
): MediaExtractResult {
  return { success: false, platform, error, extractor };
}

function normalizeHttpUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
