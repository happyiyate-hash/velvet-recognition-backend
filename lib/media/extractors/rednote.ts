import type { MediaExtractResult } from "../types";

export async function extractRedNote(url: string): Promise<MediaExtractResult> {
  return {
    success: false,
    platform: "generic",
    error: "RedNote (Xiaohongshu) extractor not implemented yet",
    extractor: "rednote"
  };
}
