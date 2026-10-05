import type { MediaPlatform, PlatformDetection } from "./types";

const HOST_RULES: Array<{ platform: MediaPlatform; hosts: string[] }> = [
  { platform: "youtube", hosts: ["youtube.com", "youtu.be"] },
  { platform: "tiktok", hosts: ["tiktok.com"] },
  { platform: "instagram", hosts: ["instagram.com"] },
  { platform: "facebook", hosts: ["facebook.com", "fb.watch"] },
  { platform: "twitter", hosts: ["twitter.com", "x.com"] },
  { platform: "reddit", hosts: ["reddit.com", "redd.it"] },
  { platform: "pinterest", hosts: ["pinterest.com", "pin.it"] },
  { platform: "linkedin", hosts: ["linkedin.com"] },
  { platform: "rednote", hosts: ["xiaohongshu.com", "xhslink.com"] },
];

function matchesHost(hostname: string, rule: string): boolean {
  return hostname === rule || hostname.endsWith("." + rule);
}

export function detectMediaPlatform(rawUrl: string): PlatformDetection {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { platform: "unknown", hostname: parsed.hostname, confidence: "low" };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    for (const rule of HOST_RULES) {
      if (rule.hosts.some((host) => matchesHost(hostname, host))) {
        return { platform: rule.platform, hostname, confidence: "high" };
      }
    }

    return { platform: "generic", hostname, confidence: "low" };
  } catch {
    return { platform: "unknown", hostname: "", confidence: "low" };
  }
}

export function isSupportedMediaUrl(rawUrl: string): boolean {
  const result = detectMediaPlatform(rawUrl);
  return result.platform !== "unknown";
}
