import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 15_000;
type Status = 'matched' | 'no_match' | 'error';

type UnifiedSong = {
  id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  artworkSource: string | null;
  durationMs: number | null;
  isrc: string | null;
  confidence: number;
  provider: string | null;
  spotifyUrl: string | null;
  appleMusicUrl: string | null;
  youtubeMusicUrl: string | null;
  audiomackUrl: string | null;
};

type Song = {
  id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  isrc: string | null;
  spotifyUrl: string | null;
  appleMusicUrl: string | null;
  youtubeMusicUrl: string | null;
  audiomackUrl: string | null;
};

type ProviderResult = {
  success: boolean;
  status: Status;
  confidence: number;
  song: Song | null;
  error: string | null;
};

type ParsedAudio = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

const requestId = () => `velvet_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

function json(res: VercelResponse, status: number, body: unknown, id: string) {
  res.setHeader('X-Velvet-Request-Id', id);
  return res.status(status).json(body);
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v || null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function confidencePercent(value: unknown): number {
  const n = numberOrNull(value) ?? 0;
  const percent = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function normalizeUrl(value: unknown): string | null {
  const v = clean(value);
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string {
  return (clean(value) ?? '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameSong(artistA: unknown, titleA: unknown, artistB: unknown, titleB: unknown): boolean {
  const a = normalizeText(artistA), b = normalizeText(artistB);
  const c = normalizeText(titleA), d = normalizeText(titleB);
  if (!a || !b || !c || !d) return false;
  const artistMatch = a === b || a.includes(b) || b.includes(a);
  const titleMatch = c === d || c.includes(d) || d.includes(c);
  return artistMatch && titleMatch;
}

function highResArtwork(url: unknown): string | null {
  const value = normalizeUrl(url);
  if (!value) return null;
  return value
    .replace(/\b\d{2,4}x\d{2,4}(?:bb)?\b/gi, '1000x1000bb')
    .replace(/\b\d{2,4}x\d{2,4}\b/gi, '1000x1000');
}

function normalizeArtworkCandidate(value: unknown): string | null {
  return highResArtwork(value);
}

function unifiedSong(primary: ProviderResult, secondary: ProviderResult): UnifiedSong | null {
  const first = primary.song;
  const second = secondary.song;
  if (!first && !second) return null;

  const base = first ?? second!;
  const other = first ? second : null;
  const artwork = firstString(base.artworkUrl, other?.artworkUrl);
  const spotifyUrl = firstString(base.spotifyUrl, other?.spotifyUrl);
  const appleMusicUrl = firstString(base.appleMusicUrl, other?.appleMusicUrl);
  const youtubeMusicUrl = firstString(base.youtubeMusicUrl, other?.youtubeMusicUrl);
  const audiomackUrl = firstString(base.audiomackUrl, other?.audiomackUrl);

  return {
    id: firstString(base.id, other?.id),
    title: firstString(base.title, other?.title),
    artist: firstString(base.artist, other?.artist),
    album: firstString(base.album, other?.album),
    artworkUrl: normalizeArtworkCandidate(artwork),
    artworkSource: artwork ? 'recognition' : null,
    durationMs: numberOrNull(base.durationMs) ?? numberOrNull(other?.durationMs),
    isrc: firstString(base.isrc, other?.isrc),
    confidence: Math.max(primary.confidence, secondary.confidence),
    provider: primary.song ? 'audd' : 'acrcloud',
    spotifyUrl,
    appleMusicUrl,
    youtubeMusicUrl,
    audiomackUrl,
  };
}

async function artworkFromSpotify(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await withTimeout(fetch(endpoint, { headers: { Accept: 'application/json' } }), 5000);
    if (!response.ok) return null;
    const data: any = await response.json().catch(() => null);
    return normalizeArtworkCandidate(data?.thumbnail_url);
  } catch { return null; }
}

async function artworkFromITunes(artist: string | null, title: string | null): Promise<string | null> {
  if (!artist || !title) return null;
  try {
    const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=5`;
    const response = await withTimeout(fetch(endpoint, { headers: { Accept: 'application/json' } }), 5000);
    if (!response.ok) return null;
    const data: any = await response.json().catch(() => null);
    const results = Array.isArray(data?.results) ? data.results : [];
    const exact = results.find((item: any) => sameSong(item?.artistName, item?.trackName, artist, title));
    return normalizeArtworkCandidate(exact?.artworkUrl100);
  } catch { return null; }
}

