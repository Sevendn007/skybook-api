import { request } from 'undici';

export default async function handler(req, res) {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Caption, X-Mode, X-Source-Url');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!accessToken) return res.status(401).json({ error: 'Missing access token' });

    const mode = (req.headers['x-mode'] || 'draft').toString();      // 'draft' | 'publish'
    const caption = (req.headers['x-caption'] || '').toString();
    const sourceUrl = (req.headers['x-source-url'] || '').toString();
    if (!sourceUrl) return res.status(400).json({ error: 'Missing X-Source-Url' });

    const signal = AbortSignal.timeout(15000); // <— timeout 15s

    if (mode === 'draft') {
      // Inbox upload (video.upload)
      const initResp = await request('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
          source_info: { source: 'PULL_FROM_URL', video_url: sourceUrl }
        }),
        signal
      });
      const initData = await initResp.body.json();
      return res.status(initResp.statusCode).json({ step: 'inbox_init', response: initData });
    } else {
      // Direct post (video.publish)
      const initResp = await request('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
          post_info: { privacy_level: 'SELF_ONLY', title: caption },
          source_info: { source: 'PULL_FROM_URL', video_url: sourceUrl }
        }),
        signal
      });
      const initData = await initResp.body.json();
      return res.status(initResp.statusCode).json({ step: 'direct_init', response: initData });
    }
  } catch (e) {
    // Nếu timeout, undici quăng DOMException: "The operation was aborted"
    return res.status(504).json({ error: 'Upstream timeout or network error', detail: String(e) });
  }
}
