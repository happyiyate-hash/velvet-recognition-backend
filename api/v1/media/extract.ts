import type { VercelRequest, VercelResponse } from "@vercel/node";
import { orchestrateMediaExtraction } from "../../../lib/media/orchestrator";
import type { MediaExtractRequest } from "../../../lib/media/types";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
      allowedMethods: ["POST"]
    });
  }

  const body = (req.body ?? {}) as Partial<MediaExtractRequest>;
  if (typeof body.url !== "string" || !body.url.trim()) {
    return res.status(400).json({
      success: false,
      platform: "unknown",
      error: "url is required"
    });
  }

  const result = await orchestrateMediaExtraction({ url: body.url });
  const status = result.success ? 200 : result.platform === "unknown" ? 400 : 501;

  return res.status(status).json({
    success: result.success,
    platform: result.platform,
    ...(result.type ? { type: result.type } : {}),
    ...(result.title ? { title: result.title } : {}),
    ...(result.artist ? { artist: result.artist } : {}),
    ...(result.author ? { author: result.author } : {}),
    ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
    ...(result.durationMs != null ? { durationMs: result.durationMs } : {}),
    ...(result.formats ? { formats: result.formats } : {}),
    ...(result.media ? { media: result.media } : {}),
    ...(result.extractor ? { extractor: result.extractor } : {}),
    ...(result.error ? { error: result.error } : {})
  });
}