async function artworkFromDeezer(artist: string | null, title: string | null): Promise<string | null> {
  if (!artist || !title) return null;
  try {
    const endpoint = `https://api.deezer.com/search?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=5`;
    const response = await withTimeout(fetch(endpoint, { headers: { Accept: 'application/json' } }), 5000);
    if (!response.ok) return null;
    const data: any = await response.json().catch(() => null);
    const results = Array.isArray(data?.data) ? data.data : [];
    const exact = results.find((item: any) => sameSong(item?.artist?.name, item?.title, artist, title));
    return normalizeArtworkCandidate(exact?.album?.cover_xl ?? exact?.album?.cover_big ?? exact?.album?.cover_medium);
  } catch { return null; }
}

async function artworkFromMusicBrainz(artist: string | null, title: string | null): Promise<string | null> {
  if (!artist || !title) return null;
  try {
    const query = `artist:"${artist.replace(/([\\\\"])/g, '\\\\$1')}" AND releasegroup:"${title.replace(/([\\\\"])/g, '\\\\$1')}"`;
    const endpoint = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=3`;
    const response = await withTimeout(fetch(endpoint, {
      headers: { Accept: 'application/json', 'User-Agent': 'VelvetMusic/1.0 (music-recognition backend)' },
    }), 5000);
    if (!response.ok) return null;
    const data: any = await response.json().catch(() => null);
    const groups = Array.isArray(data?.['release-groups']) ? data['release-groups'] : [];
    const exact = groups.find((item: any) => sameSong(item?.['artist-credit']?.[0]?.name ?? item?.['artist-credit']?.[0]?.artist?.name, item?.title, artist, title));
    const mbid = clean(exact?.id);
    if (!mbid) return null;
    const cover = `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-1200`;
    const coverResponse = await withTimeout(fetch(cover, { method: 'HEAD' }), 5000);
    return coverResponse.ok || coverResponse.status === 307 ? cover : null;
  } catch { return null; }
}

async function resolveArtwork(song: UnifiedSong): Promise<UnifiedSong> {
  if (song.artworkUrl) return song;

  const [spotify, itunes, deezer] = await Promise.all([
    artworkFromSpotify(song.spotifyUrl),
    artworkFromITunes(song.artist, song.title),
    artworkFromDeezer(song.artist, song.title),
  ]);

  const fallback = spotify ?? itunes ?? deezer;
  if (fallback) return { ...song, artworkUrl: fallback, artworkSource: spotify ? 'spotify_oembed' : itunes ? 'itunes' : 'deezer' };

  const musicBrainz = await artworkFromMusicBrainz(song.artist, song.title);
  return musicBrainz ? { ...song, artworkUrl: musicBrainz, artworkSource: 'musicbrainz_cover_art_archive' } : song;
}

function normalizeMimeType(value: unknown, filename: string): string {
  const mime = clean(value)?.toLowerCase();
  if (mime && mime !== 'application/octet-stream') return mime;

  const extension = filename.toLowerCase().split('.').pop();
  const byExtension: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    aac: 'audio/aac',
  };
  return byExtension[extension ?? ''] ?? 'application/octet-stream';
}

const providerError = (error: string): ProviderResult => ({ success: false, status: 'error', confidence: 0, song: null, error });
const noMatch = (): ProviderResult => ({ success: false, status: 'no_match', confidence: 0, song: null, error: null });
const matched = (song: Song, confidence: number): ProviderResult => ({ success: true, status: 'matched', confidence, song, error: null });

function auddSong(result: any): Song {
  const spotifyId = clean(result?.spotify?.id) ?? clean(result?.spotify?.track?.id);
  return {
    id: firstString(result?.id, spotifyId),
    title: firstString(result?.title),
    artist: firstString(result?.artist, result?.artist?.name),
    album: firstString(result?.album, result?.album?.name),
    artworkUrl: normalizeUrl(result?.spotify?.album?.images?.[0]?.url ?? result?.apple_music?.artwork?.url),
    durationMs: numberOrNull(result?.duration) != null ? Math.round(Number(result.duration) * 1000) : null,
    isrc: firstString(result?.isrc, result?.spotify?.external_ids?.isrc),
    spotifyUrl: normalizeUrl(result?.spotify?.external_urls?.spotify) ?? (spotifyId ? `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}` : null),
    appleMusicUrl: normalizeUrl(result?.apple_music?.url ?? result?.apple_music?.trackViewUrl),
    youtubeMusicUrl: null,
    audiomackUrl: null,
  };
}

function acrSong(result: any): Song {
  const music = result?.metadata?.music?.[0] ?? {};
  const external = music?.external_metadata ?? {};
  const spotifyId = clean(external?.spotify?.track?.id);
  const youtubeId = clean(external?.youtube?.vid);
  const appleId = clean(external?.apple_music?.track?.id);
  return {
    id: firstString(music?.acrid),
    title: firstString(music?.title),
    artist: firstString(music?.artists?.[0]?.name, music?.artist?.name),
    album: firstString(music?.album?.name),
    artworkUrl: normalizeUrl(music?.album?.image),
    durationMs: numberOrNull(music?.duration_ms ?? music?.duration),
    isrc: firstString(music?.external_ids?.isrc, music?.external_ids?.isrcs?.[0]),
    spotifyUrl: normalizeUrl(external?.spotify?.track?.link) ?? (spotifyId ? `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}` : null),
    appleMusicUrl: normalizeUrl(external?.apple_music?.track?.link) ?? (appleId ? `https://music.apple.com/us/song/${encodeURIComponent(appleId)}` : null),
    youtubeMusicUrl: youtubeId ? `https://music.youtube.com/watch?v=${encodeURIComponent(youtubeId)}` : null,
    audiomackUrl: null,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`Provider timeout after ${ms}ms`)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function audd(audio: Buffer, filename: string, mimeType: string): Promise<ProviderResult> {
  const token = process.env.AUDD_API_TOKEN;
  if (!token) return providerError('AUDD_API_TOKEN is not configured');
  try {
    const form = new FormData();
    form.append('api_token', token);
    form.append('return', 'apple_music,spotify');
    form.append('file', new Blob([audio], { type: mimeType }), filename || 'audio');
    const response = await withTimeout(fetch('https://api.audd.io/', { method: 'POST', body: form }), PROVIDER_TIMEOUT_MS);
    const data: any = await response.json().catch(() => null);
    if (!response.ok) return providerError(`AudD HTTP ${response.status}`);
    if (data?.status !== 'success') return providerError(clean(data?.error?.error_message) ?? 'AudD request failed');
    if (!data?.result) return noMatch();
    return matched(auddSong(data.result), 100);
  } catch (error) {
    return providerError(error instanceof Error ? error.message : 'AudD request failed');
  }
}

