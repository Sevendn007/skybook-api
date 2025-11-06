ENV cần có (Vercel → Settings → Environment Variables):

TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://sevendn007.github.io/skybook/oauth/callback.html
CORS_ALLOW_ORIGIN=https://sevendn007.github.io

Triển khai:
1) Tạo repo GitHub -> push các file trên
2) Vào Vercel -> New Project -> Import repo -> Add ENV -> Deploy
3) Lấy domain API: https://<project>.vercel.app
