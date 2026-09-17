import type { VercelRequest, VercelResponse } from '@vercel/node';

function requestId() {
  return `velvet_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const id = requestId();

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('X-Velvet-Request-Id', id);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const response: Record<string, unknown> = {
    success: true,
    service: 'velvet-recognition-backend',
    endpoint: '/v1/recognition/test',
    message: 'Backend function is running and responding.',
    method: req.method,
    timestamp: new Date().toISOString(),
    requestId: id,
  };

  if (req.method === 'POST') {
    response.body = req.body ?? null;
  }

  return res.status(200).json(response);
}
