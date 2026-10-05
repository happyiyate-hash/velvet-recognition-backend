import type { MediaExtractResult } from "./types";
export function normalizeMediaResult(result:MediaExtractResult):MediaExtractResult {
  return {...result,title:result.title?.trim()||undefined,artist:result.artist?.trim()||undefined,author:result.author?.trim()||undefined,formats:result.formats?.filter(f=>Boolean(f.url)),media:result.media?.url?result.media:undefined};
}
