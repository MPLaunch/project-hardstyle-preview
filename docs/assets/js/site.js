/* Project Hardstyle — public site. Everything event-related comes from the
   live events feed, so what the organisers save in their login is what shows. */
(function () {
  'use strict';
  var PH = window.PH, h = PH.h;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  var ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.4 7-13a7 7 0 0 0-14 0c0 5.6 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };
  function icon(name) { var s = document.createElement('span'); s.innerHTML = ICONS[name]; var svg = s.firstChild; svg.setAttribute('aria-hidden', 'true'); return svg; }
  function byDate(dir) { return function (a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir; }; }
  var noMotion = function () { return document.documentElement.classList.contains('still') || matchMedia('(prefers-reduced-motion: reduce)').matches; };

  /* ------------------------------------------------------------ the feed */
  function feed() {
    return PH.getJSON('/api/events').then(function (d) {
      var all = (d.events || []).filter(function (e) { return e.published; });
      var up = all.filter(function (e) { return e.upcoming; }).sort(byDate(1));
      var past = all.filter(function (e) { return !e.upcoming; }).sort(byDate(-1));
      var featured = up.filter(function (e) { return e.featured; })[0] || up[0] || null;
      return { all: all, up: up, past: past, featured: featured, today: d.today };
    });
  }

  /* ---------------------------------------------------------- time maths */
  /* "10:00pm" / "22:00" / "10pm" -> [22, 0] */
  function clock(t) {
    var m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i.exec(String(t || ''));
    if (!m) return null;
    var hr = Number(m[1]), mi = Number(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && hr < 12) hr += 12;
    if (ap === 'am' && hr === 12) hr = 0;
    return hr < 24 && mi < 60 ? [hr, mi] : null;
  }
  /* The real moment an Adelaide wall-clock time happens, whatever the viewer's own time zone. */
  function adelaideInstant(dateIso, timeText) {
    var c = clock(timeText) || [20, 0];
    var p = dateIso.split('-').map(Number);
    var guess = Date.UTC(p[0], p[1] - 1, p[2], c[0], c[1]);
    return new Date(guess - offsetMinutes(new Date(guess)) * 60000);
  }
  function offsetMinutes(d) {
    try {
      var s = new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Adelaide', timeZoneName: 'longOffset' }).formatToParts(d)
        .filter(function (x) { return x.type === 'timeZoneName'; })[0].value;
      var m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(s);
      return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
    } catch (e) { return 630; }
  }
  function window_(ev) {
    var start = adelaideInstant(ev.date, ev.startTime);
    var end = ev.endTime ? adelaideInstant(ev.date, ev.endTime) : new Date(start.getTime() + 7 * 3600e3);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600e3);
    return { start: start, end: end };
  }
  function phase(ev) {
    var w = window_(ev), now = new Date();
    if (now >= w.end) return 'after';
    if (now >= w.start) return 'live';
    if (w.start - now < 20 * 3600e3) return 'tonight';
    return 'soon';
  }
  function niceTime(t) { var c = clock(t); if (!c) return t; var hr = c[0] % 12 || 12; return hr + (c[1] ? ':' + String(c[1]).padStart(2, '0') : '') + (c[0] >= 12 ? 'pm' : 'am'); }

  /* ------------------------------------------------------------ pieces */
  function rgbVar(hex) { var r = PH.hexToRgb(hex); return r ? r.join(',') : null; }

  /* A poster, never cropped: shown whole in a 4:5 frame over a blurred copy of itself. */
  function pframe(ev, w) {
    var box = h('div', { class: 'pframe' });
    if (!ev.poster) return box;
    var ratio = ev.posterW && ev.posterH ? ev.posterW / ev.posterH : 0.8;
    if (Math.abs(ratio - 0.8) < 0.03) box.classList.add('fills');
    if (ev.posterW && ev.posterW < 500) box.classList.add('small');
    box.style.setProperty('--img', 'url("' + PH.img(ev.poster, 320) + '")');
    box.append(PH.posterImg(ev, w));
    return box;
  }

  function ticketsButton(ev, big, compact) {
    var st = ev.ticketStatus, cls = 'btn' + (big ? '' : ' btn-sm');
    if (!ev.ticketUrl || st === 'coming-soon') {
      return h('span', { class: cls + ' btn-ghost', 'aria-disabled': 'true' }, st === 'coming-soon' ? 'Tickets coming soon' : 'Tickets soon');
    }
    if (st === 'sold-out') return h('a', { class: cls + ' btn-ghost', href: ev.ticketUrl, target: '_blank', rel: 'noopener' }, 'Sold out');
    var label = compact ? 'Tickets' : st === 'final-release' ? 'Final release · Get tickets' : 'Get tickets';
    var a = h('a', { class: cls, href: ev.ticketUrl, target: '_blank', rel: 'noopener' }, label);
    a.append(icon('arrow'));
    a.addEventListener('click', function () { if (!noMotion()) { a.classList.remove('flash'); void a.offsetWidth; a.classList.add('flash'); } });
    return a;
  }

  function statusChip(ev, ph) {
    if (ph === 'live') return h('span', { class: 'chip live' }, h('span', { class: 'dot' }), 'On now');
    if (ph === 'tonight') return h('span', { class: 'chip live' }, h('span', { class: 'dot' }), 'Next up');
    var map = { 'on-sale': 'On sale', 'final-release': 'Final release', 'sold-out': 'Sold out', 'coming-soon': 'Announced' };
    return h('span', { class: 'chip ' + (ev.ticketStatus === 'sold-out' ? '' : 'hot') }, h('span', { class: 'dot' }), map[ev.ticketStatus] || '');
  }

  /* "Project Hardstyle presents: X" -> "X" (the page already says "Project Hardstyle presents"). */
  function cleanTitle(t) { return String(t || '').replace(/^project hardstyle\s*(?:presents?\s*:?|[:\-–])\s*/i, '').trim() || t; }

  /* ---------------------------------------------------------------- home */
  function heroFor(ev) {
    var hero = $('#hero-inner');
    var ph = phase(ev), w = window_(ev);
    if (ev.poster) { var wash = $('#hero-wash'); wash.style.setProperty('--img', 'url("' + PH.img(ev.poster, 320) + '")'); wash.classList.add('on'); }

    var eyebrow = { soon: 'Next up', tonight: 'Next up', live: 'On now', after: 'Thanks for coming' }[ph];
    var title = h('h1', { class: 'hero-title', 'data-fit': '' }, h('span', { class: 'glow', text: cleanTitle(ev.title) }));
    var tag = ev.tagline || (ev.headliners.length ? 'ft ' + ev.headliners.join(', ') : '');
    var meta = h('ul', { class: 'meta' },
      h('li', null, icon('cal'), PH.fmtDateLong(ev.date)),
      ev.startTime ? h('li', null, icon('clock'), niceTime(ev.startTime) + (ev.endTime ? ' to ' + niceTime(ev.endTime) : '')) : null,
      ev.venue ? h('li', null, icon('pin'), ev.venue + (ev.suburb ? ', ' + ev.suburb : '')) : null
    );

    var sentence = 'Starts ' + PH.fmtDateLong(ev.date).replace(/ \d{4}$/, '') + (ev.startTime ? ' at ' + niceTime(ev.startTime) : '') + ', Adelaide time.';
    var cd = null, line = null;
    if (ph === 'soon' || ph === 'tonight') {
      cd = h('div', { class: 'countdown', role: 'timer', 'aria-label': 'Countdown to the start' });
      ['Days', 'Hours', 'Mins', 'Secs'].forEach(function (u) { cd.append(h('div', { class: 'unit' }, h('b', { text: '00' }), h('span', { text: u }))); });
      line = h('p', { class: 'countdown-line', text: sentence });
    } else if (ph === 'live') {
      line = h('p', { class: 'countdown-line', text: 'Happening now' + (ev.endTime ? ', till ' + niceTime(ev.endTime) : '') + '.' });
    } else {
      line = h('p', { class: 'countdown-line', text: 'That was the night. Photos land on Facebook within the week.' });
    }

    var cta = h('div', { class: 'cta-row' },
      ph === 'after' ? null : ticketsButton(ev, true),
      h('a', { class: 'btn btn-ghost', href: 'event.html?id=' + encodeURIComponent(ev.id) }, 'Event info'),
      ev.priceText && ph !== 'after' ? h('span', { class: 'price-note', text: ev.priceText }) : null);
    var trust = h('div', { class: 'trust' },
      ev.age ? h('span', { class: 'chip', text: ev.age }) : null,
      /moshtix\.com\.au/i.test(ev.ticketUrl || '') ? h('span', { class: 'chip', text: 'Tickets via Moshtix' }) : null);

    var copy = h('div', { class: 'hero-copy' },
      h('p', { class: 'eyebrow', text: eyebrow }),
      h('span', { class: 'presents', text: 'Project Hardstyle presents' }),
      title,
      tag ? h('p', { class: 'hero-tag', text: tag }) : null,
      meta, cd, line, cta, trust);

    var art = h('div', { class: 'hero-poster' }, h('div', { class: 'halo' }));
    var frame = h('a', { class: 'poster-frame', href: 'event.html?id=' + encodeURIComponent(ev.id), 'aria-label': cleanTitle(ev.title) + ' event page' });
    if (ev.poster) { var im = PH.posterImg(ev, 960); im.loading = 'eager'; im.fetchPriority = 'high'; frame.append(im); }
    if (ph !== 'soon') { var chip = statusChip(ev, ph); chip.classList.add('poster-tag'); art.append(chip); }
    art.append(frame);

    hero.replaceChildren(h('div', { class: 'hero-grid' }, copy, art));
    fitText(title);
    if (cd) tick(cd, w.start, function () { heroFor(ev); });
    tilt(frame);
    kickOnView(art);
    var nt = $('#nav-tickets');
    if (ph === 'after' || !ev.ticketUrl) { nt.href = 'event.html?id=' + encodeURIComponent(ev.id); nt.textContent = 'Event info'; }
    else { nt.href = ev.ticketUrl; nt.target = '_blank'; nt.rel = 'noopener'; }
    if (ph !== 'after') ticketBar(ev, cta);
  }

  function heroQuiet(last) {
    var hero = $('#hero-inner');
    if (last && last.poster) { var wash = $('#hero-wash'); wash.style.setProperty('--img', 'url("' + PH.img(last.poster, 320) + '")'); wash.classList.add('on'); }
    var copy = h('div', { class: 'hero-copy' },
      h('p', { class: 'eyebrow', text: 'Adelaide\'s Home of Hardstyle' }),
      h('h1', { class: 'hero-title', 'data-fit': '' }, 'Next event ', h('span', { class: 'glow', text: 'coming soon' })),
      h('p', { class: 'hero-tag', text: 'Join the presale list or follow on Instagram to hear the moment the next one is announced.' }),
      h('div', { class: 'cta-row' },
        h('a', { class: 'btn', href: '#follow' }, 'Join the presale list'),
        h('a', { class: 'btn btn-ghost', href: 'https://www.instagram.com/projecthardstyle_adelaide/', target: '_blank', rel: 'noopener' }, 'Instagram')
      ),
      last ? h('p', { class: 'countdown-line', style: 'margin-top:22px' }, 'Last time: ', h('a', { href: 'event.html?id=' + encodeURIComponent(last.id), style: 'color:var(--text);font-weight:700;text-decoration:underline', text: cleanTitle(last.title) }), ', ' + PH.fmtDate(last.date) + '.') : null
    );
    var art = h('div', { class: 'hero-poster' }, h('div', { class: 'halo' }));
    if (last && last.poster) {
      var frame = h('a', { class: 'poster-frame', href: 'event.html?id=' + encodeURIComponent(last.id), 'aria-label': cleanTitle(last.title) + ' event page' });
      var im = PH.posterImg(last, 960); im.loading = 'eager'; frame.append(im);
      art.append(h('span', { class: 'chip poster-tag', text: 'Last time · ' + PH.fmtDate(last.date) }), frame);
      tilt(frame);
    }
    hero.replaceChildren(h('div', { class: 'hero-grid' }, copy, art));
    fitAll();
    kickOnView(art);
    var nt = $('#nav-tickets'); nt.href = '#follow'; nt.textContent = 'Presale list';
  }

  function tick(box, start, done) {
    var b = box.querySelectorAll('b');
    function pad(n) { return String(n).padStart(2, '0'); }
    var t;
    function run() {
      var ms = start - new Date();
      if (ms <= 0) { clearInterval(t); done(); return; }  /* never sits at 00:00:00:00 */
      var s = Math.floor(ms / 1000);
      b[0].textContent = pad(Math.floor(s / 86400));
      b[1].textContent = pad(Math.floor(s % 86400 / 3600));
      b[2].textContent = pad(Math.floor(s % 3600 / 60));
      b[3].textContent = pad(s % 60);
    }
    run();
    t = setInterval(function () { if (document.visibilityState === 'visible') run(); }, 1000);
  }

  /* Eight "kicks" (150 BPM) on the poster glow when the hero comes into view, then rest. */
  function kickOnView(el) {
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (en) {
      if (en[0].isIntersecting && !noMotion()) { el.classList.remove('kick'); void el.offsetWidth; el.classList.add('kick'); }
    }, { threshold: .4 }).observe(el);
  }

  function tilt(el) {
    if (!el || noMotion() || matchMedia('(hover: none)').matches) return;
    var box = el.parentElement;
    box.addEventListener('pointermove', function (e) {
      var r = box.getBoundingClientRect();
      el.style.setProperty('--ry', (((e.clientX - r.left) / r.width - .5) * 12).toFixed(2) + 'deg');
      el.style.setProperty('--rx', (-((e.clientY - r.top) / r.height - .5) * 8).toFixed(2) + 'deg');
    });
    box.addEventListener('pointerleave', function () { el.style.removeProperty('--ry'); el.style.removeProperty('--rx'); });
  }

  /* Phones: a ticket bar pins to the bottom once the main button scrolls away. */
  function ticketBar(ev, watch) {
    var bar = $('#ticket-bar');
    if (!bar || !ev.ticketUrl || ev.ticketStatus === 'coming-soon') return;
    var thumb = h('div', { class: 'tb-thumb' }); if (ev.poster) thumb.append(pframe(ev, 160));
    var p = PH.parts(ev.date);
    bar.replaceChildren(thumb,
      h('div', { class: 'tb-text' }, h('b', { text: cleanTitle(ev.title) }),
        h('span', { text: p.weekday + ' ' + p.day + ' ' + p.month + (ev.startTime ? ' · ' + niceTime(ev.startTime) : '') + (ev.age ? ' · ' + ev.age : '') })),
      ticketsButton(ev, false, true));
    bar.removeAttribute('aria-hidden');
    document.body.classList.add('has-bar');
    /* Shown only once the main ticket button has scrolled up out of view. */
    var raf = 0;
    function check() { raf = 0; bar.classList.toggle('show', watch.getBoundingClientRect().bottom < 0); }
    addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(check); }, { passive: true });
    check();
  }

  function ticker(f) {
    var box = $('#ticker');
    if (!box) return;
    var ev = f.featured, items;
    if (ev) {
      items = ['Next up', cleanTitle(ev.title), PH.fmtDate(ev.date)].concat(ev.venue ? [ev.venue] : [])
        .concat(ev.headliners.slice(0, 4)).concat(ev.ticketUrl ? ['Tickets via Moshtix'] : []);
    } else {
      items = ['Adelaide\'s Home of Hardstyle', 'Since 2014', 'Next event coming soon', 'Join the presale list'];
    }
    var track = h('div', { class: 'track', 'aria-hidden': 'true' });
    for (var r = 0; r < 4; r++) items.forEach(function (t) { track.append(h('span', { text: t })); });
    box.replaceChildren(h('p', { class: 'sr-only', text: items.join(', ') }), track);
    box.hidden = false;
  }

  function card(ev) {
    var c = rgbVar(ev.accent);
    var a = h('article', { class: 'event-card', style: c ? '--c:' + c : null });
    var ph = phase(ev);
    a.append(h('div', { class: 'chips' }, statusChip(ev, ph === 'tonight' || ph === 'live' ? ph : null), ev.age ? h('span', { class: 'chip', text: ev.age }) : null),
      pframe(ev, 640),
      h('div', { class: 'body' },
        h('div', { class: 'date', text: PH.fmtDate(ev.date) + (ev.startTime ? ' · ' + niceTime(ev.startTime) : '') }),
        h('h3', null, h('a', { class: 'stretched', href: 'event.html?id=' + encodeURIComponent(ev.id), text: cleanTitle(ev.title) })),
        h('div', { class: 'where', text: [ev.venue, ev.suburb].filter(Boolean).join(', ') }),
        h('div', { class: 'go' }, ticketsButton(ev, false))));
    return a;
  }

  function wallItem(ev) {
    var c = rgbVar(ev.accent);
    var a = h('a', { class: 'wall-item', href: 'event.html?id=' + encodeURIComponent(ev.id), style: c ? '--c:' + c : null });
    a.append(ev.poster ? pframe(ev, 480) : h('div', { class: 'noart' }, h('b', { text: cleanTitle(ev.title) })),
      h('span', { class: 'cap' }, h('b', { text: cleanTitle(ev.title) }), PH.fmtDate(ev.date) + (ev.venue ? ' · ' + ev.venue : '')));
    return a;
  }

  function marquee(all) {
    var box = $('#marquee');
    if (!box) return;
    var seen = {}, names = [];
    all.slice().sort(byDate(-1)).forEach(function (ev) {
      ev.headliners.forEach(function (n) { var k = n.toLowerCase(); if (!seen[k]) { seen[k] = 1; names.push(n); } });
    });
    if (names.length < 6) return;
    var track = h('div', { class: 'track', 'aria-hidden': 'true' });
    for (var r = 0; r < 2; r++) names.forEach(function (n) { track.append(h('span', { text: n }), h('i')); });
    box.replaceChildren(h('p', { class: 'sr-only', text: 'Artists who have headlined Project Hardstyle events: ' + names.join(', ') }), track);
    box.hidden = false;
  }

  function home() {
    feed().then(function (f) {
      var src = f.featured || f.past[0];
      if (src && src.accent) PH.setAccent(src.accent);
      if (f.featured) heroFor(f.featured); else heroQuiet(f.past[0]);
      ticker(f);
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
      var se = $('#stat-events'); if (se) se.textContent = String(f.all.length);
      marquee(f.all);
      reveal();
    }).catch(function () {
      $('#hero-inner').replaceChildren(h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow', text: 'Project Hardstyle' }),
        h('h1', { class: 'hero-title', text: 'Adelaide\'s Home of Hardstyle' }),
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
        $$('button', bar).forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.y || '') === (y || ''))); });
      }
      bar.replaceChildren(h('button', { type: 'button', 'data-y': '', onclick: function () { draw(''); } }, 'All'));
      years.forEach(function (y) { bar.append(h('button', { type: 'button', 'data-y': y, onclick: function () { draw(y); } }, y)); });
      draw('');
      $('#archive-total').textContent = String(f.past.length);
      if (years.length) $('#archive-span').textContent = years[years.length - 1] + ' to ' + years[0];
      marquee(f.all);
    });
  }

  /* --------------------------------------------------------------- event */
  var SERIES = [/hardstyle halloween/i, /colours of the harder styles/i, /raw resistance/i, /masters of mayhem/i, /aussie all stars/i,
    /b(irth)?'?day/i, /raw machine/i, /origins/i, /rise of the titans/i, /anarchy/i, /dancing returns|dancing approved/i];

  function eventPage() {
    var id = new URLSearchParams(location.search).get('id');
    feed().then(function (f) {
      var ev = f.all.filter(function (e) { return e.id === id; })[0];
      var root = $('#event-layout');
      if (!ev) {
        root.replaceChildren(h('div', null,
          h('p', { class: 'eyebrow', text: 'Not found' }),
          h('h1', { class: 'section-title', text: 'That event is not here' }),
          h('p', { class: 'section-sub', text: 'It may have been removed. Here is everything that is on.' }),
          h('p', null, h('a', { class: 'btn', href: 'index.html' }, 'Back to events'))));
        return;
      }
      if (ev.accent) PH.setAccent(ev.accent);
      var title = cleanTitle(ev.title);
      document.title = title + ', ' + PH.fmtDate(ev.date) + (ev.venue ? ', ' + ev.venue : '') + ' · Project Hardstyle';
      if (ev.poster) $('#backdrop').style.setProperty('--img', 'url("' + PH.img(ev.poster, 320) + '")');

      var ph = ev.upcoming ? phase(ev) : 'after';
      var poster = h('div', { class: 'hero-poster' }, h('div', { class: 'halo' }));
      var frame = h('button', { class: 'poster-frame', type: 'button', 'aria-label': 'Open the poster full size', style: 'padding:0;border:0;width:100%' });
      if (ev.poster) { var im = PH.posterImg(ev, 960); im.loading = 'eager'; frame.append(im); frame.addEventListener('click', function () { openLightbox(ev.poster, im.alt); }); }
      poster.append(frame);

      var venueLine = [ev.venue, ev.suburb].filter(Boolean).join(', ');
      var dest = ev.address ? (ev.venue ? ev.venue + ', ' : '') + ev.address : venueLine + ', SA';
      var dir = ev.venue ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest) : null;

      var lineup = h('ul', { class: 'lineup' });
      ev.headliners.forEach(function (n) { lineup.append(h('li', { class: 'head' }, h('span', { text: n }), h('small', { text: 'Headliner' }))); });
      /* "12:00 Sickmode" shows as a set time; a timed list gets its own "Set times" heading. */
      var SET = /^(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\s*[-–:]?\s+(.+)$/i;
      var timed = ev.lineup.some(function (n) { return SET.test(n); });
      var sets = h('ul', { class: 'lineup' });
      ev.lineup.forEach(function (n) {
        var m = SET.exec(n);
        (timed ? sets : lineup).append(h('li', null, m ? h('span', null, h('em', { class: 'set', text: m[1] }), m[2]) : h('span', { text: n })));
      });

      var share = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: function () {
        var url = location.origin + location.pathname + '?id=' + encodeURIComponent(ev.id);
        if (navigator.share) navigator.share({ title: title, text: title + ', ' + PH.fmtDate(ev.date), url: url }).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { share.textContent = 'Link copied'; });
      } }, 'Share');

      var info = h('div', { class: 'event-info' },
        h('div', null, ev.upcoming ? statusChip(ev, ph === 'tonight' || ph === 'live' ? ph : null) : h('span', { class: 'chip', text: 'Past event' })),
        h('span', { class: 'presents', style: 'display:block;margin-top:16px', text: 'Project Hardstyle presents' }),
        h('h1', { text: title, 'data-fit': '' }),
        ev.tagline ? h('p', { class: 'tagline', text: ev.tagline }) : null,
        !ev.upcoming ? h('p', { class: 'ended' }, h('b', { text: 'This event has finished. ' }), 'Thanks to everyone who came.') : null,
        h('div', { class: 'facts' },
          h('div', { class: 'fact' }, h('span', { text: 'Date' }), h('b', { text: PH.fmtDateLong(ev.date) })),
          h('div', { class: 'fact' }, h('span', { text: 'Time' }), h('b', { text: ev.startTime ? niceTime(ev.startTime) + (ev.endTime ? ' to ' + niceTime(ev.endTime) : '') : 'To be announced' })),
          h('div', { class: 'fact' }, h('span', { text: 'Venue' }), h('b', { text: venueLine || 'To be announced' }),
            ev.address ? h('div', { style: 'color:var(--muted);font-size:14px;margin-top:4px', text: ev.address }) : null,
            dir ? h('a', { href: dir, target: '_blank', rel: 'noopener', text: 'Directions' }) : null),
          h('div', { class: 'fact' }, h('span', { text: 'Entry' }), h('b', { text: [ev.age, ev.priceText].filter(Boolean).join(' · ') || 'See tickets' }))
        ),
        ev.upcoming ? h('div', { class: 'cta-row', id: 'event-cta' }, ticketsButton(ev, true)) : null,
        h('div', { class: 'tool-row' },
          ev.upcoming ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: function () { ics(ev); } }, 'Add to calendar') : null,
          share),
        lineup.children.length ? h('h2', { class: 'eyebrow', style: 'margin:36px 0 12px', text: 'Lineup' }) : null,
        lineup.children.length ? lineup : null,
        timed ? h('h2', { class: 'eyebrow', style: 'margin:30px 0 12px', text: 'Set times' }) : null,
        timed ? sets : null,
        ev.description ? h('p', { class: 'event-desc', text: ev.description }) : null
      );
      root.replaceChildren(poster, info);
      fitAll();
      if (ev.upcoming) ticketBar(ev, $('#event-cta'));
      moreEvents(ev, f);
      jsonld(ev);
    });
  }

  /* Previous editions of the same series first, then the latest other nights. */
  function moreEvents(ev, f) {
    var series = SERIES.filter(function (re) { return re.test(ev.title); })[0];
    var others = f.all.filter(function (e) { return e.id !== ev.id; });
    var same = series ? others.filter(function (e) { return series.test(e.title); }).sort(byDate(-1)) : [];
    var rest = others.filter(function (e) { return same.indexOf(e) < 0 && !e.upcoming; }).sort(byDate(-1));
    var pick = same.concat(rest).slice(0, 8);
    if (!pick.length) return;
    if (same.length) { $('#more-eyebrow').textContent = 'Previous editions'; $('#more-title').replaceChildren('Same night, ', h('span', { class: 'outline', text: 'other years' })); }
    var wall = $('#more-wall');
    pick.forEach(function (e) { wall.append(wallItem(e)); });
    $('#more').hidden = false;
  }

  /* Google reads this to list the show in its event search. */
  function jsonld(ev) {
    var w = window_(ev);
    function iso(d) {
      var off = offsetMinutes(d), local = new Date(d.getTime() + off * 60000);
      var sign = off < 0 ? '-' : '+', a = Math.abs(off);
      return local.toISOString().slice(0, 19) + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
    }
    var price = (/\$\s?(\d+(?:\.\d{1,2})?)/.exec(ev.priceText || '') || [])[1];
    var addr = { '@type': 'PostalAddress', addressLocality: ev.suburb || 'Adelaide', addressRegion: 'SA', addressCountry: 'AU' };
    if (ev.address) addr.streetAddress = ev.address.split(',')[0];
    var data = {
      '@context': 'https://schema.org', '@type': 'MusicEvent', name: cleanTitle(ev.title),
      startDate: ev.startTime ? iso(w.start) : ev.date,
      endDate: ev.endTime ? iso(w.end) : undefined,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: ev.venue || 'Adelaide', address: addr },
      image: ev.poster ? [ev.poster] : undefined,
      description: ev.description || ev.tagline || undefined,
      organizer: { '@type': 'Organization', name: 'Project Hardstyle', url: location.origin + '/' },
      performer: ev.headliners.map(function (n) { return { '@type': 'MusicGroup', name: n }; }),
      offers: ev.ticketUrl ? {
        '@type': 'Offer', url: ev.ticketUrl, priceCurrency: 'AUD', price: price || undefined,
        availability: ev.ticketStatus === 'sold-out' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'
      } : undefined,
      typicalAgeRange: /18/.test(ev.age || '') ? '18-' : undefined
    };
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(data);
    document.head.append(s);
  }

  /* A calendar file (.ics) the phone's calendar app opens straight away. */
  function ics(ev) {
    var w = window_(ev);
    function z(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    function esc(s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }
    var body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Project Hardstyle//Events//EN', 'BEGIN:VEVENT',
      'UID:' + ev.id + '@projecthardstyle', 'DTSTAMP:' + z(new Date()), 'DTSTART:' + z(w.start), 'DTEND:' + z(w.end),
      'SUMMARY:' + esc(cleanTitle(ev.title)), 'LOCATION:' + esc([ev.venue, ev.address || ev.suburb].filter(Boolean).join(', ')),
      'DESCRIPTION:' + esc((ev.tagline ? ev.tagline + '\n' : '') + (ev.ticketUrl ? 'Tickets: ' + ev.ticketUrl : '')),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = h('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: 'project-hardstyle-' + ev.date + '.ics' });
    document.body.append(a); a.click(); a.remove();
  }

  /* Shrink a heading until its longest word fits on one line (wide type + long artist names). */
  function fitText(el) {
    if (!el) return;
    el.style.fontSize = '';
    var size = parseFloat(getComputedStyle(el).fontSize), min = 22;
    while (size > min && el.scrollWidth > el.clientWidth + 1) { size -= 2; el.style.fontSize = size + 'px'; }
  }
  /* Fit now, again once the web fonts finish loading, and once more shortly after. */
  function fitAll() {
    $$('[data-fit]').forEach(fitText);
    if (document.fonts && document.fonts.ready && !fitAll.waiting) {
      fitAll.waiting = true;
      document.fonts.ready.then(function () { fitAll.waiting = false; $$('[data-fit]').forEach(fitText); });
    }
  }
  var fitTimer;
  addEventListener('resize', function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitAll, 150); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);

  /* ------------------------------------------------------------- chrome */
  function header() {
    var hd = $('.site-header');
    if (!hd) return;
    function onScroll() { hd.classList.toggle('scrolled', scrollY > 20); }
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    var t = $('.nav-toggle');
    if (t) t.addEventListener('click', function () { t.setAttribute('aria-expanded', String(hd.classList.toggle('open'))); });
    $$('.nav a').forEach(function (a) { a.addEventListener('click', function () { hd.classList.remove('open'); if (t) t.setAttribute('aria-expanded', 'false'); }); });
  }

  function reveal() {
    var els = $$('.reveal:not(.in)');
    if (!('IntersectionObserver' in window) || noMotion()) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (e) { io.observe(e); });
  }

  /* The "Motion" switch in the footer, remembered on this device. */
  function motionSwitch() {
    $$('.motion-toggle').forEach(function (b) {
      function sync() { b.setAttribute('aria-pressed', String(!document.documentElement.classList.contains('still'))); }
      sync();
      b.addEventListener('click', function () {
        var off = document.documentElement.classList.toggle('still');
        try { localStorage.setItem('ph-motion', off ? 'off' : 'on'); } catch (e) {}
        $$('.motion-toggle').forEach(function (x) { x.setAttribute('aria-pressed', String(!off)); });
        if (off) $$('.reveal').forEach(function (e) { e.classList.add('in'); });
      });
    });
  }

  /* Visual-only presale form for the concept. */
  function joinForm() {
    var f = $('#join-form');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      $('#join-note').textContent = 'Preview only: on the live site this adds them to your presale list, so you can email them the second tickets drop.';
    });
  }

  function openLightbox(src, alt) {
    var lb = $('#lightbox');
    if (!lb || !lb.showModal) { window.open(src, '_blank', 'noopener'); return; }
    var img = $('#lightbox-img'); img.src = src; img.alt = alt || '';
    lb.showModal();
  }
  function lightbox() {
    var lb = $('#lightbox');
    if (!lb) return;
    $$('.shot').forEach(function (b) {
      b.addEventListener('click', function () { var s = b.querySelector('img'); openLightbox(b.dataset.full, s ? s.alt : ''); });
    });
    $('#lightbox-close').addEventListener('click', function () { lb.close(); });
    lb.addEventListener('click', function (e) { if (e.target === lb) lb.close(); });
  }

  header(); joinForm(); motionSwitch(); lightbox(); reveal();
  var page = document.body.dataset.page;
  if (page === 'home') home();
  else if (page === 'archive') archive();
  else if (page === 'event') eventPage();
})();
