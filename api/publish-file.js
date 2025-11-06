// api/publish-file.js
import { request } from 'undici';
import Busboy from 'busboy';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing access token' });

  // Lấy mode
  const url = new URL(req.url, 'http://localhost');
  const mode = (url.searchParams.get('mode') || 'draft').toLowerCase(); // draft | publish

  // Chuẩn bị đọc multipart
  const busboy = Busboy({ headers: req.headers });
  let caption = '';
  let uploadResult = null;
  let gotFile = false;
  let fileStream = null;

  const parts = new Promise((resolve, reject) => {
    busboy.on('field', (name, value) => {
      if (name === 'caption') caption = value;
    });

    busboy.on('file', (_name, file) => {
      gotFile = true;
      fileStream = file; // giữ stream video
    });

    busboy.on('finish', () => {
      if (!gotFile) reject(new Error('No video file uploaded (field name must be "video")'));
      else resolve();
    });

    busboy.on('error', reject);
  });

  req.pipe(busboy);
  await parts;

  // 1) Gọi INIT (lấy upload_url & publish_id)
  try {
    const initEndpoint = mode === 'draft'
      ? 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
      : 'https://open.tiktokapis.com/v2/post/publish/video/init/';

    const initBody = mode === 'draft'
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
      signal: AbortSignal.timeout(20000)
    });

    const initData = await initResp.body.json();

    if (!initResp.ok) {
      return res.status(initResp.statusCode).json({ step: 'init_failed', response: initData });
    }

    const publishId = initData?.data?.publish_id;
    const uploadUrl =
      initData?.data?.upload_url ||
      initData?.data?.upload?.upload_url ||
      null;

    if (!uploadUrl) {
      return res.status(500).json({ error: 'No upload_url returned', initData });
    }

    // 2) UPLOAD video vào upload_url
    const uploadResp = await request(uploadUrl, {
      method: 'PUT',
      body: fileStream,
      headers: { 'Content-Type': 'video/mp4' },
      signal: AbortSignal.timeout(120000)
    });

    const uploadText = await uploadResp.body.text();
    uploadResult = { status: uploadResp.statusCode, body: uploadText };

    if (!uploadResp.ok) {
      return res.status(uploadResp.statusCode).json({
        step: 'upload_failed',
        init: initData,
        upload: uploadResult
      });
    }

    // 3) Nếu Draft → xong
    if (mode === 'draft') {
      return res.status(200).json({
        success: true,
        mode: 'draft',
        message: '✅ Video đã upload vào Draft (Inbox). Mở TikTok → mục Nháp để xem.',
        init: initData,
        upload: uploadResult
      });
    }

    // 4) Nếu Publish → cần Finalize
    const finalizeResp = await request(
      'https://open.tiktokapis.com/v2/post/publish/video/',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          publish_id: publishId,
          post_info: { title: caption || '', privacy_level: 'SELF_ONLY' }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const finalizeData = await finalizeResp.body.json();

    if (!finalizeResp.ok) {
      return res.status(finalizeResp.statusCode).json({
        step: 'finalize_failed',
        init: initData,
        upload: uploadResult,
        finalize: finalizeData
      });
    }

    return res.status(200).json({
      success: true,
      mode: 'publish',
      message: '✅ Video đã đăng lên TikTok (chế độ SELF_ONLY).',
      init: initData,
      upload: uploadResult,
      finalize: finalizeData
    });

  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
