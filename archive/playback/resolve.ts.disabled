import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

const TOKEN_KEY = 'velvet:soundcloud:access_token';
const LOCK_KEY = 'velvet:soundcloud:access_token:refresh_lock';
const TOKEN_TTL = 3300;
const LOCK_TTL = 15;
const TIMEOUT = 10000;

type Track = {
  urn?: string;
  id?: number;
  title?: string;
  duration?: number;
  permalink_url?: string;
  streamable?: boolean;
  user?: { username?: string };
  publisher_metadata?: { artist?: string; isrc?: string };
};

const clean = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const norm = (v: unknown) => (clean(v) ?? '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const isrc = (v: unknown) => clean(v)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function redis() {
  const url = clean(process.env.KV_REST_API_URL);
  const token = clean(process.env.KV_REST_API_TOKEN);
  return url && token ? new Redis({ url, token }) : null;
}

async function timeout<T>(p: Promise<T>, ms = TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Provider timeout')), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function token(force = false): Promise<string> {
  const id = clean(process.env.SOUNDCLOUD_CLIENT_ID);
  const secret = clean(process.env.SOUNDCLOUD_CLIENT_SECRET);
  if (!id || !secret) throw new Error('SoundCloud credentials are not configured');

  const db = redis();
  if (!db) throw new Error('Vercel Redis is not configured');

  if (!force) {
    const cached = await db.get<string>(TOKEN_KEY);
    if (cached) return cached;
  }

  const owner = crypto.randomUUID();
  const acquired = await db.set(LOCK_KEY, owner, { nx: true, ex: LOCK_TTL });

  if (!acquired) {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 150 + i * 100));
      const cached = await db.get<string>(TOKEN_KEY);
      if (cached) return cached;
    }
    throw new Error('SoundCloud token refresh is busy; please retry');
  }

  try {
    const cached = await db.get<string>(TOKEN_KEY);
    if (cached) return cached;

    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const response = await timeout(fetch('https://secure.soundcloud.com/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }));

    const data: any = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      throw new Error(`SoundCloud token request failed (HTTP ${response.status})`);
    }

    await db.set(TOKEN_KEY, data.access_token, { ex: TOKEN_TTL });
    return data.access_token as string;
  } finally {
    try {
      if (await db.get<string>(LOCK_KEY) === owner) await db.del(LOCK_KEY);
    } catch {}
  }
}

async function sc(path: string, accessToken: string) {
  return timeout(fetch(`https://api.soundcloud.com${path}`, {
    headers: { Accept: 'application/json', Authorization: `OAuth ${accessToken}` },
  }));
}

function artistMatch(t: Track, artist: string) {
  const wanted = norm(artist);
  const values = [t.user?.username, t.publisher_metadata?.artist].map(norm).filter(Boolean);
  return values.some(v => v === wanted || v.includes(wanted) || wanted.includes(v));
}

function titleMatch(t: Track, title: string) {
  const a = norm(t.title), b = norm(title);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

function choose(tracks: Track[], artist: string, title: string, wantedIsrc: string | null, duration: number | null) {
  const candidates = tracks.filter(t => titleMatch(t, title) && artistMatch(t, artist))
    .filter(t => !duration || !t.duration || Math.abs(t.duration - duration) <= 10000);

  candidates.sort((a, b) => score(b, artist, title, wantedIsrc, duration) - score(a, artist, title, wantedIsrc, duration));
  return candidates[0] ?? null;
}

function score(t: Track, artist: string, title: string, wantedIsrc: string | null, duration: number | null) {
  let s = 0;
  if (norm(t.title) === norm(title)) s += 50;
  if (norm(t.user?.username) === norm(artist) || norm(t.publisher_metadata?.artist) === norm(artist)) s += 40;
  if (wantedIsrc && isrc(t.publisher_metadata?.isrc) === wantedIsrc) s += 100;
  if (duration && t.duration && Math.abs(t.duration - duration) <= 2000) s += 10;
  return s;
}

async function search(accessToken: string, artist: string, title: string): Promise<Track[]> {
  const q = encodeURIComponent(`${artist} ${title}`);
  const response = await sc(`/tracks?q=${q}&access=playable&limit=10&linked_partitioning=true`, accessToken);
  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    const e: any = new Error(`SoundCloud search failed (HTTP ${response.status})`);
    e.status = response.status;
    throw e;
  }
  return Array.isArray(data) ? data : (Array.isArray(data?.collection) ? data.collection : []);
}

async function stream(track: Track, accessToken: string): Promise<string | null> {
  const urn = clean(track.urn) ?? (track.id != null ? `soundcloud:tracks:${track.id}` : null);
  if (!urn) return null;
  const response = await sc(`/tracks/${encodeURIComponent(urn)}/streams`, accessToken);
  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    const e: any = new Error(`SoundCloud stream lookup failed (HTTP ${response.status})`);
    e.status = response.status;
    throw e;
  }
  return clean(data?.hls_aac_160_url) ??
    clean(data?.hls_aac_96_url) ??
    clean(data?.hls_mp3_128_url) ??
    clean(data?.http_mp3_128_url);
}

function response(res: VercelResponse, status: number, body: any, id: string) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('X-Velvet-Request-Id', id);
  return res.status(status).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = `velvet_playback_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

  if (req.method === 'OPTIONS') return response(res, 204, {}, id);
  if (req.method !== 'POST') return response(res, 405, {
    success: false, provider: null, streamUrl: null, expiresAt: null, trackUrl: null, error: 'POST required'
  }, id);

  try {
    const body = (req.body ?? {}) as {
      artist?: unknown; title?: unknown; isrc?: unknown; durationMs?: unknown;
    };
    const artist = clean(body.artist);
    const title = clean(body.title);
    const wantedIsrc = isrc(body.isrc);
    const duration = num(body.durationMs);

    if (!artist || !title) return response(res, 400, {
      success: false, provider: null, streamUrl: null, expiresAt: null, trackUrl: null,
      error: 'artist and title are required'
    }, id);

    let accessToken = await token();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const tracks = await search(accessToken, artist, title);
        const track = choose(tracks, artist, title, wantedIsrc, duration);

        if (!track) return response(res, 404, {
          success: false, provider: 'soundcloud', streamUrl: null, expiresAt: null, trackUrl: null,
          error: 'No exact playable SoundCloud match was found'
        }, id);

        const streamUrl = await stream(track, accessToken);
        if (!streamUrl) return response(res, 404, {
          success: false, provider: 'soundcloud', streamUrl: null, expiresAt: null,
          trackUrl: clean(track.permalink_url), error: 'Matched SoundCloud track is not currently streamable'
        }, id);

        return response(res, 200, {
          success: true, provider: 'soundcloud', streamUrl, expiresAt: null,
          trackUrl: clean(track.permalink_url), error: null
        }, id);
      } catch (e: any) {
        if (e?.status === 401 && attempt === 0) {
          const db = redis();
          if (db) await db.del(TOKEN_KEY);
          accessToken = await token(true);
          continue;
        }
        throw e;
      }
    }

    throw new Error('SoundCloud playback resolution failed');
  } catch (e) {
    return response(res, 500, {
      success: false, provider: 'soundcloud', streamUrl: null, expiresAt: null, trackUrl: null,
      error: e instanceof Error ? e.message : 'Playback resolution failed'
    }, id);
  }
}
