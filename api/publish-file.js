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

  // Lấy mode từ query: draft | publish (mặc định draft)
  const url = new URL(req.url, 'http://localhost');
  const mode = (url.searchParams.get('mode') || 'draft').toLowerCase();
  const isDraft = mode === 'draft';

  // Biến chung cho kết quả các bước
  let caption = '';
  let initData = null;
  let uploadResult = null;
  let publishId = null;

  try {
    // Sẽ INIT khi nhận được stream file lần đầu, rồi stream thẳng lên TikTok (FILE_UPLOAD)
    const busboy = Busboy({ headers: req.headers });

    // Promise sẽ resolve khi toàn bộ multipart kết thúc
    const finished = new Promise((resolve, reject) => {
      let didStartUpload = false;

      // Lấy caption từ form fields
      busboy.on('field', (name, value) => {
        if (name === 'caption') caption = value;
      });

      // Khi nhận file: INIT → PUT upload_url với body=file (stream trực tiếp)
      busboy.on('file', async (fieldname, file /*, info */) => {
        if (fieldname !== 'video') {
          // Bỏ qua field khác
          file.resume();
          return;
        }
        if (didStartUpload) {
          // Chỉ nhận 1 file; bỏ qua file tiếp theo nếu có
          file.resume();
          return;
        }
        didStartUpload = true;

        try {
          const initEndpoint = isDraft
            ? 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
            : 'https://open.tiktokapis.com/v2/post/publish/video/init/';

          // Với publish, title có thể để trống ở init; sẽ set lại ở finalize
          const initBody = isDraft
            ? { source_info: { source: 'FILE_UPLOAD' } }
            : { post_info: { privacy_level: 'SELF_ONLY', title: caption || '' },
                source_info: { source: 'FILE_UPLOAD' } };

          const initResp = await request(initEndpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify(initBody),
            signal: AbortSignal.timeout(20000) // 20s cho INIT
          });
          initData = await initResp.body.json();

          if (!initResp.ok) {
            // Ngừng đọc file, trả lỗi INIT
            file.resume();
            return reject({ step: 'init_failed', status: initResp.statusCode, response: initData });
          }

          publishId = initData?.data?.publish_id || null;
          const uploadUrl =
            initData?.data?.upload_url ||
            initData?.data?.upload?.upload_url ||
            null;

          if (!uploadUrl) {
            file.resume();
            return reject({ step: 'init_no_upload_url', status: 500, response: initData });
          }

          // UPLOAD: stream trực tiếp file lên TikTok (PUT upload_url)
          const upResp = await request(uploadUrl, {
            method: 'PUT',
            body: file, // <<--- STREAM trực tiếp, không lưu vào bộ nhớ
            headers: { 'Content-Type': 'video/mp4' },
            signal: AbortSignal.timeout(300000) // 300s cho upload
          });
          const upText = await upResp.body.text();
          uploadResult = { status: upResp.statusCode, body: upText };

          if (!upResp.ok) {
            return reject({ step: 'upload_failed', status: upResp.statusCode, init: initData, upload: uploadResult });
          }

          // Không finalize ở đây; đợi đến khi multipart kết thúc (để chắc chắn đã nhận xong caption)
        } catch (err) {
          return reject({ step: 'upload_exception', error: String(err) });
        }
      });

      busboy.on('finish', () => resolve());
      busboy.on('error', (e) => reject({ step: 'busboy_error', error: String(e) }));
    });

    req.pipe(busboy);
    await finished;

    // Nếu chưa có uploadResult thì nghĩa là không có file 'video'
    if (!uploadResult) {
      return res.status(400).json({ error: 'No video file uploaded (field name must be "video")' });
    }

    // Draft: xong sau khi upload
    if (isDraft) {
      return res.status(200).json({
        success: true,
        mode: 'draft',
        message: '✅ Video đã upload vào Draft/Inbox. Mở TikTok (tài khoản sandbox) để xem.',
        init: initData,
        upload: uploadResult
      });
    }

    // Publish: cần FINALIZE (đăng thật, SELF_ONLY cho sandbox)
    try {
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
        signal: AbortSignal.timeout(20000) // 20s cho FINALIZE
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
        message: '✅ Video đã đăng lên TikTok (SELF_ONLY). Kiểm tra trong hồ sơ của tài khoản sandbox.',
        init: initData,
        upload: uploadResult,
        finalize: finalizeData
      });
    } catch (e) {
      return res.status(500).json({
        step: 'finalize_exception',
        error: String(e),
        init: initData,
        upload: uploadResult
      });
    }
  } catch (e) {
    // Lỗi tổng quát
    const msg = typeof e === 'object' && e && 'step' in e
      ? e
      : { step: 'server_exception', error: String(e) };
    const status = e?.status || 500;
    return res.status(status).json(msg);
  }
}
