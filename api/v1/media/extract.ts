import { orchestrateMediaExtraction } from "../../../lib/media/orchestrator";
import type { MediaExtractRequest } from "../../../lib/media/types";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
  try {
    const body = (req.body ?? {}) as Partial<MediaExtractRequest>;
    if (!body.url || typeof body.url !== "string") return res.status(400).json({ success: false, error: "url is required" });
    const result = await orchestrateMediaExtraction({ url: body.url });
    return res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Media extraction failed" });
  }
}
