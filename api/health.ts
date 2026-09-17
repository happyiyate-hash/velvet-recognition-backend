import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const configured = {
    audd: Boolean(process.env.AUDD_API_TOKEN),
    acrcloud: Boolean(
      process.env.ACRCLOUD_HOST &&
      process.env.ACRCLOUD_ACCESS_KEY &&
      process.env.ACRCLOUD_ACCESS_SECRET,
    ),
  };

  const allConfigured = configured.audd && configured.acrcloud;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  return res.status(200).json({
    success: true,
    service: 'velvet-recognition-backend',
    status: allConfigured ? 'ready' : 'configuration_required',
    timestamp: new Date().toISOString(),
    providers: {
      audd: configured.audd ? 'configured' : 'missing',
      acrcloud: configured.acrcloud ? 'configured' : 'missing',
    },
  });
}
