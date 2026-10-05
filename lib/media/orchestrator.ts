import {detectMediaPlatform} from "./detector";
import {normalizeMediaResult} from "./response";
import type {MediaExtractRequest,MediaExtractResult} from "./types";
import {extractYouTube} from "./extractors/youtube"; import {extractTikTok} from "./extractors/tiktok"; import {extractInstagram} from "./extractors/instagram"; import {extractFacebook} from "./extractors/facebook"; import {extractTwitter} from "./extractors/twitter"; import {extractReddit} from "./extractors/reddit"; import {extractPinterest} from "./extractors/pinterest"; import {extractLinkedIn} from "./extractors/linkedin"; import {extractGeneric} from "./extractors/generic";
export async function orchestrateMediaExtraction(request:MediaExtractRequest):Promise<MediaExtractResult>{
 const platform=detectMediaPlatform(request.url);
 const extractors={youtube:extractYouTube,tiktok:extractTikTok,instagram:extractInstagram,facebook:extractFacebook,twitter:extractTwitter,reddit:extractReddit,pinterest:extractPinterest,linkedin:extractLinkedIn,generic:extractGeneric,unknown:extractGeneric};
 return normalizeMediaResult(await extractors[platform](request.url));
}