function hmacSha1Base64(secret: string, message: string): string {
  return crypto.createHmac('sha1', secret).update(message).digest('base64');
}

async function acrcloud(audio: Buffer, filename: string, mimeType: string): Promise<ProviderResult> {
  const host = process.env.ACRCLOUD_HOST;
  const accessKey = process.env.ACRCLOUD_ACCESS_KEY;
  const accessSecret = process.env.ACRCLOUD_ACCESS_SECRET;
  if (!host || !accessKey || !accessSecret) return providerError('ACRCloud environment variables are not fully configured');
  try {
    const httpMethod = 'POST';
    const httpUri = '/v1/identify';
    const dataType = 'audio';
    const signatureVersion = '1';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = hmacSha1Base64(accessSecret, [httpMethod, httpUri, accessKey, dataType, signatureVersion, timestamp].join('\n'));
    const form = new FormData();
    form.append('access_key', accessKey);
    form.append('sample_bytes', String(audio.byteLength));
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('data_type', dataType);
    form.append('signature_version', signatureVersion);
    form.append('sample', new Blob([audio], { type: mimeType }), filename || 'audio');
    const response = await withTimeout(fetch(`https://${host}/v1/identify`, { method: 'POST', body: form }), PROVIDER_TIMEOUT_MS);
    const data: any = await response.json().catch(() => null);
    if (!response.ok) return providerError(`ACRCloud HTTP ${response.status}`);
    const code = Number(data?.status?.code);
    const message = clean(data?.status?.msg) ?? 'ACRCloud request failed';
    if (code === 0 && data?.metadata?.music?.length) {
      const music = data.metadata.music[0];
      return matched(acrSong(data), confidencePercent(music?.score ?? 0));
    }
    if (code === 1001 || /not\s*found|no\s*result|no\s*match/i.test(message)) return noMatch();
    return providerError(`ACRCloud ${code || 'error'}: ${message}`);
  } catch (error) {
    return providerError(error instanceof Error ? error.message : 'ACRCloud request failed');
  }
}

