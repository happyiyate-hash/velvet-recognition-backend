import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable, { type File as FormidableFile } from 'formidable';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 15_000;

type Status = 'matched' | 'no_match' | 'error';

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

function requestId(): string {
  return `velvet_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function json(res: VercelResponse, status: number, body: unknown, id?: string) {
  if (id) res.setHeader('X-Velvet-Request-Id', id);
  return res.status(status).json(body);
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v : null;
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

function providerError(message: string): ProviderResult {
  return { success: false, status: 'error', confidence: 0, song: null, error: message };
}

function noMatch(): ProviderResult {
  return { success: false, status: 'no_match', confidence: 0, song: null, error: null };
}

function matched(song: Song, confidence: number): ProviderResult {
  return { success: true, status: 'matched', confidence, song, error: null };
}

function auddSong(result: any): Song {
  const spotifyId = clean(result?.spotify?.id) ?? clean(result?.spotify?.track?.id);
  const appleUrl = normalizeUrl(result?.apple_music?.url ?? result?.apple_music?.trackViewUrl);
  const spotifyUrl = normalizeUrl(result?.spotify?.external_urls?.spotify) ??
    (spotifyId ? `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}` : null);

  return {
    id: firstString(result?.song_link, result?.id, result?.spotify?.id),
    title: firstString(result?.title),
    artist: firstString(result?.artist, result?.artist?.name),
    album: firstString(result?.album, result?.album?.name),
    artworkUrl: normalizeUrl(result?.spotify?.album?.images?.[0]?.url ?? result?.apple_music?.artwork?.url),
    durationMs: numberOrNull(result?.duration) != null ? Math.round(Number(result.duration) * 1000) : null,
    isrc: firstString(result?.isrc, result?.spotify?.external_ids?.isrc),
    spotifyUrl,
    appleMusicUrl: appleUrl,
    youtubeMusicUrl: null,
    audiomackUrl: null,
  };
}

function acrSong(result: any): Song {
  const music = result?.metadata?.music?.[0] ?? result?.metadata?.music ?? {};
  const external = music?.external_metadata ?? {};
  const spotifyId = clean(external?.spotify?.track?.id);
  const youtubeId = clean(external?.youtube?.vid);
  const appleId = clean(external?.apple_music?.track?.id);

  const spotifyUrl = normalizeUrl(external?.spotify?.track?.link) ??
    (spotifyId ? `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}` : null);
  const youtubeMusicUrl = youtubeId ? `https://music.youtube.com/watch?v=${encodeURIComponent(youtubeId)}` : null;
  const appleMusicUrl = normalizeUrl(external?.apple_music?.track?.link) ??
    (appleId ? `https://music.apple.com/us/song/${encodeURIComponent(appleId)}` : null);

  return {
    id: firstString(music?.acrid, music?.result?.acrid),
    title: firstString(music?.title),
    artist: firstString(music?.artists?.[0]?.name, music?.artist?.name),
    album: firstString(music?.album?.name),
    artworkUrl: normalizeUrl(music?.album?.image),
    durationMs: numberOrNull(music?.duration_ms ?? music?.duration),
    isrc: firstString(music?.external_ids?.isrc, music?.external_ids?.isrcs?.[0]),
    spotifyUrl,
    appleMusicUrl,
    youtubeMusicUrl,
    audiomackUrl: null,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Provider timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function audd(audio: Buffer, filename: string): Promise<ProviderResult> {
  const token = process.env.AUDD_API_TOKEN;
  if (!token) return providerError('AUDD_API_TOKEN is not configured');

  try {
    const form = new FormData();
    form.append('api_token', token);
    form.append('return', 'apple_music,spotify');
    form.append('file', new Blob([audio], { type: 'audio/wav' }), filename || 'audio.wav');

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

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  return crypto.createHmac('sha1', secret).update(message).digest('base64');
}

async function acrcloud(audio: Buffer, filename: string): Promise<ProviderResult> {
  const host = process.env.ACRCLOUD_HOST;
  const accessKey = process.env.ACRCLOUD_ACCESS_KEY;
  const accessSecret = process.env.ACRCLOUD_ACCESS_SECRET;
  if (!host || !accessKey || !accessSecret) {
    return providerError('ACRCloud environment variables are not fully configured');
  }

  try {
    const httpMethod = 'POST';
    const httpUri = '/v1/identify';
    const dataType = 'audio';
    const signatureVersion = '1';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacSha1Base64(
      accessSecret,
      [httpMethod, httpUri, accessKey, dataType, signatureVersion, timestamp].join('\n'),
    );

    const form = new FormData();
    form.append('access_key', accessKey);
    form.append('sample_bytes', String(audio.byteLength));
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('data_type', dataType);
    form.append('signature_version', signatureVersion);
    form.append('sample', new Blob([audio], { type: 'audio/wav' }), filename || 'audio.wav');

    const response = await withTimeout(fetch(`https://${host}/v1/identify`, { method: 'POST', body: form }), PROVIDER_TIMEOUT_MS);
    const data: any = await response.json().catch(() => null);

    if (!response.ok) return providerError(`ACRCloud HTTP ${response.status}`);

    const code = Number(data?.status?.code);
    const message = clean(data?.status?.msg) ?? 'ACRCloud request failed';
    if (code === 0 && data?.metadata?.music) {
      const music = data.metadata.music[0];
      const confidence = confidencePercent(music?.score ?? data?.result?.score ?? 0);
      return matched(acrSong(data), confidence);
    }

    if (code === 1001 || /not\s*found|no\s*result|no\s*match/i.test(message)) return noMatch();
    return providerError(`ACRCloud ${code || 'error'}: ${message}`);
  } catch (error) {
    return providerError(error instanceof Error ? error.message : 'ACRCloud request failed');
  }
}

function similarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const sx = new Set(x.split(' '));
  const sy = new Set(y.split(' '));
  const intersection = [...sx].filter((v) => sy.has(v)).length;
  return intersection / Math.max(sx.size, sy.size);
}

function chooseAndMerge(auddResult: ProviderResult, acrResult: ProviderResult): ProviderResult {
  const a = auddResult.song;
  const c = acrResult.song;
  if (!a && !c) return auddResult.status === 'error' && acrResult.status === 'error' ? providerError('Both recognition providers failed') : noMatch();
  if (a && !c) return auddResult;
  if (c && !a) return acrResult;

  const sameIsrc = !!a?.isrc && !!c?.isrc && a.isrc.toLowerCase() === c.isrc.toLowerCase();
  const titleArtistSimilarity = (similarity(a?.title ?? null, c?.title ?? null) + similarity(a?.artist ?? null, c?.artist ?? null)) / 2;

  // Android remains the final presentation authority. This helper only provides a
  // normalized server-side fallback for legacy clients that inspect the top-level result.
  const winner = sameIsrc || titleArtistSimilarity >= 0.75
    ? (auddResult.confidence >= acrResult.confidence ? auddResult : acrResult)
    : (auddResult.confidence >= acrResult.confidence ? auddResult : acrResult);

  const base = winner.song!;
  const other = winner === auddResult ? c! : a!;
  const merged: Song = {
    ...base,
    id: base.id ?? other.id,
    title: base.title ?? other.title,
    artist: base.artist ?? other.artist,
    album: base.album ?? other.album,
    artworkUrl: base.artworkUrl ?? other.artworkUrl,
    durationMs: base.durationMs ?? other.durationMs,
    isrc: base.isrc ?? other.isrc,
    spotifyUrl: base.spotifyUrl ?? other.spotifyUrl,
    appleMusicUrl: base.appleMusicUrl ?? other.appleMusicUrl,
    youtubeMusicUrl: base.youtubeMusicUrl ?? other.youtubeMusicUrl,
    audiomackUrl: base.audiomackUrl ?? other.audiomackUrl,
  };

  return matched(merged, Math.max(auddResult.confidence, acrResult.confidence));
}

function parseAudio(req: VercelRequest): Promise<{ buffer: Buffer; filename: string }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize: MAX_AUDIO_BYTES,
      maxFiles: 1,
      allowEmptyFiles: false,
    });

    form.parse(req, async (error, fields, files) => {
      if (error) return reject(error);
      const value = files.audio;
      const file = Array.isArray(value) ? value[0] : value;
      if (!file) return reject(new Error('Missing multipart field: audio'));
      if (file.size > MAX_AUDIO_BYTES) return reject(new Error('Audio file exceeds 5 MB'));
      try {
        const buffer = await fs.readFile(file.filepath);
        if (!buffer.length) return reject(new Error('Audio file is empty'));
        resolve({ buffer, filename: file.originalFilename ?? 'audio.wav' });
      } catch (e) {
        reject(e);
      }
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = requestId();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('X-Velvet-Request-Id', id);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }, id);

  const trace: string[] = [`request:${id}`, 'received:batch'];

  try {
    const { buffer, filename } = await parseAudio(req);
    trace.push(`audio:${buffer.byteLength} bytes`);

    const [auddResult, acrResult] = await Promise.all([
      audd(buffer, filename),
      acrcloud(buffer, filename),
    ]);
    trace.push(`audd:${auddResult.status}`);
    trace.push(`acrcloud:${acrResult.status}`);

    const success = auddResult.status === 'matched' || acrResult.status === 'matched';
    const legacy = chooseAndMerge(auddResult, acrResult);
    trace.push(`completed:${success ? 'matched' : 'no_match'}`);

    return json(res, 200, {
      success,
      requestId: id,
      results: {
        audd: auddResult,
        acrcloud: acrResult,
      },
      trace,
      // Kept only for compatibility with older clients; new Android clients use results.*.
      song: legacy.song,
      confidence: legacy.confidence,
      error: legacy.error,
    }, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid recognition request';
    const status = /missing multipart|exceeds 5 MB|empty/i.test(message) ? 400 : 500;
    trace.push(`request_error:${message}`);
    return json(res, status, {
      success: false,
      requestId: id,
      results: {
        audd: providerError('Request was not processed'),
        acrcloud: providerError('Request was not processed'),
      },
      trace,
    }, id);
  }
}
