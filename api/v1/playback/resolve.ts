import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(410).json({
    success: false,
    error: 'Playback resolution is disabled. Velvet backend only performs song recognition.'
  });
}

/*
  The previous SoundCloud playback resolver is intentionally retained,
  unchanged, at:

  archive/playback/resolve.ts.disabled

  It is archived and disconnected from the live API. It is not imported,
  routed, or executed by the backend.
*/
