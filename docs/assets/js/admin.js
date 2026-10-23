/* Project Hardstyle — organiser login and events dashboard. */
(function () {
  'use strict';
  var PH = window.PH, h = PH.h;

  /* The login only works on the main address (the sign-in cookie lives there). */
  if (!PH.onVercel) { location.replace(PH.VERCEL_ORIGIN + '/admin/'); return; }

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  var state = { events: [], today: '', tab: 'upcoming', editing: null, uploading: false, palette: [] };
  var ICON_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>';
  var ICON_BIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

  /* ------------------------------------------------------------ requests */
  function send(method, path, body) {
    return fetch(path, {
      method: method, credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 401) { show('login'); }
        if (!r.ok) { var e = new Error(b.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
        return b;
      });
    });
  }

  /* ---------------------------------------------------------------- views */
  function show(view) {
    $('#login').hidden = view !== 'login';
    $('#app').hidden = view !== 'app';
    if (view === 'login') setTimeout(function () { $('#pw').focus(); }, 50);
  }

  var toastTimer;
  function toast(msg, opts) {
    opts = opts || {};
    var t = $('#toast');
    t.className = 'toast' + (opts.err ? ' err' : '');
    t.textContent = msg;
    if (opts.link) t.append(h('a', { href: opts.link.href, target: '_blank', rel: 'noopener', text: opts.link.text }));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, opts.ms || 5200);
  }

  /* ---------------------------------------------------------------- login */
  $('#pw-toggle').addEventListener('click', function () {
    var pw = $('#pw'), on = pw.type === 'password';
    pw.type = on ? 'text' : 'password';
    this.textContent = on ? 'Hide' : 'Show';
    this.setAttribute('aria-label', on ? 'Hide password' : 'Show password');
  });
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#login-btn'), err = $('#login-err');
    err.textContent = '';
    if (!$('#pw').value) { err.textContent = 'Type the password first.'; return; }
    btn.setAttribute('aria-disabled', 'true'); btn.textContent = 'Signing in…';
    send('POST', '/api/login', { password: $('#pw').value })
      .then(function () { $('#pw').value = ''; show('app'); load(); })
      .catch(function (x) { err.textContent = x.message; })
      .then(function () { btn.removeAttribute('aria-disabled'); btn.textContent = 'Sign in'; });
  });
  $('#logout').addEventListener('click', function () {
    send('POST', '/api/logout').catch(function () {}).then(function () { show('login'); });
  });

  /* ---------------------------------------------------------------- list */
  function load() {
    return PH.getJSON('/api/events?all=1').then(function (d) {
      state.events = d.events || [];
      state.today = d.today || '';
      render();
    }).catch(function (e) {
      if (e.status === 401) show('login'); else toast(e.message, { err: true });
    });
  }

  function groups() {
    var g = { upcoming: [], archive: [], hidden: [] };
    state.events.forEach(function (ev) {
      if (!ev.published) g.hidden.push(ev);
      else if (ev.upcoming) g.upcoming.push(ev);
      else g.archive.push(ev);
    });
    g.upcoming.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    g.archive.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    g.hidden.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return g;
  }

  function render() {
    var g = groups();
    $('#n-upcoming').textContent = g.upcoming.length;
    $('#n-archive').textContent = g.archive.length;
    $('#n-hidden').textContent = g.hidden.length;
    $$('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)); });
    var list = $('#list');
    list.replaceChildren();
    var items = g[state.tab];
    if (!items.length) {
      var msg = {
        upcoming: ['Nothing coming up yet', 'Add your next event, or paste its Moshtix link above.'],
        archive: ['No past events', 'Events move here by themselves the morning after the show.'],
        hidden: ['No hidden events', 'Anything you switch off "Show on the website" waits here.']
      }[state.tab];
      list.append(h('div', { class: 'a-empty' }, h('b', { text: msg[0] }), msg[1]));
      return;
    }
    items.forEach(function (ev) { list.append(row(ev)); });
  }

  function row(ev) {
    var thumb = h('div', { class: 'thumb' });
    if (ev.poster) thumb.append(PH.posterImg(ev, 160)); else thumb.innerHTML = ICON_IMG;
    var chips = h('div', { class: 'chips' },
      h('span', { class: 'chip' + (ev.ticketStatus === 'sold-out' ? '' : ' hot'), text: PH.STATUS[ev.ticketStatus] || ev.ticketStatus }),
      ev.featured ? h('span', { class: 'chip live', text: 'Featured' }) : null,
      !ev.published ? h('span', { class: 'chip', text: 'Hidden' }) : null
    );
    var del = h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Delete ' + ev.title, onclick: function () { askDelete(ev); } });
    del.innerHTML = ICON_BIN;
    return h('article', { class: 'a-row' },
      thumb,
      h('div', null,
        h('h3', { text: ev.title }),
        h('div', { class: 'sub', text: [PH.fmtDate(ev.date), ev.venue].filter(Boolean).join(' · ') }),
        chips
      ),
      h('div', { class: 'acts' },
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Edit', onclick: function () { openEditor(ev); } }),
        ev.published ? h('a', { class: 'btn btn-ghost btn-sm', href: '../event.html?id=' + encodeURIComponent(ev.id), target: '_blank', rel: 'noopener', text: 'View' }) : null,
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Copy', title: 'Start a new event from this one',
          onclick: function () { openEditor(copyOf(ev)); } }),
        del
      )
    );
  }

  /* A copy keeps the venue, times and lineup, and clears what changes each time. */
  function copyOf(ev) {
    var c = JSON.parse(JSON.stringify(ev));
    delete c.id; c.date = ''; c.ticketUrl = ''; c.poster = null; c.posterW = null; c.posterH = null;
    c.featured = false; c.published = true; c.ticketStatus = 'on-sale'; c.accent = null;
    c.title = ev.title;
    return c;
  }

  $$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.dataset.tab; render(); });
  });

  /* ------------------------------------------------------------- editor */
  var ed = $('#editor');
  var F = ['title', 'tagline', 'date', 'startTime', 'endTime', 'venue', 'suburb', 'address', 'ticketUrl', 'priceText', 'age', 'description'];

  /* Venues they have used before: pick one and its suburb and address fill in. */
  function venueMemory() {
    var seen = {};
    state.events.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (e) {
      if (e.venue && !seen[e.venue.toLowerCase()]) seen[e.venue.toLowerCase()] = e;
    });
    var dl = $('#venues');
    dl.replaceChildren();
    Object.keys(seen).forEach(function (k) { dl.append(h('option', { value: seen[k].venue })); });
    return seen;
  }
  $('#f-venue').addEventListener('change', function () {
    var hit = venueMemory()[this.value.trim().toLowerCase()];
    if (!hit) return;
    if (!$('#f-suburb').value && hit.suburb) $('#f-suburb').value = hit.suburb;
    if (!$('#f-address').value && hit.address) $('#f-address').value = hit.address;
  });

  function openEditor(ev) {
    state.editing = ev && ev.id ? ev : null;
    var e = ev || {};
    $('#ed-title').textContent = state.editing ? 'Edit event' : 'New event';
    F.forEach(function (k) { $('#f-' + k).value = e[k] || ''; });
    if (!e.age) $('#f-age').value = '18+';
    $('#f-headliners').value = (e.headliners || []).join('\n');
    $('#f-lineup').value = (e.lineup || []).join('\n');
    var st = e.ticketStatus || 'on-sale';
    $$('input[name="ticketStatus"]').forEach(function (r) { r.checked = r.value === st; });
    $('#f-published').checked = e.published !== false;
    $('#f-featured').checked = Boolean(e.featured);
    $('#ed-err').textContent = '';
    setPoster(e.poster ? { url: e.poster, w: e.posterW, h: e.posterH, accent: e.accent } : null);
    dateWarn();
    ed.showModal();
    ed.querySelector('.ed-body').scrollTop = 0;
  }
  function closeEditor() { ed.close(); state.editing = null; }
  $('#ed-close').addEventListener('click', closeEditor);
  $('#ed-cancel').addEventListener('click', closeEditor);
  ed.addEventListener('cancel', function () { state.editing = null; });

  $('#new-ev').addEventListener('click', function () { openEditor(null); });

  function dateWarn() {
    var v = $('#f-date').value;
    $('#date-warn').hidden = !(v && state.today && v < state.today);
  }
  $('#f-date').addEventListener('input', dateWarn);

  /* ---------------------------------------------------------------- poster */
  function setPoster(p) {
    var img = $('#poster-preview'), drop = $('#drop');
    $('#f-poster').value = p ? p.url : '';
    $('#f-posterW').value = p && p.w ? p.w : '';
    $('#f-posterH').value = p && p.h ? p.h : '';
    $('#f-accent').value = p && p.accent ? p.accent : '';
    img.hidden = !p; $('#drop-empty').hidden = Boolean(p); $('#poster-tools').hidden = !p;
    drop.classList.toggle('has', Boolean(p));
    if (p) {
      img.src = PH.img(p.url, 640);
      img.onerror = function () { img.onerror = null; img.src = p.url; };
      if (p.palette && p.palette.length) swatches(p.palette, p.accent || p.palette[0]);
      else readPalette(p.url, p.accent);
    } else {
      img.removeAttribute('src'); swatches([], null);
    }
  }

  /* Colours for an already-stored poster: read through the same-origin image
     resizer so the browser lets us look at the pixels. */
  function readPalette(url, current) {
    var im = new Image();
    im.onload = function () {
      var pal = PH.palette(im);
      if (current && pal.indexOf(current) < 0) pal.unshift(current);
      swatches(pal, current || pal[0]);
    };
    im.onerror = function () { swatches(current ? [current] : [], current); };
    im.src = PH.img(url, 320);
  }

  function swatches(list, chosen) {
    var box = $('#swatches');
    box.replaceChildren();
    $('#swatches-wrap').hidden = !list.length;
    if (!list.length) { $('#f-accent').value = ''; ed.style.removeProperty('--accent'); return; }
    if (!chosen) chosen = list[0];
    list.forEach(function (hex) {
      var b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-label': 'Use ' + hex,
        'aria-checked': String(hex === chosen), style: 'background:' + hex + ';color:' + hex,
        onclick: function () { pick(hex); } });
      box.append(b);
    });
    pick(chosen);
  }
  function pick(hex) {
    $('#f-accent').value = hex;
    $$('#swatches .swatch').forEach(function (s) { s.setAttribute('aria-checked', String(s.getAttribute('aria-label') === 'Use ' + hex)); });
    PH.setAccent(hex, ed);
  }

  function chooseFile() { $('#poster-file').click(); }
  $('#drop').addEventListener('click', function () { if (!state.uploading) chooseFile(); });
  $('#drop').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseFile(); } });
  $('#poster-change').addEventListener('click', chooseFile);
  $('#poster-remove').addEventListener('click', function () { setPoster(null); });
  $('#poster-file').addEventListener('change', function () { if (this.files[0]) upload(this.files[0]); this.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    $('#drop').addEventListener(t, function (e) { e.preventDefault(); this.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    $('#drop').addEventListener(t, function (e) { e.preventDefault(); this.classList.remove('over'); });
  });
  $('#drop').addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) upload(f);
  });

  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { ok(im); };
      im.onerror = function () { bad(new Error('That file could not be opened as an image.')); };
      im.src = url;
    });
  }

  /* Shrink in the browser (long edge 2000px), read its colours, then upload. */
  function upload(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Use a JPG, PNG or WebP image.', { err: true }); return; }
    state.uploading = true;
    $('#drop-busy').hidden = false;
    var pal = [], w = 0, hh = 0;
    loadBitmap(file).then(function (bmp) {
      var scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      w = Math.round(bmp.width * scale); hh = Math.round(bmp.height * scale);
      var c = document.createElement('canvas');
      c.width = w; c.height = hh;
      var x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, w, hh);
      x.drawImage(bmp, 0, 0, w, hh);
      pal = PH.palette(c);
      return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.88); });
    }).then(function (blob) {
      if (!blob) throw new Error('Could not prepare that image.');
      return fetch('/api/upload', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'image/jpeg', 'X-PH-Upload': '1' }, body: blob
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 401) { show('login'); }
        if (!r.ok) throw new Error(b.error || 'Upload failed. Try again.');
        return b;
      });
    }).then(function (b) {
      setPoster({ url: b.url, w: b.width, h: b.height, palette: pal });
    }).catch(function (e) {
      toast(e.message, { err: true });
    }).then(function () {
      state.uploading = false;
      $('#drop-busy').hidden = true;
    });
  }

  /* ------------------------------------------------- start from a Moshtix link */
  /* Moshtix puts the event name in the link itself, e.g.
     moshtix.com.au/v2/event/project-hardstyle-presents-the-raw-machine/198285 -> "The Raw Machine".
     (Moshtix blocks automatic page reads from servers, so the link is all we use.) */
  function draftFromLink(raw) {
    var u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
    var m = /^\/v2\/event\/([^/]+)\/(\d+)/.exec(u.pathname);
    if (!/(^|\.)moshtix\.com\.au$/i.test(u.hostname) || !m) return null;
    var name = m[1].toLowerCase()
      .replace(/^project-hardstyle-(proudly-)?(presents?-)?/, '')
      .split(/-(?:ft|feat|featuring)-/)[0]
      .split('-').filter(Boolean)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
    return { title: name, ticketUrl: 'https://www.moshtix.com.au' + u.pathname, ticketStatus: 'on-sale', age: '18+', published: true };
  }

  $('#import-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#import-err');
    err.textContent = '';
    var d = draftFromLink($('#import-url').value);
    if (!d) { err.textContent = 'Paste a Moshtix event link. It looks like moshtix.com.au/v2/event/...'; return; }
    $('#import-url').value = '';
    openEditor(d);
    toast('Ticket link and name are in. Add the poster and date, then save.');
  });

  /* ----------------------------------------------------------------- save */
  function lines(id) { return $(id).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }

  $('#ev-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#ed-err');
    err.textContent = '';
    if (state.uploading) { err.textContent = 'Hang on, the poster is still uploading.'; return; }
    if (!$('#f-title').value.trim()) { err.textContent = 'Give the event a name.'; $('#f-title').focus(); return; }
    if (!$('#f-date').value) { err.textContent = 'Pick the date.'; $('#f-date').focus(); return; }
    var p = {};
    F.forEach(function (k) { p[k] = $('#f-' + k).value; });
    p.headliners = lines('#f-headliners');
    p.lineup = lines('#f-lineup');
    p.ticketStatus = ($('input[name="ticketStatus"]:checked') || {}).value || 'on-sale';
    p.poster = $('#f-poster').value || null;
    p.posterW = Number($('#f-posterW').value) || null;
    p.posterH = Number($('#f-posterH').value) || null;
    p.accent = $('#f-accent').value || null;
    p.published = $('#f-published').checked;
    p.featured = $('#f-featured').checked;
    var editing = state.editing;
    if (editing) p.id = editing.id;
    var btn = $('#ed-save');
    btn.setAttribute('aria-disabled', 'true'); btn.textContent = 'Saving…';
    send(editing ? 'PUT' : 'POST', '/api/events', p).then(function (b) {
      closeEditor();
      var ev = b.event;
      state.tab = !ev.published ? 'hidden' : ev.upcoming ? 'upcoming' : 'archive';
      toast(ev.published ? 'Saved. It\'s live on the website.' : 'Saved as hidden.',
        ev.published ? { link: { href: '../event.html?id=' + encodeURIComponent(ev.id), text: 'View it' } } : {});
      return load();
    }).catch(function (x) { err.textContent = x.message; })
      .then(function () { btn.removeAttribute('aria-disabled'); btn.textContent = 'Save event'; });
  });

  /* --------------------------------------------------------------- delete */
  var cf = $('#confirm'), pending = null;
  function askDelete(ev) {
    pending = ev;
    $('#cf-text').textContent = '"' + ev.title + '" (' + PH.fmtDate(ev.date) + ') comes off the website straight away. This can\'t be undone.';
    cf.showModal();
  }
  $('#cf-no').addEventListener('click', function () { cf.close(); pending = null; });
  $('#cf-yes').addEventListener('click', function () {
    if (!pending) return;
    var ev = pending, btn = this;
    btn.setAttribute('aria-disabled', 'true');
    send('DELETE', '/api/events', { id: ev.id }).then(function () {
      cf.close(); pending = null;
      toast('Deleted. It\'s off the website.');
      return load();
    }).catch(function (x) { toast(x.message, { err: true }); })
      .then(function () { btn.removeAttribute('aria-disabled'); });
  });

  /* ----------------------------------------------------------------- start */
  PH.getJSON('/api/login').then(function (s) {
    if (s.authed) { show('app'); load(); } else show('login');
  }).catch(function () { show('login'); });
})();