function parseAudio(req: VercelRequest): Promise<ParsedAudio> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize: MAX_AUDIO_BYTES,
      maxFiles: 1,
      allowEmptyFiles: false,
    });

    form.parse(req, async (error, fields, files) => {
      if (error) {
        const message = error instanceof Error ? error.message : 'Unable to parse multipart request';
        return reject(new Error(message));
      }

      const value = files.audio;
      const file = Array.isArray(value) ? value[0] : value;
      const fieldNames = Object.keys({ ...fields, ...files });

      if (fieldNames.length !== 1 || !file) {
        return reject(new Error('Request must contain exactly one multipart field named: audio'));
      }

      if (file.size > MAX_AUDIO_BYTES) {
        return reject(new Error('Audio file exceeds 5 MB'));
      }

      try {
        const buffer = await fs.readFile(file.filepath);
        if (!buffer.length) return reject(new Error('Audio file is empty'));

        const filename = file.originalFilename ?? 'audio';
        const mimeType = normalizeMimeType(file.mimetype, filename);
        resolve({ buffer, filename, mimeType });
      } catch (e) {
        reject(e);
      }
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = requestId();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('X-Velvet-Request-Id', id);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return json(res, 405, { success: false, error: 'Method not allowed', requestId: id }, id);
  }

  const trace: string[] = [`request:${id}`, 'received:batch'];

  try {
    const { buffer, filename, mimeType } = await parseAudio(req);
    trace.push(`audio:${buffer.byteLength} bytes`, `mime:${mimeType}`, `filename:${filename}`);

    const [auddResult, acrResult] = await Promise.all([
      audd(buffer, filename, mimeType),
      acrcloud(buffer, filename, mimeType),
    ]);

    trace.push(`audd:${auddResult.status}`, `acrcloud:${acrResult.status}`);
    const success = auddResult.status === 'matched' || acrResult.status === 'matched';
    trace.push(`completed:${success ? 'matched' : 'no_match'}`);

    if (!success) {
      return json(res, 200, {
        success: false,
        requestId: id,
        song: null,
      }, id);
    }

    const primary = auddResult.status === 'matched' ? auddResult : acrResult;
    const secondary = primary === auddResult ? acrResult : auddResult;
    const unified = unifiedSong(primary, secondary);
    const song = unified ? await resolveArtwork(unified) : null;

    if (!song) {
      return json(res, 200, {
        success: false,
        requestId: id,
        song: null,
      }, id);
    }

    return json(res, 200, {
      success: true,
      requestId: id,
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        artworkUrl: song.artworkUrl,
        artworkSource: song.artworkSource,
        durationMs: song.durationMs,
        isrc: song.isrc,
        confidence: song.confidence,
        provider: song.provider,
        platforms: {
          spotifyUrl: song.spotifyUrl,
          appleMusicUrl: song.appleMusicUrl,
          youtubeMusicUrl: song.youtubeMusicUrl,
          audiomackUrl: song.audiomackUrl,
        },
      },
    }, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid recognition request';
    const isPayloadTooLarge = /exceeds 5 MB|maxFileSize|larger than the configured limit|too large/i.test(message);
    const isBadRequest = /missing multipart|exactly one multipart|empty|multipart/i.test(message);
    const status = isPayloadTooLarge ? 413 : isBadRequest ? 400 : 500;

    trace.push(`request_error:${message}`);
    return json(res, status, {
      success: false,
      requestId: id,
      song: null,
      error: message,
    }, id);
  }
}
