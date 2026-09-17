import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };
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

function hmacSha1Base64(secret: string, message: string): string {
  return crypto.createHmac('sha1', secret).update(message).digest('base64');
}

async function acrcloud(audio: Buffer, filename: string): Promise<ProviderResult> {
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
    form.append('sample', new Blob([audio], { type: 'audio/wav' }), filename || 'audio.wav');
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

function parseAudio(req: VercelRequest): Promise<{ buffer: Buffer; filename: string }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false, maxFileSize: MAX_AUDIO_BYTES, maxFiles: 1, allowEmptyFiles: false });
    form.parse(req, async (error, _fields, files) => {
      if (error) return reject(error);
      const value = files.audio;
      const file = Array.isArray(value) ? value[0] : value;
      if (!file) return reject(new Error('Missing multipart field: audio'));
      if (file.size > MAX_AUDIO_BYTES) return reject(new Error('Audio file exceeds 5 MB'));
      try {
        const buffer = await fs.readFile(file.filepath);
        if (!buffer.length) return reject(new Error('Audio file is empty'));
        resolve({ buffer, filename: file.originalFilename ?? 'audio.wav' });
      } catch (e) { reject(e); }
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
    const [auddResult, acrResult] = await Promise.all([audd(buffer, filename), acrcloud(buffer, filename)]);
    trace.push(`audd:${auddResult.status}`, `acrcloud:${acrResult.status}`);
    const success = auddResult.status === 'matched' || acrResult.status === 'matched';
    trace.push(`completed:${success ? 'matched' : 'no_match'}`);
    return json(res, 200, {
      success,
      requestId: id,
      results: { audd: auddResult, acrcloud: acrResult },
      trace,
    }, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid recognition request';
    const status = /missing multipart|exceeds 5 MB|empty/i.test(message) ? 400 : 500;
    trace.push(`request_error:${message}`);
    return json(res, status, {
      success: false,
      requestId: id,
      results: { audd: providerError('Request was not processed'), acrcloud: providerError('Request was not processed') },
      trace,
    }, id);
  }
}
