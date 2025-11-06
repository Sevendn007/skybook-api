import { request } from 'undici';

export default async function handler(req, res) {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { code, redirect_uri } = req.body || {};
    const form = new URLSearchParams();
    form.set('client_key', process.env.TIKTOK_CLIENT_KEY);
    form.set('client_secret', process.env.TIKTOK_CLIENT_SECRET);
    form.set('code', code);
    form.set('grant_type', 'authorization_code');
    form.set('redirect_uri', redirect_uri || process.env.TIKTOK_REDIRECT_URI);

    const r = await request('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      body: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = await r.body.json();
    res.status(r.statusCode).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}