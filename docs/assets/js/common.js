/* Project Hardstyle — shared browser helpers (public site + organiser login).
   The site runs on Vercel (with the API) and as a static copy on GitHub Pages;
   the copy reads the same live API from the Vercel origin. */
(function () {
  'use strict';

  var VERCEL_ORIGIN = 'https://projecthardstyle.vercel.app';
  var onVercel = /\.vercel\.app$/.test(location.hostname);
  var API = onVercel ? '' : VERCEL_ORIGIN;

  var STATUS = {
    'on-sale': 'Tickets on sale',
    'final-release': 'Final release',
    'sold-out': 'Sold out',
    'coming-soon': 'Coming soon'
  };

  /* Dates are plain YYYY-MM-DD strings. Read them at noon UTC and format in UTC
     so no device time zone can shift the day. */
  function parts(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    function f(o) { return new Intl.DateTimeFormat('en-AU', Object.assign({ timeZone: 'UTC' }, o)).format(d); }
    return {
      weekday: f({ weekday: 'short' }),
      weekdayLong: f({ weekday: 'long' }),
      day: f({ day: 'numeric' }),
      month: f({ month: 'short' }),
      monthLong: f({ month: 'long' }),
      year: f({ year: 'numeric' })
    };
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = parts(iso);
    return p.weekday + ' ' + p.day + ' ' + p.month + ' ' + p.year;
  }
  function fmtDateLong(iso) {
    if (!iso) return '';
    var p = parts(iso);
    return p.weekdayLong + ' ' + p.day + ' ' + p.monthLong + ' ' + p.year;
  }

  /* Poster images go through Vercel's image resizer (smaller, modern formats).
     If it ever fails, the <img> falls back to the original file. */
  function img(url, w) {
    if (!url) return '';
    if (!/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i.test(url)) return url;
    var sizes = [320, 480, 640, 960, 1280, 1920];
    var pick = sizes[sizes.length - 1];
    for (var i = 0; i < sizes.length; i++) { if (sizes[i] >= w) { pick = sizes[i]; break; } }
    return (onVercel ? '' : VERCEL_ORIGIN) + '/_vercel/image?url=' + encodeURIComponent(url) + '&w=' + pick + '&q=78';
  }
  function posterImg(ev, w, cls) {
    var el = document.createElement('img');
    el.className = cls || '';
    el.alt = ev.title + (ev.date ? ' — ' + fmtDate(ev.date) : '') + ' poster';
    el.decoding = 'async';
    el.loading = 'lazy';
    if (ev.posterW && ev.posterH) { el.width = ev.posterW; el.height = ev.posterH; }
    el.src = img(ev.poster, w);
    el.addEventListener('error', function once() {
      el.removeEventListener('error', once);
      if (ev.poster && el.src !== ev.poster) el.src = ev.poster;
    });
    return el;
  }

  /* Tiny element builder: h('a', {href: '#', class: 'x'}, 'text', child) */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) el.append(x); });
      else el.append(c);
    }
    return el;
  }

  /* Accent colour: the site takes on each event's own poster colour. */
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }
  function setAccent(hex, root) {
    var rgb = hexToRgb(hex);
    if (!rgb) return;
    var el = root || document.documentElement;
    el.style.setProperty('--accent', hex);
    el.style.setProperty('--accent-rgb', rgb.join(','));
    /* Pick black or white text for buttons filled with the accent. */
    var lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    el.style.setProperty('--on-accent', lum > 0.55 ? '#07060a' : '#ffffff');
  }

  /* Read a palette of vivid colours from an image (used when a poster is
     uploaded). Returns hex strings, strongest first. */
  function palette(source) {
    var w = 72, hgt = 90;
    var c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(source, 0, 0, w, hgt);
    var data;
    try { data = x.getImageData(0, 0, w, hgt).data; } catch (e) { return []; }
    var bins = [];
    for (var b = 0; b < 36; b++) bins.push({ wt: 0, r: 0, g: 0, b: 0 });
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i] / 255, g = data[i + 1] / 255, bl = data[i + 2] / 255;
      var max = Math.max(r, g, bl), min = Math.min(r, g, bl), d = max - min;
      var s = max === 0 ? 0 : d / max, v = max;
      if (s < 0.42 || v < 0.42) continue;
      var hue;
      if (d === 0) hue = 0;
      else if (max === r) hue = ((g - bl) / d) % 6;
      else if (max === g) hue = (bl - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue = (hue * 60 + 360) % 360;
      var wt = s * v * v;
      var bin = bins[Math.floor(hue / 10) % 36];
      bin.wt += wt; bin.r += data[i] * wt; bin.g += data[i + 1] * wt; bin.b += data[i + 2] * wt;
    }
    var ranked = bins.map(function (bn, idx) { return { idx: idx, bn: bn }; })
      .filter(function (o) { return o.bn.wt > 0.5; })
      .sort(function (a, z) { return z.bn.wt - a.bn.wt; });
    var picked = [];
    ranked.forEach(function (o) {
      if (picked.length >= 5) return;
      var far = picked.every(function (p) { var dd = Math.abs(p.idx - o.idx); return Math.min(dd, 36 - dd) >= 3; });
      if (far) picked.push(o);
    });
    return picked.map(function (o) {
      return vivid([o.bn.r / o.bn.wt, o.bn.g / o.bn.wt, o.bn.b / o.bn.wt]);
    });
  }
  /* Push a colour towards "neon on black": saturated, bright enough to read. */
  function vivid(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, s = 0, hue = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue /= 6;
    }
    s = Math.max(s, 0.82);
    l = Math.min(Math.max(l, 0.52), 0.64);
    function k(n) {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, t = hue + n;
      if (t < 0) t += 1; if (t > 1) t -= 1;
      var out = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
      return Math.round(out * 255).toString(16).padStart(2, '0');
    }
    return '#' + k(1 / 3) + k(0) + k(-1 / 3);
  }

  function getJSON(path, opts) {
    return fetch(API + path, Object.assign({ credentials: onVercel ? 'same-origin' : 'omit', cache: 'no-store' }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) { var e = new Error(body.error || ('Request failed (' + r.status + ')')); e.status = r.status; throw e; }
          return body;
        });
      });
  }

  window.PH = {
    API: API, VERCEL_ORIGIN: VERCEL_ORIGIN, onVercel: onVercel, STATUS: STATUS,
    fmtDate: fmtDate, fmtDateLong: fmtDateLong, parts: parts, img: img, posterImg: posterImg,
    h: h, setAccent: setAccent, hexToRgb: hexToRgb, palette: palette, vivid: vivid, getJSON: getJSON
  };
})();
