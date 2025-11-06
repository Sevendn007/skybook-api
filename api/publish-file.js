// api/publish-file.js
import { request } from 'undici';
import Busboy from 'busboy';

export const config = { api: { bodyParser: false } };

/**
 * POST /api/publish-file?mode=draft|publish
 * Headers:
 *   Authorization: Bearer <access_token>
 *   X-Caption: optional caption/title
 * Body (multipart/form-data):
 *   video: <mp4 file>
 *
 * Trả về JSON: { step, init, upload, publish? } hoặc { error }
 */
export default async function handler(req, res) {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Caption');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing access token' });

  try {
    const url = new URL(req.url, 'https://dummy');
    const mode = (url.searchParams.get('mode') || 'draft').toLowerCase(); // 'draft' | 'publish'
    const caption = (req.headers['x-caption'] || '').toString();

    // 1) INIT cho FILE_UPLOAD
    const signal = AbortSignal.timeout(20000); // timeout 20s
    const isDraft = mode === 'draft';
    const initEndpoint = isDraft
      ? 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
      : 'https://open.tiktokapis.com/v2/post/publish/video/init/';

    const initBody = isDraft
      ? { source_info: { source: 'FILE_UPLOAD' } }
      : {
          post_info: { privacy_level: 'SELF_ONLY', title: caption || '' },
          source_info: { source: 'FILE_UPLOAD' }
        };

    const initResp = await request(initEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify(initBody),
      signal
    });
    const initData = await initResp.body.json();

    if (initResp.statusCode < 200 || initResp.statusCode >= 300) {
      return res.status(initResp.statusCode).json({ step: 'init', response: initData });
    }

    // Lấy upload_url từ init (tùy phiên bản API có thể là data.upload_url hoặc tương tự)
    const uploadUrl =
      initData?.data?.upload_url ||
      initData?.data?.upload?.upload_url ||
      initData?.upload_url;

    if (!uploadUrl) {
      return res.status(500).json({ error: 'No upload_url in init response', init: initData });
    }

    // 2) Nhận file từ multipart và stream lên TikTok
    const busboy = Busboy({ headers: req.headers });
    let uploadResult = null;

    const done = new Promise((resolve, reject) => {
      let gotFile = false;
      busboy.on('file', async (_name, file, _info) => {
        gotFile = true;
        try {
          const upResp = await request(uploadUrl, {
            method: 'PUT',
            body: file, // stream trực tiếp
            headers: { 'Content-Type': 'video/mp4' },
            signal: AbortSignal.timeout(120000) // 120s cho upload
          });
          const upText = await upResp.body.text();
          uploadResult = { status: upResp.statusCode, body: upText };
        } catch (err) {
          uploadResult = { status: 500, error: String(err) };
        }
      });
      busboy.on('finish', () => {
        if (!uploadResult && !gotFile) {
          reject(new Error('No file field "video" found in multipart form'));
        } else {
          resolve();
        }
      });
      busboy.on('error', reject);
    });

    req.pipe(busboy);
    await done;

    if (!uploadResult || uploadResult.status < 200 || uploadResult.status >= 300) {
      return res.status(400).json({ step: 'upload', init: initData, upload: uploadResult });
    }

    // 3) (Tùy phiên bản API) Nếu cần PUBLISH/FINALIZE, gọi tiếp ở đây.
    // Nhiều biến thể Inbox (draft) KHÔNG cần finalize, còn Direct Post có thể cần finalize.
    // Ở đây mình trả về init + upload để bạn thấy kết quả lập tức và UI không bị treo.
    return res.status(200).json({
      step: isDraft ? 'inbox_upload_done' : 'direct_upload_done',
      init: initData,
      upload: uploadResult,
      note: isDraft
        ? 'Video đã upload vào inbox/draft. Kiểm tra trong TikTok App.'
        : 'Video đã upload cho direct post. Nếu API yêu cầu finalize, thêm bước finalize theo docs.'
    });
  } catch (e) {
    const message = String(e?.message || e);
    const status = /aborted|timeout/i.test(message) ? 504 : 500;
    return res.status(status).json({ error: message });
  }
}
