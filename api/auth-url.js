export default async function handler(req, res) {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const base = 'https://www.tiktok.com/v2/auth/authorize/';
  const client_key = process.env.TIKTOK_CLIENT_KEY;
  const redirect_uri = process.env.TIKTOK_REDIRECT_URI;
  const scope = (req.query.scope || 'user.info.basic,video.upload,video.publish').toString();
  const state = (req.query.state || 'skybook-' + Math.random().toString(36).slice(2)).toString();

  const url = new URL(base);
  url.searchParams.set('client_key', client_key);
  url.searchParams.set('scope', scope);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect_uri);
  url.searchParams.set('state', state);

  res.status(200).json({ authorize_url: url.toString() });
}