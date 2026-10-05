import type { MediaPlatform } from "./types";
export function detectMediaPlatform(rawUrl:string):MediaPlatform {
  try {
    const host=new URL(rawUrl).hostname.toLowerCase().replace(/^www\./,"");
    if(host==="youtube.com"||host==="youtu.be"||host.endsWith(".youtube.com"))return "youtube";
    if(host==="tiktok.com"||host.endsWith(".tiktok.com"))return "tiktok";
    if(host==="instagram.com"||host.endsWith(".instagram.com"))return "instagram";
    if(host==="facebook.com"||host==="fb.watch"||host.endsWith(".facebook.com"))return "facebook";
    if(host==="twitter.com"||host==="x.com"||host.endsWith(".twitter.com")||host.endsWith(".x.com"))return "twitter";
    if(host==="reddit.com"||host==="redd.it"||host.endsWith(".reddit.com"))return "reddit";
    if(host==="pinterest.com"||host.endsWith(".pinterest.com"))return "pinterest";
    if(host==="linkedin.com"||host.endsWith(".linkedin.com"))return "linkedin";
    return "generic";
  } catch { return "unknown"; }
}
