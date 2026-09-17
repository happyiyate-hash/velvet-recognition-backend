import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let payload: unknown = null;
  if (req.method === 'POST') {
    payload = req.body ?? null;
  }

  return res.status(200).json({
    success: true,
    service: 'velvet-recognition-backend',
    endpoint: '/v1/recognition/test',
    message: 'Backend function is running and responding.',
    method: req.method,
    timestamp: new Date().toISOString(),
    echo: payload,
  });
}
