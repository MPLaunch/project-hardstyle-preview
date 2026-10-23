/* ==========================================================================
   Project Hardstyle — shared server helpers
   Session cookies, auth, rate limiting, request parsing, image checks and
   database access. Same shape as the Filoxenia events admin (Aug 2026).

   The database is a DEDICATED Neon database (`projecthardstyle`) reached by a
   DEDICATED role (`projecthardstyle_app`) that owns nothing else and has no
   rights on MP Launch's own databases (checked 24 Oct 2026: it cannot read a
   single table outside its own database).
   ========================================================================== */
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const COOKIE = 'ph_session';
const MAX_AGE = 60 * 60 * 12; // 12 hours

/* The public feed may be read by the GitHub Pages copy of the site. Nothing
   that changes data is ever allowed cross-origin. */
const PUBLIC_ORIGINS = ['https://mplaunch.github.io'];

/* ----------------------------------------------------------------- database */
let _sql;
function db() {
  if (!_sql) {
    const url = process.env.PH_DATABASE_URL;
    if (!url) throw new Error('PH_DATABASE_URL is not set');
    _sql = neon(url);
  }
  return _sql;
}

/* ------------------------------------------------------------------ signing */
function secret() {
  const s = process.env.PH_SESSION_SECRET;
  if (!s) throw new Error('PH_SESSION_SECRET is not set');
  return s;
}

/* A session is "<expiry>.<hmac>". Nothing secret lives in it, and it cannot be
   forged or extended without the server secret. */
function mintSession() {
  const exp = Date.now() + MAX_AGE * 1000;
  const mac = crypto.createHmac('sha256', secret()).update(String(exp)).digest('base64url');
  return `${exp}.${mac}`;
}

function validSession(token) {
  if (!token || typeof token !== 'string') return false;
  const [exp, mac] = token.split('.');
  if (!exp || !mac) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac('sha256', secret()).update(exp).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function isAuthed(req) {
  try { return validSession(readCookie(req, COOKIE)); }
  catch (e) { return false; }
}

/* Compare the submitted password without leaking its length via timing. */
function passwordMatches(given) {
  const want = process.env.PH_ADMIN_PASSWORD || '';
  if (!want) throw new Error('PH_ADMIN_PASSWORD is not set');
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

/* -------------------------------------------------------------- rate limit */
/* In-memory, so it resets when the function goes cold. It exists to stop
   someone hammering the login from one place, not as a hard wall. */
const attempts = new Map();
function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  return Boolean(rec && rec.until > Date.now());
}
function noteFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, first: now, until: 0 };
  if (now - rec.first > 15 * 60 * 1000) { rec.n = 0; rec.first = now; }
  rec.n += 1;
  if (rec.n >= 8) { rec.until = now + 15 * 60 * 1000; rec.n = 0; }
  attempts.set(ip, rec);
}
function noteSuccess(ip) { attempts.delete(ip); }

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

/* --------------------------------------------------------------- utilities */
function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

/* Public reads only: the GitHub Pages copy of the site may fetch the feed. */
function publicCors(req, res) {
  const origin = req.headers.origin;
  if (origin && PUBLIC_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

/* Writes must come from this site's own pages. A browser always sends Origin
   on a cross-site POST/PUT/DELETE, so a mismatch means someone else's page is
   trying to act with the signed-in cookie. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch (e) { return false; }
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) { const e = new Error('too big'); e.code = 'TOO_BIG'; throw e; }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/* JSON only, so a plain HTML form on another site cannot post here at all. */
async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) return null;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = (await readRaw(req, 256 * 1024)).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/* Reads the real format and size from the file's own bytes. The browser's
   Content-Type is never trusted (Moshtix serves JPEGs labelled image/png). */
function imageInfo(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: 'png', mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the markers to the first start-of-frame
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { type: 'webp', mime: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8 ') {
      return { type: 'webp', mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', mime: 'image/webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return null;
}

module.exports = {
  db, mintSession, isAuthed, setSessionCookie, clearSessionCookie,
  passwordMatches, tooManyAttempts, noteFailure, noteSuccess, clientIp,
  noStore, publicCors, sameOrigin, readRaw, readJson, imageInfo,
};
