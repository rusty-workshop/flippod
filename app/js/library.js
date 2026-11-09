// In-memory music library built from scanned track records.
import * as db from './db.js';

export const UNKNOWN_ARTIST = 'Unknown Artist';
export const UNKNOWN_ALBUM = 'Unknown Album';

export function sortKey(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/^(the|a|an) (?=\S)/, '');
}

export function letterOf(s) {
  const c = sortKey(s)[0] || '#';
  return /[a-z]/.test(c) ? c.toUpperCase() : '#';
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const albumKeyOf = (t) => `${(t.albumArtist || t.artist || UNKNOWN_ARTIST).toLowerCase()}\u0001${(t.album || UNKNOWN_ALBUM).toLowerCase()}`;

class Library extends EventTarget {
  constructor() {
    super();
    this.tracks = [];
    this.byId = new Map();
    this.songs = [];
    this.artists = [];
    this.albums = [];
    this.genres = [];
    this.folders = null;
    this.filePlaylists = [];
  }

  async load() {
    const tracks = await db.getAll('tracks');
    this.filePlaylists = await db.kvGet('filePlaylists', []);
    this.build(tracks);
  }

  build(tracks) {
    this.tracks = tracks;
    this.byId = new Map(tracks.map((t) => [t.id, t]));
    for (const t of tracks) {
      t._sk = sortKey(t.title);
      t._ak = albumKeyOf(t);
    }
    this.songs = tracks.slice().sort((a, b) => cmp(a._sk, b._sk) || cmp(a.id, b.id));

    const albums = new Map();
    const artists = new Map();
    const genres = new Map();
    for (const t of tracks) {
      let al = albums.get(t._ak);
      if (!al) {
        al = { key: t._ak, title: t.album || UNKNOWN_ALBUM, artist: t.albumArtist || t.artist || UNKNOWN_ARTIST, tracks: [], art: null, year: 0 };
        albums.set(t._ak, al);
      }
      al.tracks.push(t);
      if (t.art && !al.art) al.art = t.art;
      if (t.year && !al.year) al.year = t.year;

      const an = t.artist || UNKNOWN_ARTIST;
      const ak = an.toLowerCase();
      let ar = artists.get(ak);
      if (!ar) { ar = { key: ak, name: an, tracks: [], albums: new Set(), art: null }; artists.set(ak, ar); }
      ar.tracks.push(t);
      ar.albums.add(al);
      if (t.art && !ar.art) ar.art = t.art;

      if (t.genre) {
        const gk = t.genre.toLowerCase();
        let g = genres.get(gk);
        if (!g) { g = { key: gk, name: t.genre, tracks: [] }; genres.set(gk, g); }
        g.tracks.push(t);
      }
    }
    const byTrack = (a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0) || cmp(a._sk, b._sk);
    for (const al of albums.values()) al.tracks.sort(byTrack);
    this.albums = [...albums.values()].sort((a, b) => cmp(sortKey(a.title), sortKey(b.title)) || cmp(sortKey(a.artist), sortKey(b.artist)));
    for (const ar of artists.values()) {
      ar.albums = [...ar.albums].sort((a, b) => (b.year || 0) - (a.year || 0) || cmp(sortKey(a.title), sortKey(b.title)));
      ar.tracks.sort((a, b) => cmp(a._sk, b._sk));
    }
    this.artists = [...artists.values()].sort((a, b) => cmp(sortKey(a.name), sortKey(b.name)));
    for (const g of genres.values()) g.tracks.sort((a, b) => cmp(a._sk, b._sk));
    this.genres = [...genres.values()].sort((a, b) => cmp(sortKey(a.name), sortKey(b.name)));
    this.folders = null; // built lazily
    this.dispatchEvent(new Event('change'));
  }

  folderTree() {
    if (this.folders) return this.folders;
    const root = { name: 'Folders', path: '', dirs: new Map(), tracks: [] };
    for (const t of this.tracks) {
      const rel = t.id.replace(/^\/[^/]+\/music\//i, '');
      const parts = rel.split('/');
      parts.pop();
      let node = root;
      let path = '';
      for (const p of parts) {
        path += '/' + p;
        let n = node.dirs.get(p);
        if (!n) { n = { name: p, path, dirs: new Map(), tracks: [] }; node.dirs.set(p, n); }
        node = n;
      }
      node.tracks.push(t);
    }
    const fin = (n) => {
      n.dirs = [...n.dirs.values()].sort((a, b) => cmp(sortKey(a.name), sortKey(b.name)));
      n.dirs.forEach(fin);
      n.tracks.sort((a, b) => cmp(a.id.toLowerCase(), b.id.toLowerCase()));
    };
    fin(root);
    this.folders = root;
    return root;
  }

  recentlyAdded(n = 100) {
    return this.tracks.slice().sort((a, b) => (b.added || 0) - (a.added || 0) || cmp(a._sk, b._sk)).slice(0, n);
  }
  mostPlayed(n = 50) {
    return this.tracks.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays || (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, n);
  }
  recentlyPlayed(n = 50) {
    return this.tracks.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, n);
  }
  favorites() {
    return this.songs.filter((t) => t.fav);
  }

  get(id) { return this.byId.get(id); }

  async update(t) {
    await db.put('tracks', stripRuntime(t));
  }
}

export function stripRuntime(t) {
  const o = {};
  for (const k in t) if (k[0] !== '_') o[k] = t[k];
  return o;
}

export const library = new Library();

// ---------- album art cache (object URLs, LRU) ----------
const urlCache = new Map();
const pending = new Map();
const MAX_URLS = 1200;

export function artUrl(key, size = 'thumb') {
  if (!key) return Promise.resolve(null);
  const ck = key + '|' + size;
  const hit = urlCache.get(ck);
  if (hit) {
    urlCache.delete(ck);
    urlCache.set(ck, hit);
    return Promise.resolve(hit);
  }
  if (pending.has(ck)) return pending.get(ck);
  const p = db.get('art', key).then((rec) => {
    pending.delete(ck);
    const blob = rec && rec[size];
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(ck, url);
    while (urlCache.size > MAX_URLS) {
      const [k, u] = urlCache.entries().next().value;
      urlCache.delete(k);
      URL.revokeObjectURL(u);
    }
    return url;
  });
  pending.set(ck, p);
  return p;
}

// Load every thumbnail into memory and pre-decode it, so scrolling never waits on IndexedDB.
export async function warmThumbs() {
  const recs = await db.getAll('art');
  const keep = [];
  for (const rec of recs) {
    metaCache.set(rec.key, { color: rec.color, blur: rec.blur });
    const ck = rec.key + '|thumb';
    if (!urlCache.has(ck) && rec.thumb) urlCache.set(ck, URL.createObjectURL(rec.thumb));
    keep.push(urlCache.get(ck));
  }
  // decode in small batches during idle time
  window.__thumbImgs = [];
  for (let i = 0; i < keep.length; i += 8) {
    await new Promise((r) => setTimeout(r, 16));
    await Promise.all(keep.slice(i, i + 8).map((u) => {
      const im = new Image();
      im.src = u;
      window.__thumbImgs.push(im); // keep decoded images alive
      return im.decode().catch(() => {});
    }));
  }
  return recs.length;
}

// Synchronous lookup for already-cached URLs (used to avoid flicker).
export function artUrlSync(key, size = 'thumb') {
  return urlCache.get(key + '|' + size) || null;
}

const metaCache = new Map();
export async function artMeta(key) {
  if (!key) return null;
  if (metaCache.has(key)) return metaCache.get(key);
  const rec = await db.get('art', key);
  const m = rec ? { color: rec.color, blur: rec.blur } : null;
  metaCache.set(key, m);
  return m;
}

// Deterministic placeholder hue for items without art.
export function hueOf(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
