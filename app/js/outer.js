// Bridge to the outer (lid) display. The patched system outer page reads `flippod.np` and
// `flippod.stats` from the KaiOS settings service and writes `flippod.cmd` for side-button actions.
import { player } from './player.js';
import { artUrl } from './library.js';
import * as stats from './stats.js';
import { lyricsFor } from './lyrics.js';

const SO = window.SettingsObserver;
let artKey = null;
let artData = null;
let lastCmd = Date.now();
let pubT = 0;
let pausedAt = 0;
let wasPlaying = false;

async function art128(key) {
  if (!key) return null;
  if (key === artKey) return artData;
  const url = await artUrl(key, 'large');
  if (!url) return null;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { return null; }
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  c.getContext('2d').drawImage(img, 0, 0, 128, 128);
  artKey = key;
  artData = c.toDataURL('image/jpeg', 0.82);
  return artData;
}

function set(name, value) {
  try { SO.setValue([{ name, value }]); } catch (e) { /* settings unavailable */ }
}

async function publishNow() {
  const t = player.current;
  if (!t) { set('flippod.np', null); return; }
  // pausedAt marks a real play->pause transition (so the lid shows a just-paused track briefly);
  // a track restored paused after boot gets 0, so the lid shows the clock.
  if (player.playing) { wasPlaying = true; pausedAt = 0; }
  else if (wasPlaying) { wasPlaying = false; pausedAt = Date.now(); }
  set('flippod.np', {
    title: t.title,
    artist: t.artist || 'Unknown Artist',
    playing: player.playing,
    pausedAt,
    pos: player.time,
    dur: player.duration,
    at: Date.now(),
    art: await art128(t.art),
  });
}

function publish() {
  clearTimeout(pubT);
  pubT = setTimeout(publishNow, 150);
}

function publishStats() { set('flippod.stats', stats.summary()); }

let lyrFor = null;
async function publishLyrics() {
  const t = player.current;
  const id = t ? t.id : null;
  if (id === lyrFor) return;
  lyrFor = id;
  const lines = t ? await lyricsFor(t) : null;
  if (lyrFor !== id) return;
  set('flippod.lyrics', lines ? { id, lines: lines.map((l) => [Math.round(l.t * 100) / 100, l.text]) } : null);
}

export async function initOuter() {
  if (!SO) return;
  try {
    if (window.libSession && window.libSession.initService) {
      await Promise.race([window.libSession.initService(['settingsService']), new Promise((r) => setTimeout(r, 8000))]);
    }
    if (!SO.initiated && SO.init) SO.init();
  } catch (e) { /* fall through; setValue will queue until connected */ }
  player.addEventListener('track', publish);
  player.addEventListener('track', publishLyrics);
  player.addEventListener('state', publish);
  player.addEventListener('time', publish);
  player.addEventListener('counted', publishStats);
  setInterval(() => { if (player.playing) publishStats(); }, 60000);
  publishStats();
  publish();
  publishLyrics();
  SO.observe('flippod.cmd', null, (v) => {
    if (!v || !v.t || v.t <= lastCmd || Date.now() - v.t > 15000) return;
    lastCmd = v.t;
    if (v.cmd === 'next') player.next();
    else if (v.cmd === 'prev') player.prev();
    else if (v.cmd === 'toggle') player.toggle();
  });
}
