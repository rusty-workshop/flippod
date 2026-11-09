// Scans device storage for music, reads tags, builds album art, keeps IndexedDB in sync.
import * as db from './db.js';
import { readTags } from './tags.js';
import { library, albumKeyOf, stripRuntime } from './library.js';

const AUDIO = /\.(mp3|m4a|m4b|aac|mp4|flac|ogg|oga|opus|wav|webm|3gpp?|amr)$/i;
const IMAGE = /(^|\/)(cover|folder|front|album|albumart[^/]*)\.(jpe?g|png)$/i;
const PLAYLIST = /\.m3u8?$/i;
const LRC = /\.lrc$/i;
const MUSIC_DIR = /^\/[^/]+\/music\//i;

let scanning = null;

export function storage() {
  return navigator.b2g && navigator.b2g.getDeviceStorage ? navigator.b2g.getDeviceStorage('music') : null;
}

async function listFiles() {
  // The 'sdcard' storage also lists playlists and cover images; 'music' only lists media.
  let st = null;
  try { st = navigator.b2g.getDeviceStorage('sdcard'); } catch (e) { st = null; }
  if (!st) st = storage();
  if (!st) throw new Error('No device storage');
  const files = [];
  let iter;
  try { iter = st.enumerate('music', {}).values(); } catch (e) { iter = storage().enumerate('', {}).values(); }
  for await (const f of iter) {
    const n = f.name;
    if (!MUSIC_DIR.test(n)) continue;
    if (/\/\./.test(n)) continue; // hidden files/dirs
    files.push(f);
  }
  return files;
}

