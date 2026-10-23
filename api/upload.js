/* POST raw image bytes (signed in) -> stores the poster, returns its URL and size.
   The browser shrinks the file before sending (long edge 2000px), so a phone
   photo or a Facebook poster fits comfortably under the 4.4 MB cap. */
const { put } = require('@vercel/blob');
const L = require('./_lib');

const LIMIT = 4.4 * 1024 * 1024;

module.exports = async (req, res) => {
  L.noStore(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!L.isAuthed(req)) return res.status(401).json({ error: 'Please sign in again.' });
  if (!L.sameOrigin(req)) return res.status(403).json({ error: 'Not allowed.' });
  /* A custom header forces a browser pre-flight on any cross-site attempt. */
  if (req.headers['x-ph-upload'] !== '1') return res.status(400).json({ error: 'Bad upload.' });

  let buf;
  try { buf = await L.readRaw(req, LIMIT); }
  catch (e) {
    if (e.code === 'TOO_BIG') return res.status(413).json({ error: 'That image is too big. Try a smaller one.' });
    return res.status(400).json({ error: 'Could not read that image.' });
  }

  const info = L.imageInfo(buf);
  if (!info || !info.width || !info.height) {
    return res.status(415).json({ error: 'That file is not a JPG, PNG or WebP image.' });
  }

  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = await put(`posters/${stamp}-poster.${info.type === 'jpeg' ? 'jpg' : info.type}`, buf, {
      access: 'public',
      contentType: info.mime,
      addRandomSuffix: true,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return res.status(201).json({ ok: true, url: blob.url, width: info.width, height: info.height });
  } catch (e) {
    return res.status(500).json({ error: 'Could not store the poster. Try again.' });
  }
};
