import { detectMediaPlatform } from "./detector";
import { normalizeMediaResult, failureResult } from "./response";
import type { MediaExtractRequest, MediaExtractResult, MediaPlatform } from "./types";
import { extractYouTube } from "./extractors/youtube";

type PlatformExtractor = (url: string) => Promise<MediaExtractResult>;

const extractors: Partial<Record<MediaPlatform, PlatformExtractor>> = {
  youtube: extractYouTube
};

export async function orchestrateMediaExtraction(
  request: MediaExtractRequest
): Promise<MediaExtractResult> {
  const url = request.url?.trim();

  if (!url) return failureResult("unknown", "A media URL is required.");

  const detection = detectMediaPlatform(url);

  if (detection.platform === "unknown") {
    return failureResult("unknown", "Invalid URL. Only HTTP(S) media URLs are supported.");
  }

  const extractor = extractors[detection.platform];

  if (!extractor) {
    return failureResult(
      detection.platform,
      `Platform detected as ${detection.platform}, but its extractor is not implemented yet.`
    );
  }

  try {
    return normalizeMediaResult(await extractor(url));
  } catch (error) {
    return failureResult(
      detection.platform,
      error instanceof Error ? error.message : "Media extraction failed."
    );
  }
}
