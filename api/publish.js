import { request } from 'undici';

/**
 * Endpoint mẫu để gọi TikTok Content Posting API (Sandbox).
 * Ý tưởng:
 *  1) INIT (khởi tạo bài đăng, chọn mode Publish/Draft, đặt caption)
 *  2) (tùy chọn) UPLOAD nếu bạn không dùng Pull-from-URL
 *  3) PUBLISH/FINALIZE
 * => Điền đúng path/fields theo tài liệu đang dùng.
 */
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

    const caption = req.headers['x-caption']?.toString() || '';
    const mode = req.headers['x-mode']?.toString() || 'publish'; // 'publish' | 'draft'
    const sourceUrl = req.headers['x-source-url']?.toString() || ''; // nếu demo bằng Pull-from-URL

    // TODO(1): INIT — thay endpoint & body theo docs hiện hành
    const initResp = await request('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_info: { title: caption },
        // Ví dụ nếu dùng Pull-from-URL:
        // media_source: { type: 'PULL_FROM_URL', url: sourceUrl }
        // publish_mode: mode === 'draft' ? 'DRAFT' : 'PUBLISH'
      })
    });
    const initData = await initResp.body.json();
    if (initResp.statusCode < 200 || initResp.statusCode >= 300) {
      return res.status(initResp.statusCode).json({ step: 'init', response: initData });
    }

    // TODO(2): Nếu INIT trả upload_url và bạn muốn upload binary:
    // - Đọc file từ req (FormData) và stream đến upload_url
    // - Với demo: khuyên dùng PULL_FROM_URL để khỏi phải upload binary

    // TODO(3): PUBLISH/FINALIZE — thay endpoint & body theo docs
    const publishResp = await request('https://open.tiktokapis.com/v2/post/publish/content/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Truyền id từ initData, set publish_mode tương ứng
      })
    });
    const publishData = await publishResp.body.json();

    return res.status(publishResp.statusCode).json({
      step: 'publish', init: initData, publish: publishData
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
