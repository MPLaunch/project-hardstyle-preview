/* Events API.
     GET    -> public. Published events, for the website to render.
               Signed in + ?all=1 also returns drafts (for the admin).
     POST   -> signed in. Create one.
     PUT    -> signed in. Replace one (by id).
     DELETE -> signed in. Remove one (by id).

   Validation is strict on write because whatever lands here renders on a
   public page. Nothing is trusted from the browser. */
const L = require('./_lib');

const STATUSES = ['on-sale', 'final-release', 'sold-out', 'coming-soon'];

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const text = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/* A list typed one-per-line or comma-separated, or sent as an array. */
function list(v, maxItems, maxLen) {
  const raw = Array.isArray(v) ? v : String(v || '').split(/\n|,/);
  return raw.map(s => str(s, maxLen)).filter(Boolean).slice(0, maxItems);
}

/* Ticket links: HTTPS only, parsed rather than pattern-matched, so a
   `javascript:` payload can never reach the href of a button on the site. */
function safeUrl(v) {
  const s = str(v, 600);
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch (e) { return undefined; }
  if (u.protocol !== 'https:') return undefined;
  return u.toString();
}

/* Posters may only come from our own Blob store, so nobody can make the site
   load an image from somewhere else through this field. */
function safePoster(v) {
  const s = str(v, 600);
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch (e) { return undefined; }
  if (u.protocol !== 'https:') return undefined;
  if (!/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname)) return undefined;
  return u.toString();
}

function dim(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null;
}

/* The poster's own highlight colour (picked in the browser when the poster is
   uploaded); the site re-colours itself to match each event. */
function hex(v) {
  const s = str(v, 7);
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
}

/* The "event day" rolls over at 6am Adelaide time, so a show that starts at
   10pm stays "upcoming" until the morning after, not until midnight. */
