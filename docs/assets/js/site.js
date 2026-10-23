/* Project Hardstyle — public site. Everything event-related comes from the
   live events feed, so what the organisers save in their login is what shows. */
(function () {
  'use strict';
  var PH = window.PH, h = PH.h;
  function $(s, r) { return (r || document).querySelector(s); }

  var ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.4 7-13a7 7 0 0 0-14 0c0 5.6 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M14 5v14" stroke-dasharray="2 3"/></svg>'
  };
  function icon(name) { var s = h('span', { 'aria-hidden': 'true', style: 'display:inline-flex' }); s.innerHTML = ICONS[name]; return s.firstChild; }

  /* ------------------------------------------------------------ the feed */
  function feed() {
    return PH.getJSON('/api/events').then(function (d) {
      var all = (d.events || []).filter(function (e) { return e.published; });
      var up = all.filter(function (e) { return e.upcoming; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var past = all.filter(function (e) { return !e.upcoming; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      var featured = up.filter(function (e) { return e.featured; })[0] || up[0] || null;
      return { all: all, up: up, past: past, featured: featured, today: d.today };
    });
  }

  /* ---------------------------------------------------------- time maths */
  /* "10:00pm" / "22:00" / "10pm" -> [22, 0] */
  function clock(t) {
    var m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(t || ''));
    if (!m) return null;
    var hr = Number(m[1]), mi = Number(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && hr < 12) hr += 12;
    if (ap === 'am' && hr === 12) hr = 0;
    return hr < 24 && mi < 60 ? [hr, mi] : null;
  }
  /* The moment an Adelaide wall-clock time happens, whatever the viewer's zone. */
  function adelaideInstant(dateIso, timeText) {
    var c = clock(timeText) || [20, 0];
    var p = dateIso.split('-').map(Number);
    var guess = Date.UTC(p[0], p[1] - 1, p[2], c[0], c[1]);
    var off = offsetMinutes(new Date(guess));
    return new Date(guess - off * 60000);
  }
  function offsetMinutes(d) {
    try {
      var s = new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Adelaide', timeZoneName: 'longOffset' }).formatToParts(d)
        .filter(function (x) { return x.type === 'timeZoneName'; })[0].value; // "GMT+10:30"
      var m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(s);
      return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
    } catch (e) { return 630; }
  }

  function ticketsButton(ev, big) {
    var st = ev.ticketStatus;
    if (!ev.ticketUrl || st === 'coming-soon') {
      return h('span', { class: 'btn btn-ghost' + (big ? '' : ' btn-sm'), 'aria-disabled': 'true' }, st === 'coming-soon' ? 'Tickets coming soon' : 'Tickets soon');
    }
    var label = st === 'sold-out' ? 'Sold out' : st === 'final-release' ? 'Final release tickets' : 'Get tickets';
    var a = h('a', { class: 'btn' + (big ? '' : ' btn-sm') + (st === 'sold-out' ? ' btn-ghost' : ''), href: ev.ticketUrl, target: '_blank', rel: 'noopener' }, label);
    a.append(icon('arrow'));
    return a;
  }

  function statusChip(ev, state) {
    if (state === 'live') return h('span', { class: 'chip live' }, h('span', { class: 'dot' }), 'On now');
    if (state === 'tonight') return h('span', { class: 'chip live' }, h('span', { class: 'dot' }), 'Tonight');
    var map = { 'on-sale': 'Tickets on sale', 'final-release': 'Final release', 'sold-out': 'Sold out', 'coming-soon': 'Coming soon' };
    return h('span', { class: 'chip ' + (ev.ticketStatus === 'sold-out' ? '' : 'hot') }, h('span', { class: 'dot' }), map[ev.ticketStatus] || '');
  }

  function rgbVar(hex) { var r = PH.hexToRgb(hex); return r ? r.join(',') : null; }

  /* -------------------------------------------------------------- home */
  function heroFor(ev) {
    var hero = $('#hero-inner');
    var start = adelaideInstant(ev.date, ev.startTime);
    var end = ev.endTime ? adelaideInstant(ev.date, ev.endTime) : new Date(start.getTime() + 7 * 3600e3);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600e3);
    var now = new Date();
    var state = now >= start && now < end ? 'live' : (start - now < 20 * 3600e3 && now < start ? 'tonight' : 'soon');

    var title = h('h1', { class: 'hero-title' });
    title.append(h('span', { class: 'glow', text: ev.title }));
    var tag = ev.tagline || (ev.headliners.length ? 'ft ' + ev.headliners.join(', ') : '');

    var meta = h('ul', { class: 'meta' },
      h('li', null, icon('cal'), PH.fmtDateLong(ev.date)),
      ev.startTime ? h('li', null, icon('clock'), ev.startTime + (ev.endTime ? ' – ' + ev.endTime : '')) : null,
      ev.venue ? h('li', null, icon('pin'), ev.venue + (ev.suburb ? ', ' + ev.suburb : '')) : null
    );

    var cd = h('div', { class: 'countdown' + (state !== 'soon' ? ' tonight' : ''), 'aria-label': 'Countdown to doors' });
    ['Days', 'Hours', 'Mins', 'Secs'].forEach(function (u) { cd.append(h('div', { class: 'unit' }, h('b', { text: '00' }), h('span', { text: u }))); });

    var details = h('a', { class: 'btn btn-ghost', href: 'event.html?id=' + encodeURIComponent(ev.id) }, 'Event details');

    var copy = h('div', { class: 'hero-copy' },
      h('p', { class: 'eyebrow', text: state === 'live' ? 'Happening right now' : 'Next event' }),
      title,
      tag ? h('p', { class: 'hero-tag', text: tag }) : null,
      meta,
      state === 'live' ? null : cd,
      h('div', { class: 'cta-row' }, ticketsButton(ev, true), details, ev.priceText ? h('span', { class: 'price-note', text: ev.priceText }) : null)
    );

    var art = h('div', { class: 'hero-poster beat' }, h('div', { class: 'halo' }));
    var frame = h('a', { class: 'poster-frame', href: 'event.html?id=' + encodeURIComponent(ev.id), 'aria-label': ev.title + ' poster' });
    if (ev.poster) { var im = PH.posterImg(ev, 960); im.loading = 'eager'; im.fetchPriority = 'high'; frame.append(im); }
    else frame.append(h('div', { class: 'wall-item no-art', style: 'aspect-ratio:4/5' }, h('b', { text: ev.title })));
    art.append(statusChip(ev, state === 'soon' ? null : state));
    art.lastChild.classList.add('poster-tag');
    art.append(frame);

    hero.replaceChildren(h('div', { class: 'hero-grid' }, copy, art));
    if (state !== 'live') tick(cd, start);
    tilt(art.querySelector('.poster-frame'));
    $('#nav-tickets').href = ev.ticketUrl || ('event.html?id=' + encodeURIComponent(ev.id));
  }

  function heroQuiet(last) {
    var hero = $('#hero-inner');
    var copy = h('div', { class: 'hero-copy' },
      h('p', { class: 'eyebrow', text: 'Next event' }),
      h('h1', { class: 'hero-title' }, 'The next one ', h('span', { class: 'glow', text: 'is loading' })),
      h('p', { class: 'hero-tag', text: 'Announcements land on Instagram first. Follow along so you are first in line when tickets drop.' }),
      h('div', { class: 'cta-row' },
        h('a', { class: 'btn', href: 'https://www.instagram.com/projecthardstyle_adelaide/', target: '_blank', rel: 'noopener' }, 'Follow on Instagram'),
        last ? h('a', { class: 'btn btn-ghost', href: 'event.html?id=' + encodeURIComponent(last.id) }, 'Last event: ' + last.title) : null
      )
    );
    var art = h('div', { class: 'hero-poster' }, h('div', { class: 'halo' }));
    if (last && last.poster) {
      var frame = h('a', { class: 'poster-frame', href: 'event.html?id=' + encodeURIComponent(last.id) });
      var im = PH.posterImg(last, 960); im.loading = 'eager'; frame.append(im);
      art.append(h('span', { class: 'chip poster-tag', text: 'Last time · ' + PH.fmtDate(last.date) }), frame);
    }
    hero.replaceChildren(h('div', { class: 'hero-grid' }, copy, art));
    $('#nav-tickets').href = '#follow';
    $('#nav-tickets').textContent = 'Follow';
  }

  function tick(box, start) {
    var b = box.querySelectorAll('b');
    function pad(n) { return String(n).padStart(2, '0'); }
    function run() {
      var ms = Math.max(0, start - new Date());
      var s = Math.floor(ms / 1000);
      b[0].textContent = pad(Math.floor(s / 86400));
      b[1].textContent = pad(Math.floor(s % 86400 / 3600));
      b[2].textContent = pad(Math.floor(s % 3600 / 60));
      b[3].textContent = pad(s % 60);
      if (ms <= 0) { clearInterval(t); setTimeout(function () { location.reload(); }, 1500); }
    }
    run();
    var t = setInterval(run, 1000);
  }

  /* A little parallax tilt on the poster, following the pointer (desktop only). */
  function tilt(el) {
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(hover: none)').matches) return;
    var box = el.parentElement;
    box.addEventListener('pointermove', function (e) {
      var r = box.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      el.style.setProperty('--ry', (x * 14).toFixed(2) + 'deg');
      el.style.setProperty('--rx', (-y * 10).toFixed(2) + 'deg');
    });
    box.addEventListener('pointerleave', function () { el.style.removeProperty('--ry'); el.style.removeProperty('--rx'); });
  }

  function card(ev) {
    var c = rgbVar(ev.accent);
    var a = h('article', { class: 'event-card', style: c ? '--c:' + c : null });
    var art = h('div', { class: 'art' });
    if (ev.poster) art.append(PH.posterImg(ev, 640));
    art.append(statusChip(ev));
    a.append(art, h('div', { class: 'body' },
      h('div', { class: 'date', text: PH.fmtDate(ev.date) + (ev.startTime ? ' · ' + ev.startTime : '') }),
      h('h3', null, h('a', { class: 'stretched', href: 'event.html?id=' + encodeURIComponent(ev.id), text: ev.title })),
      h('div', { class: 'where', text: [ev.venue, ev.suburb].filter(Boolean).join(', ') }),
      h('div', { class: 'go' }, ticketsButton(ev, false))
    ));
    return a;
  }

  function wallItem(ev) {
    var c = rgbVar(ev.accent);
    var a = h('a', { class: 'wall-item' + (ev.poster ? '' : ' no-art'), href: 'event.html?id=' + encodeURIComponent(ev.id), style: c ? '--c:' + c : null });
    if (ev.poster) {
      a.append(PH.posterImg(ev, 480), h('span', { class: 'cap' }, h('b', { text: ev.title }), h('span', { text: PH.fmtDate(ev.date) + (ev.venue ? ' · ' + ev.venue : '') })));
    } else {
      a.append(h('b', { text: ev.title }), h('span', { text: PH.fmtDate(ev.date) + (ev.venue ? ' · ' + ev.venue : '') }));
    }
    return a;
  }

  function marquee(all) {
    var seen = {}, names = [];
    all.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (ev) {
      ev.headliners.forEach(function (n) { var k = n.toLowerCase(); if (!seen[k]) { seen[k] = 1; names.push(n); } });
    });
    var box = $('#marquee');
    if (names.length < 4) { box.hidden = true; return; }
    var track = h('div', { class: 'track' });
    for (var r = 0; r < 2; r++) names.forEach(function (n) { track.append(h('span', { text: n }), h('i', { 'aria-hidden': 'true' })); });
    box.replaceChildren(h('p', { class: 'sr-only', text: 'Headliners we have brought to Adelaide: ' + names.join(', ') }), track);
    track.setAttribute('aria-hidden', 'true');
    box.hidden = false;
  }

  function stats(f) {
    var years = f.all.map(function (e) { return Number(e.date.slice(0, 4)); });
    var first = Math.min.apply(null, years);
    var acts = {};
    f.all.forEach(function (e) { e.headliners.concat(e.lineup).forEach(function (n) { acts[n.toLowerCase()] = 1; }); });
    var set = function (id, v) { var el = $(id); if (el && v) el.textContent = v; };
    set('#stat-events', String(f.all.length));
    set('#stat-acts', String(Object.keys(acts).length));
    set('#stat-first', isFinite(first) ? String(first) : '');
  }

  function home() {
    feed().then(function (f) {
      var accentFrom = f.featured || f.past[0];
      if (accentFrom && accentFrom.accent) PH.setAccent(accentFrom.accent);
      if (f.featured) heroFor(f.featured); else heroQuiet(f.past[0]);

      var others = f.up.filter(function (e) { return !f.featured || e.id !== f.featured.id; });
      if (others.length) {
        var g = $('#upcoming-grid'); g.replaceChildren();
        others.forEach(function (e) { g.append(card(e)); });
        $('#upcoming').hidden = false;
      }
      var wall = $('#archive-wall'); wall.replaceChildren();
      f.past.slice(0, 12).forEach(function (e) { wall.append(wallItem(e)); });
      if (!f.past.length) wall.append(h('div', { class: 'empty', text: 'Past events will show here.' }));
      $('#archive-count').textContent = f.past.length ? String(f.past.length) : '';
      marquee(f.all);
      stats(f);
      reveal();
    }).catch(function () {
      $('#hero-inner').replaceChildren(h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow', text: 'Project Hardstyle' }),
        h('h1', { class: 'hero-title', text: 'Adelaide hardstyle' }),
        h('p', { class: 'hero-tag', text: 'Events are loading. If this stays here, refresh the page.' })));
    });
  }

  /* ------------------------------------------------------------ archive */
  function archive() {
    feed().then(function (f) {
      if (f.past[0] && f.past[0].accent) PH.setAccent(f.past[0].accent);
      var years = [];
      f.past.forEach(function (e) { var y = e.date.slice(0, 4); if (years.indexOf(y) < 0) years.push(y); });
      var bar = $('#year-filter'), wall = $('#full-wall');
      function draw(y) {
        wall.replaceChildren();
        f.past.filter(function (e) { return !y || e.date.slice(0, 4) === y; }).forEach(function (e) { wall.append(wallItem(e)); });
        Array.prototype.forEach.call(bar.children, function (b) { b.setAttribute('aria-pressed', String((b.dataset.y || '') === (y || ''))); });
      }
      bar.replaceChildren(h('button', { type: 'button', 'data-y': '', onclick: function () { draw(''); } }, 'All ' + f.past.length));
      years.forEach(function (y) { bar.append(h('button', { type: 'button', 'data-y': y, onclick: function () { draw(y); } }, y)); });
      draw('');
      $('#archive-total').textContent = String(f.past.length);
      if (years.length) $('#archive-span').textContent = years[years.length - 1] + ' – ' + years[0];
      reveal();
    });
  }

  /* --------------------------------------------------------------- event */
  function eventPage() {
    var id = new URLSearchParams(location.search).get('id');
    feed().then(function (f) {
      var ev = f.all.filter(function (e) { return e.id === id; })[0];
      var root = $('#event-root');
      if (!ev) {
        root.replaceChildren(h('div', { class: 'wrap', style: 'padding:160px 0 80px' },
          h('p', { class: 'eyebrow', text: 'Not found' }),
          h('h1', { class: 'section-title', text: 'That event is not here' }),
          h('p', { class: 'section-sub', text: 'It may have been removed. Here is everything that is on.' }),
          h('p', null, h('a', { class: 'btn', href: 'index.html' }, 'Back to events'))));
        return;
      }
      if (ev.accent) PH.setAccent(ev.accent);
      document.title = ev.title + ' · ' + PH.fmtDate(ev.date) + ' · Project Hardstyle';

      var bd = $('#backdrop');
      if (ev.poster) bd.style.backgroundImage = 'url("' + PH.img(ev.poster, 320) + '")';

      var poster = h('div', { class: 'hero-poster' }, h('div', { class: 'halo' }));
      var frame = h('div', { class: 'poster-frame' });
      if (ev.poster) { var im = PH.posterImg(ev, 960); im.loading = 'eager'; frame.append(im); }
      poster.append(frame);

      var venueLine = [ev.venue, ev.suburb].filter(Boolean).join(', ');
      var dir = ev.venue ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(venueLine + ', SA') : null;

      var lineup = h('ul', { class: 'lineup' });
      ev.headliners.forEach(function (n) { lineup.append(h('li', { class: 'head' }, n, h('small', { text: 'Headliner' }))); });
      ev.lineup.forEach(function (n) { lineup.append(h('li', null, n)); });

      var share = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: function () {
        var data = { title: ev.title, text: ev.title + ' · ' + PH.fmtDate(ev.date), url: location.href.split('?')[0] + '?id=' + encodeURIComponent(ev.id) };
        if (navigator.share) navigator.share(data).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(data.url).then(function () { share.textContent = 'Link copied'; });
      } }, 'Share');

      var info = h('div', { class: 'event-info' },
        h('div', null, ev.upcoming ? statusChip(ev) : h('span', { class: 'chip', text: 'Past event' })),
        h('h1', { text: ev.title }),
        ev.tagline ? h('p', { class: 'tagline', text: ev.tagline }) : null,
        h('div', { class: 'facts' },
          h('div', { class: 'fact' }, h('span', { text: 'Date' }), h('b', { text: PH.fmtDateLong(ev.date) })),
          h('div', { class: 'fact' }, h('span', { text: 'Time' }), h('b', { text: ev.startTime ? ev.startTime + (ev.endTime ? ' – ' + ev.endTime : '') : 'TBA' })),
          h('div', { class: 'fact' }, h('span', { text: 'Venue' }), h('b', { text: venueLine || 'TBA' }),
            dir ? h('a', { href: dir, target: '_blank', rel: 'noopener', text: 'Directions' }) : null),
          h('div', { class: 'fact' }, h('span', { text: 'Entry' }), h('b', { text: [ev.age, ev.priceText].filter(Boolean).join(' · ') || 'See tickets' }))
        ),
        ev.upcoming ? h('div', { class: 'cta-row' }, ticketsButton(ev, true)) : null,
        h('div', { class: 'tool-row' },
          ev.upcoming ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: function () { ics(ev); } }, 'Add to calendar') : null,
          share),
        (ev.headliners.length || ev.lineup.length) ? h('h2', { class: 'eyebrow', style: 'margin:36px 0 12px', text: 'Lineup' }) : null,
        (ev.headliners.length || ev.lineup.length) ? lineup : null,
        ev.description ? h('p', { class: 'event-desc', text: ev.description }) : null
      );
      root.querySelector('#event-layout').replaceChildren(poster, info);
      jsonld(ev);
    });
  }

  /* Google reads this to list the show in its event search. */
  function jsonld(ev) {
    var off = offsetMinutes(adelaideInstant(ev.date, ev.startTime || '8:00pm'));
    var tz = (off < 0 ? '-' : '+') + String(Math.floor(Math.abs(off) / 60)).padStart(2, '0') + ':' + String(Math.abs(off) % 60).padStart(2, '0');
    var data = {
      '@context': 'https://schema.org', '@type': 'MusicEvent', name: ev.title,
      startDate: ev.date + (ev.startTime ? 'T' + iso(ev.startTime) + tz : ''),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: ev.venue || 'Adelaide', address: { '@type': 'PostalAddress', addressLocality: ev.suburb || 'Adelaide', addressRegion: 'SA', addressCountry: 'AU' } },
      image: ev.poster ? [ev.poster] : undefined,
      description: ev.tagline || ev.description || undefined,
      organizer: { '@type': 'Organization', name: 'Project Hardstyle', url: location.origin },
      performer: ev.headliners.map(function (n) { return { '@type': 'MusicGroup', name: n }; }),
      offers: ev.ticketUrl ? { '@type': 'Offer', url: ev.ticketUrl, availability: ev.ticketStatus === 'sold-out' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' } : undefined,
      typicalAgeRange: ev.age || undefined
    };
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(data);
    document.head.append(s);
  }
  function iso(t) { var c = clock(t); return c ? String(c[0]).padStart(2, '0') + ':' + String(c[1]).padStart(2, '0') + ':00' : '20:00:00'; }

  /* A calendar file (.ics) the phone's calendar app opens straight away. */
  function ics(ev) {
    var start = adelaideInstant(ev.date, ev.startTime || '8:00pm');
    var end = ev.endTime ? adelaideInstant(ev.date, ev.endTime) : new Date(start.getTime() + 6 * 3600e3);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600e3);
    function z(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    function esc(s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }
    var body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Project Hardstyle//Events//EN', 'BEGIN:VEVENT',
      'UID:' + ev.id + '@projecthardstyle', 'DTSTAMP:' + z(new Date()), 'DTSTART:' + z(start), 'DTEND:' + z(end),
      'SUMMARY:' + esc(ev.title), 'LOCATION:' + esc([ev.venue, ev.suburb].filter(Boolean).join(', ')),
      'DESCRIPTION:' + esc((ev.tagline ? ev.tagline + '\n' : '') + (ev.ticketUrl ? 'Tickets: ' + ev.ticketUrl : '')),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = h('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: 'project-hardstyle-' + ev.date + '.ics' });
    document.body.append(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------- chrome */
  function header() {
    var hd = $('.site-header');
    if (!hd) return;
    function onScroll() { hd.classList.toggle('scrolled', scrollY > 20); }
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    var t = $('.nav-toggle');
    if (t) t.addEventListener('click', function () {
      var open = hd.classList.toggle('open');
      t.setAttribute('aria-expanded', String(open));
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav a'), function (a) {
      a.addEventListener('click', function () { hd.classList.remove('open'); if (t) t.setAttribute('aria-expanded', 'false'); });
    });
  }

  function reveal() {
    var els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { Array.prototype.forEach.call(els, function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(els, function (e) { io.observe(e); });
  }

  /* The "kick" pulse on the hero glow only runs while the hero is on screen. */
  function beatWhileVisible() {
    var hero = $('.hero');
    if (!hero || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (en) {
      var p = hero.querySelector('.hero-poster');
      if (p) p.classList.toggle('beat', en[0].isIntersecting);
    }).observe(hero);
  }

  /* Visual-only presale form for the concept. */
  function joinForm() {
    var f = $('#join-form');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      $('#join-note').textContent = 'Preview only: on your live site this adds them to your presale list, so you can text and email them the second tickets drop.';
    });
  }

  header(); joinForm(); reveal(); beatWhileVisible();
  var page = document.body.dataset.page;
  if (page === 'home') home();
  else if (page === 'archive') archive();
  else if (page === 'event') eventPage();
})();
