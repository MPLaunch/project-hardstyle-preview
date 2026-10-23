/* POST { password } -> sets the session cookie.
   GET  -> reports whether the caller is already signed in. */
const L = require('./_lib');

module.exports = async (req, res) => {
  L.noStore(res);

  if (req.method === 'GET') {
    return res.status(200).json({ authed: L.isAuthed(req) });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!L.sameOrigin(req)) return res.status(403).json({ error: 'Not allowed.' });

  const ip = L.clientIp(req);
  if (L.tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const body = await L.readJson(req);
  if (!body) return res.status(415).json({ error: 'Send JSON.' });

  let ok = false;
  try { ok = L.passwordMatches(body.password); }
  catch (e) { return res.status(500).json({ error: 'The login is not set up yet.' }); }

  if (!ok) {
    L.noteFailure(ip);
    /* Deliberately slow so guessing is expensive. */
    await new Promise(r => setTimeout(r, 600));
    return res.status(401).json({ error: 'That password does not match.' });
  }

  L.noteSuccess(ip);
  L.setSessionCookie(res, L.mintSession());
  return res.status(200).json({ ok: true });
};