export function getFile(path) {
  return new Promise((ok, no) => {
    const r = storage().get(path);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

const idle = () => new Promise((r) => setTimeout(r, 0));

function fromFilename(path) {
  const parts = path.split('/');
  const file = parts.pop();
  const dir = parts[parts.length - 1];
  let base = file.replace(/\.[^.]+$/, '');
  let track = 0;
  const m = /^(\d{1,3})[\s._-]+(.*)$/.exec(base);
  if (m) { track = +m[1]; base = m[2]; }
  let artist = '';
  let title = base;
  const dash = base.indexOf(' - ');
  if (dash > 0) { artist = base.slice(0, dash).trim(); title = base.slice(dash + 3).trim(); }
  const inRoot = /^music$/i.test(dir);
  return { title, artist, track, album: inRoot ? '' : dir };
}

export async function scan(onProgress = () => {}) {
  if (scanning) return scanning;
  scanning = (async () => {
    const t0 = Date.now();
    onProgress({ phase: 'list', done: 0, total: 0 });
    const files = await listFiles();
    const existing = new Map((await db.getAll('tracks')).map((t) => [t.id, t]));
    const artKeys = new Set(await db.getAllKeys('art'));

    const audio = files.filter((f) => AUDIO.test(f.name));
    const images = new Map(); // dir -> File
    const playlists = [];
    const lrcs = new Map(); // "dir/base" (lowercase, no extension) -> .lrc path
    for (const f of files) {
      if (IMAGE.test(f.name)) images.set(f.name.slice(0, f.name.lastIndexOf('/')), f);
      else if (PLAYLIST.test(f.name)) playlists.push(f);
      else if (LRC.test(f.name)) lrcs.set(f.name.replace(/\.lrc$/i, '').toLowerCase(), f.name);
    }

    const seen = new Set();
    const todo = [];
    for (const f of audio) {
      seen.add(f.name);
      const old = existing.get(f.name);
      if (!old || old.size !== f.size || old.mtime !== f.lastModified) todo.push(f);
    }
    const removed = [...existing.keys()].filter((id) => !seen.has(id));

    const out = [];
    let done = 0;
    for (const f of todo) {
      const old = existing.get(f.name);
      let tags = {};
      try { tags = await readTags(f); } catch (e) { tags = {}; }
      const fb = fromFilename(f.name);
      const rec = {
        id: f.name,
        size: f.size,
        mtime: f.lastModified,
        type: f.type,
        title: tags.title || fb.title,
        artist: tags.artist || fb.artist || '',
        albumArtist: tags.albumArtist || '',
        album: tags.album || fb.album || '',
        genre: tags.genre || '',
        track: tags.track || fb.track || 0,
        disc: tags.disc || 0,
        year: tags.year || 0,
        added: old ? old.added : (f.lastModified || Date.now()),
        plays: old ? old.plays || 0 : 0,
        lastPlayed: old ? old.lastPlayed || 0 : 0,
        fav: old ? !!old.fav : false,
        dur: old ? old.dur || 0 : 0,
        art: null,
      };
      const ak = albumKeyOf(rec);
      if (!artKeys.has(ak)) {
        let pic = tags.picture;
        if (!pic) {
          const dir = f.name.slice(0, f.name.lastIndexOf('/'));
          pic = images.get(dir);
        }
        if (pic) {
          try {
            const art = await makeArt(pic);
            art.key = ak;
            await db.put('art', art);
            artKeys.add(ak);
          } catch (e) { /* undecodable image */ }
        }
      }
      out.push(rec);
      existing.set(rec.id, rec);
      done++;
      if (out.length >= 25) { await db.putMany('tracks', out.splice(0)); }
      onProgress({ phase: 'tags', done, total: todo.length });
      if (done % 3 === 0) await idle();
    }
    await db.putMany('tracks', out);
    await db.delMany('tracks', removed);
    for (const id of removed) existing.delete(id);

    // Link art to every track whose album has art, and lyrics files to their songs.
    const fix = [];
    for (const t of existing.values()) {
      const want = artKeys.has(albumKeyOf(t)) ? albumKeyOf(t) : null;
      const lrc = lrcs.get(t.id.replace(/\.[^./]+$/, '').toLowerCase()) || null;
      if (t.art !== want || (t.lrc || null) !== lrc) { t.art = want; t.lrc = lrc; fix.push(stripRuntime(t)); }
    }
    await db.putMany('tracks', fix);

    // Playlist files (.m3u / .m3u8)
    const byBase = new Map();
    for (const id of existing.keys()) byBase.set(id.slice(id.lastIndexOf('/') + 1).toLowerCase(), id);
    const fpl = [];
    for (const f of playlists) {
      try {
        const text = await f.text();
        const dir = f.name.slice(0, f.name.lastIndexOf('/'));
        let name = f.name.slice(f.name.lastIndexOf('/') + 1).replace(/\.m3u8?$/i, '');
        const items = [];
        for (let line of text.split(/\r?\n/)) {
          line = line.trim();
          if (!line) continue;
          if (line.startsWith('#')) {
            const m = /^#(?:EXT)?PLAYLIST:(.*)$/i.exec(line);
            if (m && m[1].trim()) name = m[1].trim();
            continue;
          }
          line = line.replace(/\\/g, '/').replace(/^file:\/\//, '');
          let id = line.startsWith('/') ? line : `${dir}/${line}`;
          id = normalize(id);
          if (!existing.has(id)) id = byBase.get(line.slice(line.lastIndexOf('/') + 1).toLowerCase());
          if (id && existing.has(id)) items.push(id);
        }
        if (items.length) fpl.push({ id: 'file:' + f.name, name, items, file: true });
      } catch (e) { /* skip unreadable playlist */ }
    }
    await db.kvSet('filePlaylists', fpl);
    library.filePlaylists = fpl;

    library.build([...existing.values()]);
    onProgress({ phase: 'done', done: todo.length, total: todo.length, removed: removed.length, ms: Date.now() - t0 });
    return { added: todo.length, removed: removed.length, total: existing.size };
  })();
  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

export const isScanning = () => !!scanning;

function normalize(p) {
  const out = [];
  for (const s of p.split('/')) {
    if (s === '..') out.pop();
    else if (s !== '.' && s !== '') out.push(s);
  }
  return '/' + out.join('/');
}

// ---------- art processing ----------
async function makeArt(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    const large = await scaled(bmp, 240, 0.86);
    const thumb = await scaled(bmp, 72, 0.8);
    const c = document.createElement('canvas');
    c.width = 12; c.height = 12;
    const x = c.getContext('2d');
    crop(x, bmp, 12);
    const px = x.getImageData(0, 0, 12, 12).data;
    const blur = c.toDataURL('image/png');
    return { thumb, large, color: dominant(px), blur };
  } finally {
    bmp.close && bmp.close();
  }
}

function crop(ctx, bmp, size) {
  const s = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - s) / 2;
  const sy = (bmp.height - s) / 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, s, s, 0, 0, size, size);
}

function scaled(bmp, size, q) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  crop(c.getContext('2d'), bmp, size);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
}

// Pick a pleasant accent colour: average of the most saturated pixels.
function dominant(px) {
  const cands = [];
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const v = mx / 255;
    cands.push({ r, g, b, score: sat * 0.7 + v * 0.3 - (v < 0.15 ? 1 : 0) });
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands.slice(0, Math.max(4, cands.length >> 3));
  const avg = top.reduce((a, c) => [a[0] + c.r, a[1] + c.g, a[2] + c.b], [0, 0, 0]).map((v) => Math.round(v / top.length));
  return avg;
}
