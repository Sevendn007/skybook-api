// api/status.js
import { request } from 'undici';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing access token' });

  const { publish_id } = req.body || {};
  if (!publish_id) return res.status(400).json({ error: 'Missing publish_id' });

  try {
    const r = await request('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({ publish_id }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.body.json();
    return res.status(r.statusCode).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
