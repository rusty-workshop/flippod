import { Stack, modal, h, icon, setIcon, EASE } from './ui.js';
import { library, warmThumbs } from './library.js';
import { scan, storage } from './scanner.js';
import { player } from './player.js';
import { settings } from './settings.js';
import { MainMenu, bindStack, openNowPlaying } from './views.js';
import { initOuter } from './outer.js';
import * as BT from './bt.js';
import { initAvrcp } from './avrcp.js';

window.FLIPPOD_VERSION = '1.0.0';
const HOME = /^launcher\./.test(location.hostname);
// The KaiOS system app treats a homescreen URL with no hash (or #mainView) as the stock
// launcher's main view and hijacks Up (Instant Settings), SoftLeft (notifications) and
// long-Back (sleep menu). Any other hash tells it to leave our keys alone.
if (HOME && location.hash !== '#flippod') location.hash = 'flippod';
const app = document.getElementById('app');

// ---------- theme ----------
function applyTheme() {
  const theme = settings.get('theme');
  app.dataset.theme = theme;
  app.dataset.accent = settings.get('accent');
  document.documentElement.dataset.theme = theme;
}
applyTheme();
settings.addEventListener('change', (e) => {
  if (e.detail.key === 'theme' || e.detail.key === 'accent') {
    app.classList.add('theming');
    applyTheme();
    setTimeout(() => app.classList.remove('theming'), 450);
  }
  if (e.detail.key === 'theme') albumTint();
});

// Album Color theme tints the UI with the current cover's colour.
import { artMeta } from './library.js';
async function albumTint() {
  if (settings.get('theme') !== 'album') { app.style.removeProperty('--tint'); return; }
  const t = player.current;
  const m = t && (await artMeta(t.art));
  const c = (m && m.color) || [70, 110, 220];
  app.style.setProperty('--tint', `${c[0]}, ${c[1]}, ${c[2]}`);
}
player.addEventListener('track', albumTint);

// ---------- header ----------
const stack = new Stack(app);
bindStack(stack);
const hdrPlay = icon('play', 'hdr-ic');
const eq = h('div', 'eq');
for (let i = 0; i < 3; i++) eq.appendChild(h('i'));
app.querySelector('.hdr-l').append(eq, hdrPlay);
const hdrShuf = icon('shuffle', 'hdr-ic hdr-shuf');
app.querySelector('.hdr-r').appendChild(hdrShuf);
const shufState = () => hdrShuf.classList.toggle('on', settings.get('shuffle') === 'songs');
shufState();
settings.addEventListener('change', (e) => { if (e.detail.key === 'shuffle') shufState(); });
function hdrState() {
  const has = !!player.current;
  const playing = player.playing;
  eq.classList.toggle('on', has && playing);
  hdrPlay.classList.toggle('on', has && !playing);
  setIcon(hdrPlay, 'pause');
  stack.softkeys();
}
player.addEventListener('state', hdrState);
player.addEventListener('track', hdrState);

// ---------- keys ----------
let lastEnter = 0;
window.addEventListener('keydown', (e) => {
  // OK key: ignore auto-repeat and switch bounce (a second press within 150 ms).
  if (e.key === 'Enter') {
    const now = performance.now();
    if (e.repeat || now - lastEnter < 150) { e.preventDefault(); return; }
    lastEnter = now;
  }
  if (modal.top) {
    const r = modal.top.onKey(e);
    if (r === 'pass') return;
    if (r) e.preventDefault();
    return;
  }
  const v = stack.top;
  if (v && v.onKey && v.onKey(e)) { e.preventDefault(); return; }
  switch (e.key) {
    case 'Backspace':
      if (stack.depth > 1) { e.preventDefault(); stack.pop(); }
      else if (HOME) e.preventDefault();
      else { e.preventDefault(); window.close(); }
      break;
    case 'EndCall':
    case 'Home':
      if (HOME && stack.depth > 1) { e.preventDefault(); stack.popToRoot(); }
      break;
    case 'Call':
      if (player.current) { e.preventDefault(); openNowPlaying(); }
      break;
    case 'MediaPlayPause': player.toggle(); break;
    case 'MediaTrackNext': player.next(); break;
    case 'MediaTrackPrevious': player.prev(); break;
  }
});
window.addEventListener('keyup', (e) => {
  if (modal.top) { modal.top.keyUp && modal.top.keyUp(e); return; }
  const v = stack.top;
  v && v.keyUp && v.keyUp(e);
});

// When we are the homescreen and become visible again, the system expects a sane state.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && stack.top && stack.top.show) stack.top.show(true);
});

// ---------- scanning overlay (first run only) ----------
function scanOverlay() {
  const ov = h('div', 'scan');
  const ring = h('div', 'scan-ring');
  const fill = h('div', 'scan-fill');
  const lbl = h('div', 'scan-lbl', 'Finding music…');
  const sub = h('div', 'scan-sub', '');
  const bar = h('div', 'scan-bar');
  bar.appendChild(fill);
  ring.appendChild(icon('note'));
  ov.append(ring, lbl, bar, sub);
  app.appendChild(ov);
  ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  return {
    update(p) {
      if (p.phase === 'tags' && p.total) {
        lbl.textContent = 'Building your library';
        sub.textContent = `${p.done} of ${p.total}`;
        fill.style.transform = `scaleX(${(p.done / p.total).toFixed(3)})`;
      }
    },
    done() {
      const a = ov.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.06)' }], { duration: 380, easing: EASE, fill: 'forwards' });
      a.onfinish = () => ov.remove();
    },
  };
}

// ---------- boot ----------
async function boot() {
  const splash = document.getElementById('splash');
  await library.load();
  const main = new MainMenu();
  stack.push(main, false);
  player.restore();
  hdrState();
  albumTint();
  if (splash) {
    const a = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: EASE, fill: 'forwards' });
    a.onfinish = () => splash.remove();
  }
  warmThumbs();
  const first = !library.tracks.length;
  const ov = first ? scanOverlay() : null;
  try {
    await scan((p) => ov && ov.update(p));
  } catch (e) {
    console.error('scan failed', e);
  }
  if (ov) ov.done();
  warmThumbs();
  try { initOuter(); } catch (e) { console.error('outer bridge', e); }
  BT.init();
  initAvrcp().catch(() => {});
  if (!player.queue.length) player.restore();
  // watch for new music
  const st = storage();
  if (st && st.addEventListener) {
    let t = 0;
    st.addEventListener('change', (ev) => {
      if (!/\/music\//i.test(ev.path || '')) return;
      clearTimeout(t);
      t = setTimeout(() => scan(), 4000);
    });
  }
}

boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.__fp = { library, player, stack, settings, scan };
