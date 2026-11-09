// ListenBrainz scrobbling with an offline queue, plus "created for you" recommendations.
// A play counts once half the song (or 4 minutes) has been heard, per ListenBrainz guidelines.
import { player } from './player.js';
import { settings } from './settings.js';

const API = 'https://api.listenbrainz.org/1';
const QKEY = 'fp.lbqueue';
const CLIENT = { media_player: 'Flippod', submission_client: 'Flippod', submission_client_version: '1.0' };

export const lb = new EventTarget();
const emit = () => lb.dispatchEvent(new Event('change'));

export const token = () => settings.get('lbToken') || '';
export const user = () => settings.get('lbUser') || '';
export const enabled = () => !!token();

let queue = [];
try { queue = JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { queue = []; }
const saveQ = () => { try { localStorage.setItem(QKEY, JSON.stringify(queue.slice(-5000))); } catch (e) { /* full */ } emit(); };
export const queued = () => queue.length;
export let lastError = '';
export let lastSent = 0;

async function call(path, body) {
  const opts = { headers: { Authorization: `Token ${token()}` } };
  if (body) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(API + path, opts);
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

const meta = (t, dur) => ({
  artist_name: t.artist || 'Unknown Artist',
  track_name: t.title,
  ...(t.album ? { release_name: t.album } : {}),
  additional_info: { ...CLIENT, ...(dur ? { duration_ms: Math.round(dur * 1000) } : {}) },
});

// ---------- listening ----------
let cur = null; // {id, heard, start, done}

function onTrack() {
  const t = player.current;
  cur = t ? { id: t.id, heard: 0, pos: player.time, start: Math.floor(Date.now() / 1000), done: false } : null;
  if (t && player.playing) nowPlaying();
}

function tick() {
  if (!cur) return;
  if (!player.playing) { cur.pos = player.time; return; }
  const t = player.current;
  if (!t || t.id !== cur.id) { onTrack(); return; }
  // count real progress through the song (timers are throttled while the lid is shut; seeks are ignored)
  const p = player.time;
  const d = p - cur.pos;
  if (d > 0 && d < 90) cur.heard += d;
  cur.pos = p;
  const dur = player.duration;
  if (!cur.done && dur > 30 && cur.heard >= Math.min(240, dur / 2)) {
    cur.done = true;
    queue.push({ listened_at: cur.start, track_metadata: meta(t, dur) });
    saveQ();
    flushSoon();
  }
}

let npT = 0;
function nowPlaying() {
  if (!enabled() || !navigator.onLine) return;
  clearTimeout(npT);
  npT = setTimeout(() => {
    const t = player.current;
    if (!t || !player.playing) return;
    call('/submit-listens', { listen_type: 'playing_now', payload: [{ track_metadata: meta(t, player.duration) }] }).catch(() => {});
  }, 3000);
}

// ---------- sending ----------
let flushing = false;
let flushT = 0;
function flushSoon() { clearTimeout(flushT); flushT = setTimeout(flush, 2000); }

export async function flush() {
  if (flushing || !enabled() || !queue.length) return 0;
  if (!navigator.onLine) { lastError = 'Offline'; emit(); return 0; }
  flushing = true;
  let sent = 0;
  try {
    while (queue.length) {
      const batch = queue.slice(0, 100);
      await call('/submit-listens', { listen_type: batch.length === 1 ? 'single' : 'import', payload: batch });
      queue.splice(0, batch.length);
      sent += batch.length;
      saveQ();
    }
    lastError = '';
    lastSent = Date.now();
  } catch (e) {
    lastError = e.status === 401 ? 'Token rejected' : e.status ? `Server said ${e.message}` : 'Network error';
    if (e.status === 400) { queue.shift(); saveQ(); } // drop a listen the server refuses, keep the rest
  } finally {
    flushing = false;
    emit();
  }
  return sent;
}

// ---------- account ----------
export async function validate() {
  const r = await call('/validate-token');
  if (!r.valid) throw new Error('invalid token');
  settings.set('lbUser', r.user_name);
  emit();
  return r.user_name;
}

export function disconnect() {
  settings.set('lbToken', '');
  settings.set('lbUser', '');
  emit();
}

// ---------- recommendations ----------
export async function recommendationPlaylists() {
  const r = await call(`/user/${encodeURIComponent(user())}/playlists/createdfor?count=25`);
  return (r.playlists || []).map((p) => {
    const pl = p.playlist;
    return { id: pl.identifier.split('/').filter(Boolean).pop(), title: pl.title, date: pl.date };
  });
}

export async function playlistTracks(id) {
  const r = await call(`/playlist/${id}`);
  return (r.playlist.track || []).map((t) => ({ title: t.title, artist: t.creator, album: t.album || '', dur: t.duration ? Math.round(t.duration / 1000) : 0 }));
}

export function initScrobble() {
  player.addEventListener('track', onTrack);
  player.addEventListener('state', () => { if (player.playing) { if (!cur) onTrack(); nowPlaying(); } });
  setInterval(tick, 1000);
  window.addEventListener('online', () => flushSoon());
  setInterval(() => { if (queue.length) flush(); }, 120000);
  onTrack();
  flushSoon();
}
