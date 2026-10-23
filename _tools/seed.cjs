// Load the prepared event history (from prepare_seed.py) into the live site:
// uploads each poster to the site's Blob store and upserts the event row.
// Re-running is safe (same ids are updated, not duplicated).
//   node seed.cjs <out-dir>
// Secrets: PH_DATABASE_URL from ~/.claude/mp-launch/project-hardstyle-preview.env,
// BLOB_READ_WRITE_TOKEN from the project's .env.local (vercel env pull). Never printed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { put } = require('@vercel/blob');
const { neon } = require('@neondatabase/serverless');

function envFile(p) {
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
}

(async () => {
  const outDir = process.argv[2];
  const secrets = envFile(path.join(os.homedir(), '.claude/mp-launch/project-hardstyle-preview.env'));
  const local = envFile(path.join(__dirname, '..', '.env.local'));
  const token = process.env.BLOB_READ_WRITE_TOKEN || local.BLOB_READ_WRITE_TOKEN;
  if (!token || !secrets.PH_DATABASE_URL) throw new Error('missing BLOB token or database URL');
  const sql = neon(secrets.PH_DATABASE_URL);
  const rows = JSON.parse(fs.readFileSync(path.join(outDir, 'out.json'), 'utf8'));

  for (const r of rows) {
    let poster = r.poster_url || null;
    if (r.poster_local) {
      const buf = fs.readFileSync(r.poster_local);
      const blob = await put(`posters/archive/${r.id}.jpg`, buf, {
        access: 'public', contentType: 'image/jpeg', addRandomSuffix: true,
        cacheControlMaxAge: 60 * 60 * 24 * 365, token,
      });
      poster = blob.url;
    }
    await sql`INSERT INTO events (id, title, tagline, event_date, start_time, end_time, venue, suburb, headliners, lineup,
                ticket_url, ticket_status, price_text, age, poster_url, poster_w, poster_h, accent, description, featured, published)
              VALUES (${r.id}, ${r.title}, ${r.tagline || null}, ${r.date}, ${r.startTime || null}, ${r.endTime || null},
                ${r.venue || null}, ${r.suburb || null}, ${r.headliners || []}, ${r.lineup || []}, ${r.ticketUrl || null},
                ${r.ticketStatus || 'on-sale'}, ${r.priceText || null}, ${r.age || '18+'}, ${poster}, ${r.posterW || null},
                ${r.posterH || null}, ${r.accent || null}, ${r.description || null}, ${Boolean(r.featured)}, true)
              ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, tagline = EXCLUDED.tagline, event_date = EXCLUDED.event_date,
                start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, venue = EXCLUDED.venue, suburb = EXCLUDED.suburb,
                headliners = EXCLUDED.headliners, lineup = EXCLUDED.lineup, ticket_url = EXCLUDED.ticket_url,
                ticket_status = EXCLUDED.ticket_status, price_text = EXCLUDED.price_text, age = EXCLUDED.age,
                poster_url = EXCLUDED.poster_url, poster_w = EXCLUDED.poster_w, poster_h = EXCLUDED.poster_h,
                accent = EXCLUDED.accent, description = EXCLUDED.description, featured = EXCLUDED.featured,
                updated_at = now()`;
    console.log('loaded', r.date, r.title);
  }
  const n = await sql`SELECT count(*)::int AS n FROM events`;
  console.log('events in database:', n[0].n);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
