/* Flippod outer-screen layer. Injected into the stock KaiOS outer page (chrome://system/content/index_remote.html).
 * Shows a vinyl clock + listening stats, or Flippod's now-playing while music plays, on top of the stock idle
 * screen only (calls, the selfie camera and the volume popup still appear over it).
 * Side buttons while the lid is shut: hold Vol+ = next track, hold Vol- = play/pause. */
(function () {
  'use strict';
  const HOLD_MS = 600;
  const PAUSE_GRACE_MS = 120000; // keep showing a paused track for 2 min before going back to the clock
  let np = null;
  let st = null;
  let flip = null;
  let root = null;
  let el = {};
  let tick = 0;
  let mode = '';
  let battery = null;
  let lyr = null; // [[t, text], ...]
  let lyrIdx = -2;

  const $ = (tag, cls, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  };

  function build(host) {
    root = $('div', 'fp-root', host);
    root.id = 'fp-outer';
    // clock
    const clock = $('div', 'fp-clock', root);
    const bat = $('div', 'fp-bat', clock);
    el.bolt = $('span', 'fp-bolt', bat);
    el.bolt.textContent = '⚡';
    el.pct = $('span', 'fp-pct', bat);
    const disc = $('div', 'fp-disc', clock);
    el.ring = $('div', 'fp-ring', disc);
    el.mask = $('div', 'fp-mask', disc);
    const vinyl = $('div', 'fp-vinyl', disc);
    el.time = $('div', 'fp-time', vinyl);
    el.date = $('div', 'fp-date', vinyl);
    const sb = $('div', 'fp-stats', clock);
    el.s1 = $('div', 'fp-s1', sb);
    el.s2 = $('div', 'fp-s2', sb);
    // now playing
    const p = $('div', 'fp-np', root);
    el.art = $('img', 'fp-art', p);
    el.ph = $('div', 'fp-ph', p);
    el.ph.textContent = '♫';
    el.pause = $('div', 'fp-pause', p);
    el.lyr = $('div', 'fp-lyr', p);
    el.bar = $('div', 'fp-bar', p);
    el.fill = $('i', '', el.bar);
    el.title = $('div', 'fp-title', p);
    el.titleS = $('span', '', el.title);
    el.artist = $('div', 'fp-artist', p);
    el.toast = $('div', 'fp-toast', root);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function showingNP() {
    if (!np || !np.title) return false;
    if (np.playing) return true;
    return np.pausedAt && Date.now() - np.pausedAt < PAUSE_GRACE_MS;
  }

  function render() {
    if (!root) return;
    const want = showingNP() ? 'np' : 'clock';
    if (want !== mode) {
      mode = want;
      root.dataset.mode = mode;
      if (mode === 'np') renderNP(true);
    }
    const now = new Date();
    if (mode === 'clock') {
      const h = now.getHours() % 12 || 12;
      const t = `${h}:${pad(now.getMinutes())}`;
      if (el.time.textContent !== t) el.time.textContent = t;
      const d = `${DAYS[now.getDay()]} ${MONTHS[now.getMonth()]} ${now.getDate()}`;
      if (el.date.textContent !== d) el.date.textContent = d;
      const charging = battery && battery.charging;
      const p = charging ? battery.level : now.getSeconds() / 60;
      root.style.setProperty('--p', p.toFixed(4));
      root.classList.toggle('fp-charging', !!charging);
      const s1 = st && (st.min || st.songs) && st.day === dayKey(now) ? `${st.min} min · ${st.songs} song${st.songs === 1 ? '' : 's'}` : 'No music yet today';
      if (el.s1.textContent !== s1) el.s1.textContent = s1;
      const s2 = st && st.top ? `♪ ${st.top}` : '';
      if (el.s2.textContent !== s2) el.s2.textContent = s2;
    } else {
      const pos = np.playing ? np.pos + (Date.now() - np.at) / 1000 : np.pos;
      const k = np.dur ? Math.max(0, Math.min(1, pos / np.dur)) : 0;
      el.fill.style.transform = `scaleX(${k.toFixed(4)})`;
      lyricLine(pos);
    }
    if (battery) {
      const pct = Math.round(battery.level * 100) + '%';
      if (el.pct.textContent !== pct) el.pct.textContent = pct;
      el.bolt.style.display = battery.charging ? '' : 'none';
    }
  }

  function lyricLine(pos) {
    let i = -1;
    if (lyr) {
      let lo = 0, hi = lyr.length - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (lyr[m][0] <= pos + 0.3) { i = m; lo = m + 1; } else hi = m - 1; }
    }
    if (i === lyrIdx) return;
    lyrIdx = i;
    const txt = i >= 0 ? lyr[i][1] : '';
    root.classList.toggle('fp-haslyr', !!txt);
    if (txt) {
      el.lyr.textContent = txt;
      el.lyr.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    }
  }

  function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function renderNP(force) {
    if (!np) return;
    if (force || el.titleS.textContent !== np.title) {
      el.titleS.textContent = np.title;
      el.artist.textContent = np.artist || '';
      marquee();
    }
    if (np.art) {
      if (el.art.getAttribute('src') !== np.art) el.art.src = np.art;
      el.art.style.display = '';
      el.ph.style.display = 'none';
    } else {
      el.art.style.display = 'none';
      el.ph.style.display = '';
    }
    root.classList.toggle('fp-paused', !np.playing);
  }

  let mq = null;
  function marquee() {
    if (mq) { mq.cancel(); mq = null; }
    requestAnimationFrame(() => {
      const over = el.titleS.scrollWidth - el.title.clientWidth;
      if (over <= 1) return;
      const d = over + 14;
      mq = el.titleS.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(0)', offset: 0.2 },
        { transform: `translateX(${-d}px)`, offset: 0.8 }, { transform: `translateX(${-d}px)` },
      ], { duration: d * 50 + 2400, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    });
  }

  let toastT = 0;
  function toast(txt) {
    el.toast.textContent = txt;
    el.toast.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.toast.classList.remove('on'), 900);
  }

  function lidClosed() { return flip ? !flip.flipOpened : false; }
  function overlayVisible() {
    const ds = document.getElementById('default-screen');
    return !!(root && ds && ds.classList.contains('show'));
  }

  function loop() {
    clearInterval(tick);
    if (!lidClosed()) return; // outer screen is off while open; don't burn cycles
    render();
    tick = setInterval(render, 1000);
  }

  // ---------- side buttons ----------
  const holds = {};
  function sendCmd(cmd) {
    try { SettingsObserver.setValue([{ name: 'flippod.cmd', value: { cmd, t: Date.now() } }]); } catch (e) { /* */ }
  }
  function onKey(e) {
    if (e.key !== 'AudioVolumeUp' && e.key !== 'AudioVolumeDown') return;
    if (e.type === 'keydown') {
      if (holds[e.key] || e.repeat) return;
      holds[e.key] = { t: Date.now(), ts: e.timeStamp };
      return;
    }
    const h = holds[e.key];
    delete holds[e.key];
    if (!h || Date.now() - h.t < HOLD_MS) return;
    if (!lidClosed() || !overlayVisible() || !np) return;
    if (e.key === 'AudioVolumeUp') {
      sendCmd('next');
      toast('⏭');
      try { AudioVolumeManager.requestVolumeDown(); } catch (err) { /* */ }
    } else {
      sendCmd('toggle');
      toast(np.playing ? '⏸' : '▶');
      try { AudioVolumeManager.requestVolumeUp(); } catch (err) { /* */ }
    }
  }
  function hookKeys() {
    const seen = new WeakSet();
    const attach = () => {
      try {
        const en = Services.wm.getEnumerator(null);
        while (en.hasMoreElements()) {
          const w = en.getNext();
          if (seen.has(w)) continue;
          seen.add(w);
          // dedupe: the same physical press may reach several windows
          w.addEventListener('keydown', dedupe, true);
          w.addEventListener('keyup', dedupe, true);
        }
      } catch (e) { /* not privileged */ }
    };
    let last = '';
    function dedupe(e) {
      const sig = e.type + e.key + Math.round(e.timeStamp);
      if (sig === last) return;
      last = sig;
      onKey(e);
    }
    attach();
    window.addEventListener('keydown', dedupe, true);
    window.addEventListener('keyup', dedupe, true);
    setTimeout(attach, 15000);
  }

  // ---------- startup ----------
  function start() {
    const host = document.getElementById('default-screen');
    if (!host || !window.SettingsObserver) { setTimeout(start, 500); return; }
    build(host);
    const onNP = (v) => { np = v; if (mode === 'np') renderNP(); render(); };
    const onSt = (v) => { st = v; render(); };
    SettingsObserver.observe('flippod.np', null, onNP);
    SettingsObserver.observe('flippod.stats', null, onSt);
    const onLyr = (v) => { lyr = v && v.lines && v.lines.length ? v.lines : null; lyrIdx = -2; root.classList.remove('fp-haslyr'); render(); };
    SettingsObserver.observe('flippod.lyrics', null, onLyr);
    SettingsObserver.getValue('flippod.lyrics').then(onLyr, () => {});
    SettingsObserver.getValue('flippod.np').then(onNP, () => {});
    SettingsObserver.getValue('flippod.stats').then(onSt, () => {});
    if (navigator.getBattery) {
      navigator.getBattery().then((b) => {
        battery = b;
        b.addEventListener('chargingchange', render);
        b.addEventListener('levelchange', render);
        render();
      });
    }
    if (navigator.b2g && navigator.b2g.getFlipManager) {
      navigator.b2g.getFlipManager().then((f) => {
        flip = f;
        f.addEventListener('flipchange', () => { mode = ''; loop(); });
        loop();
      });
    }
    hookKeys();
    window.__flippodOuter = { render, get np() { return np; }, get st() { return st; }, onKey, setMode: (m) => { mode = m; } };
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
