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

  const url = new URL(req.url, 'http://localhost');
  const mode = (url.searchParams.get('mode') || 'draft').toLowerCase(); // 'draft' | 'publish'
  const isDraft = mode === 'draft';

  try {
    // 1) Nhận multipart: lấy caption + đọc file 'video' vào Buffer (để biết size)
    const busboy = Busboy({ headers: req.headers });
    let caption = '';
    let fileBufs = [];
    let fileSize = 0;
    let gotFile = false;

    const done = new Promise((resolve, reject) => {
      busboy.on('field', (name, val) => { if (name === 'caption') caption = val; });
      busboy.on('file', (name, file) => {
        if (name !== 'video') { file.resume(); return; }
        gotFile = true;
        file.on('data', (chunk) => { fileBufs.push(chunk); fileSize += chunk.length; });
        file.on('limit', () => reject(new Error('File too large')));
        file.on('end', () => resolve());
      });
      busboy.on('finish', () => { if (!gotFile) reject(new Error('No video file uploaded (field "video")')); });
      busboy.on('error', reject);
    });

    req.pipe(busboy);
    await done;

    const videoBuffer = Buffer.concat(fileBufs);
    const videoSize = fileSize;
    if (!videoSize) return res.status(400).json({ error: 'Empty video file' });

    // 2) INIT (FILE_UPLOAD) theo yêu cầu của TikTok: cần video_size, chunk_size, total_chunk_count
    const initEndpoint = isDraft
      ? 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
      : 'https://open.tiktokapis.com/v2/post/publish/video/init/';

    const source_info = {
      source: 'FILE_UPLOAD',
      video_size: videoSize,
      chunk_size: videoSize,       // 1 chunk
      total_chunk_count: 1
    };

    const initBody = isDraft
      ? { source_info }
      : { post_info: { privacy_level: 'SELF_ONLY', title: caption || '' }, source_info };

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

    const publishId = initData?.data?.publish_id || null;
    const uploadUrl =
      initData?.data?.upload_url ||
      initData?.data?.upload?.upload_url ||
      null;

    if (!uploadUrl) {
      return res.status(500).json({ step: 'init_no_upload_url', init: initData });
    }

    // 3) UPLOAD 1 chunk với Content-Length + Content-Range (theo doc)
    const lastByte = videoSize - 1;
    const uploadResp = await request(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoSize),
        'Content-Range': `bytes 0-${lastByte}/${videoSize}`
      },
      body: videoBuffer,
      signal: AbortSignal.timeout(300000)
    });
    const uploadText = await uploadResp.body.text();
    const uploadResult = { status: uploadResp.statusCode, body: uploadText };
    if (!uploadResp.ok) {
      return res.status(uploadResp.statusCode).json({ step: 'upload_failed', init: initData, upload: uploadResult });
    }

    // 4) Draft: hoàn tất
    if (isDraft) {
      return res.status(200).json({
        success: true,
        mode: 'draft',
        message: '✅ Video đã upload vào Draft/Inbox. Mở TikTok (tài khoản sandbox) để xem.',
        init: initData,
        upload: uploadResult
      });
    }

    // 5) Publish: finalize để tạo bài (SELF_ONLY trong sandbox)
    const finalizeResp = await request('https://open.tiktokapis.com/v2/post/publish/video/', {
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
    });
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
      message: '✅ Video đã đăng lên TikTok (SELF_ONLY). Vào hồ sơ (Only me) để xem.',
      init: initData,
      upload: uploadResult,
      finalize: finalizeData
    });

  } catch (e) {
    return res.status(500).json({ step: 'server_exception', error: String(e) });
  }
}