function adelaideToday() {
  const shifted = new Date(Date.now() - 6 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(shifted); // YYYY-MM-DD
}

/* The date is read back as TEXT straight from Postgres, never via a JS Date:
   the driver hands back a `date` column as local midnight, which rolls back a
   day in Adelaide. (Filoxenia bug, Aug 2026.) */
function rowToEvent(r, today) {
  return {
    id: r.id,
    title: r.title,
    tagline: r.tagline || '',
    date: r.date_text,
    startTime: r.start_time || '',
    endTime: r.end_time || '',
    venue: r.venue || '',
    suburb: r.suburb || '',
    address: r.address || '',
    headliners: r.headliners || [],
    lineup: r.lineup || [],
    ticketUrl: r.ticket_url || null,
    ticketStatus: r.ticket_status,
    priceText: r.price_text || '',
    age: r.age || '',
    poster: r.poster_url || null,
    posterW: r.poster_w || null,
    posterH: r.poster_h || null,
    accent: r.accent || null,
    description: r.description || '',
    featured: Boolean(r.featured),
    published: Boolean(r.published),
    upcoming: r.date_text >= today,
    updatedAt: r.updated_at,
  };
}

function clean(b) {
  const title = str(b.title, 120);
  if (!title) return { error: 'Give the event a name.' };
  const date = str(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) {
    return { error: 'Pick a valid date.' };
  }
  const ticketUrl = safeUrl(b.ticketUrl);
  if (ticketUrl === undefined) return { error: 'The ticket link needs to start with https://' };
  const poster = safePoster(b.poster);
  if (poster === undefined) return { error: 'Upload the poster again (that image link is not one of ours).' };
  return {
    f: {
      title,
      tagline: str(b.tagline, 160) || null,
      date,
      startTime: str(b.startTime, 20) || null,
      endTime: str(b.endTime, 20) || null,
      venue: str(b.venue, 120) || null,
      suburb: str(b.suburb, 80) || null,
      address: str(b.address, 160) || null,
      headliners: list(b.headliners, 12, 60),
      lineup: list(b.lineup, 40, 60),
      ticketUrl,
      ticketStatus: STATUSES.includes(b.ticketStatus) ? b.ticketStatus : 'on-sale',
      priceText: str(b.priceText, 60) || null,
      age: str(b.age, 20) || null,
      poster,
      posterW: poster ? dim(b.posterW) : null,
      posterH: poster ? dim(b.posterH) : null,
      accent: hex(b.accent),
      description: text(b.description, 1500) || null,
      featured: b.featured === true,
      published: b.published !== false,
    },
  };
}

const SELECT_COLS = 'SELECT *, to_char(event_date, \'YYYY-MM-DD\') AS date_text FROM events';

module.exports = async (req, res) => {
  let sql;
  try { sql = L.db(); }
  catch (e) { return res.status(503).json({ error: 'Database is not configured yet.', events: [] }); }

  const today = adelaideToday();

  /* ------------------------------------------------------------------ read */
  if (req.method === 'GET' || req.method === 'HEAD') {
    /* NOT cached, deliberately (the Filoxenia lesson): a cached feed left a
       deleted event on the public site for over a minute, which reads as
       "delete is broken". A promoter's handful of events never needs a cache
       that can lie about what is on the website. */
    L.noStore(res);
    L.publicCors(req, res);
    const wantAll = req.query && req.query.all === '1';
    const authed = wantAll && L.isAuthed(req);
    if (wantAll && !authed) return res.status(401).json({ error: 'Please sign in again.', events: [] });
    try {
      const rows = authed
        ? await sql.query(`${SELECT_COLS} ORDER BY event_date ASC, created_at ASC`)
        : await sql.query(`${SELECT_COLS} WHERE published = true ORDER BY event_date ASC, created_at ASC`);
      return res.status(200).json({ today, events: rows.map(r => rowToEvent(r, today)) });
    } catch (e) {
      return res.status(500).json({ error: 'Could not load events.', events: [] });
    }
  }

  L.noStore(res);
  if (!L.isAuthed(req)) return res.status(401).json({ error: 'Please sign in again.' });
  if (!L.sameOrigin(req)) return res.status(403).json({ error: 'Not allowed.' });

  let b;
  try { b = await L.readJson(req); }
  catch (e) { return res.status(413).json({ error: 'That is too much text.' }); }
  if (!b) return res.status(415).json({ error: 'Send JSON.' });

  /* ---------------------------------------------------------------- delete */
  if (req.method === 'DELETE') {
    const id = str(b.id, 120);
    if (!id) return res.status(400).json({ error: 'Which event?' });
    try {
      const r = await sql`DELETE FROM events WHERE id = ${id} RETURNING id`;
      if (!r.length) return res.status(404).json({ error: 'That event is already gone.' });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Could not remove that. Try again.' });
    }
  }

  if (req.method !== 'POST' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const c = clean(b);
  if (c.error) return res.status(400).json({ error: c.error });
  const f = c.f;

  try {
    /* Only one event can be the featured one. */
    if (f.featured) await sql`UPDATE events SET featured = false WHERE featured = true`;

    if (req.method === 'POST') {
      const slug = f.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const id = `${f.date}-${slug}-${Math.random().toString(36).slice(2, 6)}`;
      await sql`INSERT INTO events (id, title, tagline, event_date, start_time, end_time, venue, suburb, address,
                  headliners, lineup, ticket_url, ticket_status, price_text, age, poster_url, poster_w, poster_h,
                  accent, description, featured, published)
                VALUES (${id}, ${f.title}, ${f.tagline}, ${f.date}, ${f.startTime}, ${f.endTime}, ${f.venue}, ${f.suburb},
                  ${f.address}, ${f.headliners}, ${f.lineup}, ${f.ticketUrl}, ${f.ticketStatus}, ${f.priceText}, ${f.age},
                  ${f.poster}, ${f.posterW}, ${f.posterH}, ${f.accent}, ${f.description}, ${f.featured}, ${f.published})`;
      const rows = await sql.query(`${SELECT_COLS} WHERE id = $1`, [id]);
      return res.status(201).json({ ok: true, event: rowToEvent(rows[0], today) });
    }

    const id = str(b.id, 120);
    if (!id) return res.status(400).json({ error: 'Which event?' });
    const r = await sql`UPDATE events SET title = ${f.title}, tagline = ${f.tagline}, event_date = ${f.date},
                start_time = ${f.startTime}, end_time = ${f.endTime}, venue = ${f.venue}, suburb = ${f.suburb},
                address = ${f.address},
                headliners = ${f.headliners}, lineup = ${f.lineup}, ticket_url = ${f.ticketUrl},
                ticket_status = ${f.ticketStatus}, price_text = ${f.priceText}, age = ${f.age},
                poster_url = ${f.poster}, poster_w = ${f.posterW}, poster_h = ${f.posterH}, accent = ${f.accent},
                description = ${f.description}, featured = ${f.featured}, published = ${f.published},
                updated_at = now()
              WHERE id = ${id} RETURNING id`;
    if (!r.length) return res.status(404).json({ error: 'That event no longer exists.' });
    const rows = await sql.query(`${SELECT_COLS} WHERE id = $1`, [id]);
    return res.status(200).json({ ok: true, event: rowToEvent(rows[0], today) });
  } catch (e) {
    return res.status(500).json({ error: 'Could not save that. Try again.' });
  }
};
