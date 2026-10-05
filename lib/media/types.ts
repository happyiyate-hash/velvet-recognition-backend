export type MediaPlatform =
  | "youtube" | "tiktok" | "instagram" | "facebook" | "twitter"
  | "reddit" | "pinterest" | "linkedin" | "rednote" | "generic" | "unknown";

export interface MediaExtractRequest {
  url: string;
}

export interface MediaFormat {
  url: string;
  mimeType?: string;
  quality?: string;
  width?: number;
  height?: number;
  filesize?: number;
  audio?: boolean;
  video?: boolean;
}

export interface MediaExtractResult {
  success: boolean;
  platform: MediaPlatform;
  type?: "video" | "audio" | "image" | "unknown";
  title?: string;
  artist?: string;
  author?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  formats?: MediaFormat[];
  media?: MediaFormat;
  extractor?: string;
  error?: string;
}

export interface PlatformDetection {
  platform: MediaPlatform;
  hostname: string;
  confidence: "high" | "medium" | "low";
}
