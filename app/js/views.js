// Screens.
import { h, icon, setIcon, ListView, Spring, animate, artBox, fillArt, toast, sheet, prompt, showLetter, click, EASE, EASE_IN_OUT } from './ui.js';
import { library, artUrl, artMeta, letterOf, hueOf } from './library.js';
import { player } from './player.js';
import { settings, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist, renamePlaylist } from './settings.js';
import { scan, isScanning } from './scanner.js';
import { APPS } from './apps.js';

let stack = null;
export function bindStack(s) { stack = s; }

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ids = (tracks) => tracks.map((t) => t.id);

// ---------- generic list page ----------
class ListPage {
  constructor(o) {
    this.o = o;
    this.title = o.title;
    this.el = h('div', 'page');
    this.lv = new ListView({
      kind: o.kind || 'menu',
      rowH: o.rowH || 30,
      twoLine: o.twoLine,
      thumbs: o.thumbs,
      icons: o.icons,
      letters: o.letters,
      emptyText: o.emptyText,
      onEnter: (it, i) => o.onEnter && o.onEnter(it, i, this),
      onFocus: (it, i) => {
        if (o.onFocus) o.onFocus(it, i);
        if (stack && stack.top === this) stack.softkeys();
      },
    });
    this.el.appendChild(this.lv.el);
    this.reload(false);
    this._onTrack = () => this.markPlaying();
    player.addEventListener('track', this._onTrack);
  }
  reload(keep = true) {
    const items = this.o.items();
    this.lv.setItems(items, keep);
    this.markPlaying();
  }
  markPlaying() {
    if (!this.o.songs) return;
    const cur = player.current && player.current.id;
    let changed = false;
    for (const it of this.lv.items) {
      const p = it.id === cur;
      if (!!it.playing !== p) { it.playing = p; changed = true; }
    }
    if (changed) this.lv.refresh();
  }
  mount(height) { this.lv.resize(height); }
  show(back) { if (back && this.o.dynamic) this.reload(true); }
  softkeys() {
    if (this.o.softkeys) return this.o.softkeys(this);
    if (this.o.songs) return { l: 'Shuffle', c: 'Play', r: 'Options' };
    const sel = this.lv && this.lv.selected;
    const can = this.o.options && (!this.o.canOptions || (sel && this.o.canOptions(sel)));
    return { c: 'Select', r: can ? 'Options' : '' };
  }
  onKey(e) {
    if (e.key === 'SoftRight' && this.o.options && this.lv.selected) { this.o.options(this.lv.selected, this); return true; }
    if (e.key === 'SoftLeft' && this.o.songs) {
      const list = this.o.songs();
      if (list.length) { player.playList(ids(list), 0, { shuffle: true, randomStart: true }); openNowPlaying(); }
      return true;
    }
    if (e.key === 'SoftLeft' && this.o.onLeft) { this.o.onLeft(this); return true; }
    return this.lv.onKey(e);
  }
  keyUp() { this.lv.keyUp(); }
  destroy() { player.removeEventListener('track', this._onTrack); }
}

// ---------- items ----------
const songItem = (t, sub) => ({ id: t.id, label: t.title, sub: sub || t.artist || 'Unknown Artist', art: t.art, seed: t.album, sortLabel: t.title });
const albumItem = (al) => ({ id: al.key, label: al.title, sub: al.artist, art: al.art, seed: al.title, chevron: true, sortLabel: al.title, album: al });
const artistItem = (ar) => ({ id: ar.key, label: ar.name, sub: ar.albums.length > 1 ? `${plural(ar.albums.length, 'album')} · ${plural(ar.tracks.length, 'song')}` : plural(ar.tracks.length, 'song'), art: ar.art, seed: ar.name, chevron: true, sortLabel: ar.name, artist: ar });

function songPage(title, getTracks, extra = {}) {
  return new ListPage({
    title, kind: 'song', rowH: 38, twoLine: true, thumbs: true, letters: extra.letters,
    dynamic: extra.dynamic,
    items: () => getTracks().map((t) => songItem(t, extra.sub && extra.sub(t))),
    songs: getTracks,
    emptyText: extra.emptyText || 'No songs',
    onEnter: (it, i) => { player.playList(ids(getTracks()), i, {}); openNowPlaying(); },
    options: (it, page) => songOptions(library.get(it.id), page, extra),
  });
}

export async function songOptions(t, page, extra = {}) {
  if (!t) return;
  const opts = [
    { label: 'Play Next', run: () => { player.playNext([t.id]); toast('Playing next'); } },
    { label: 'Add to Up Next', run: () => { player.enqueue([t.id]); toast('Added to Up Next'); } },
    { label: 'Add to Playlist…', run: () => pickPlaylist([t.id]) },
    { label: t.fav ? 'Unfavorite' : 'Favorite', run: () => { t.fav = !t.fav; library.update(t); toast(t.fav ? 'Added to Favorites' : 'Removed from Favorites'); page && page.o.dynamic && page.reload(true); } },
  ];
  const al = library.albums.find((a) => a.key === t._ak);
  if (al && !extra.inAlbum) opts.push({ label: 'Go to Album', run: () => stack.push(albumPage(al)) });
  const ar = library.artists.find((a) => a.key === (t.artist || 'Unknown Artist').toLowerCase());
  if (ar && !extra.inArtist) opts.push({ label: 'Go to Artist', run: () => stack.push(artistPage(ar)) });
  if (extra.playlistId) opts.push({ label: 'Remove from Playlist', run: () => { removeFromPlaylist(extra.playlistId, t.id); page.reload(true); toast('Removed'); } });
  await sheet(t.title, opts);
}

async function pickPlaylist(trackIds) {
  const pls = playlists();
  const opts = [{ label: 'New Playlist…', id: null }, ...pls.map((p) => ({ label: p.name, right: String(p.items.length), id: p.id }))];
  const c = await sheet('Add to Playlist', opts);
  if (!c) return;
  if (c.id) { addToPlaylist(c.id, trackIds); toast(`Added to ${c.label}`); return; }
  const name = await prompt('New Playlist', '');
  if (!name) return;
  createPlaylist(name, trackIds);
  toast(`Created ${name}`);
}

export function albumPage(al) {
  return songPage(al.title, () => al.tracks, { inAlbum: true, sub: (t) => t.artist === al.artist ? (t.track ? `Track ${t.track}` : al.artist) : t.artist });
}

export function artistPage(ar) {
  return new ListPage({
    title: ar.name, kind: 'album', rowH: 40, twoLine: true, thumbs: true,
    items: () => [
      { id: '__all', label: 'All Songs', sub: plural(ar.tracks.length, 'song'), art: ar.art, seed: ar.name, chevron: true },
      ...ar.albums.map((al) => ({ ...albumItem(al), sub: plural(al.tracks.filter((t) => (t.artist || '').toLowerCase() === ar.key || ar.key === 'unknown artist').length || al.tracks.length, 'song') })),
    ],
    onEnter: (it) => {
      if (it.id === '__all') stack.push(songPage(ar.name, () => ar.tracks, { inArtist: true, sub: (t) => t.album }));
      else stack.push(albumPage(it.album));
    },
    softkeys: () => ({ l: 'Shuffle', c: 'Select' }),
    onLeft: () => { player.playList(ids(ar.tracks), 0, { shuffle: true, randomStart: true }); openNowPlaying(); },
  });
}

function artistsPage() {
  return new ListPage({
    title: 'Artists', kind: 'artist', rowH: 40, twoLine: true, thumbs: true, letters: true, emptyText: 'No artists',
    items: () => library.artists.map(artistItem),
    onEnter: (it) => stack.push(artistPage(it.artist)),
  });
}

function albumsPage() {
  return new ListPage({
    title: 'Albums', kind: 'album', rowH: 40, twoLine: true, thumbs: true, letters: true, emptyText: 'No albums',
    items: () => library.albums.map(albumItem),
    onEnter: (it) => stack.push(albumPage(it.album)),
    softkeys: () => ({ l: 'Shelf', c: 'Select' }),
    onLeft: (page) => stack.push(new ShelfPage(library.albums.indexOf(page.lv.selected.album))),
  });
}

function genresPage() {
  return new ListPage({
    title: 'Genres', letters: true, emptyText: 'No genres in your tags',
    items: () => library.genres.map((g) => ({ id: g.key, label: g.name, right: String(g.tracks.length), chevron: true, g })),
    onEnter: (it) => stack.push(songPage(it.label, () => it.g.tracks, { letters: true })),
  });
}

function folderPage(node) {
  return new ListPage({
    title: node.name, kind: 'menu', letters: true,
    items: () => [
      ...node.dirs.map((d) => ({ id: 'd' + d.path, label: d.name, chevron: true, node: d, icon: 'note' })),
      ...node.tracks.map((t) => ({ id: t.id, label: t.id.slice(t.id.lastIndexOf('/') + 1), track: t })),
    ],
    onEnter: (it) => {
      if (it.node) stack.push(folderPage(it.node));
      else { const list = node.tracks; player.playList(ids(list), list.indexOf(it.track), {}); openNowPlaying(); }
    },
    softkeys: () => ({ l: node.tracks.length ? 'Shuffle' : '', c: 'Select' }),
    onLeft: () => { if (node.tracks.length) { player.playList(ids(node.tracks), 0, { shuffle: true, randomStart: true }); openNowPlaying(); } },
  });
}

function musicPage() {
  const items = () => {
    const l = [
      { id: 'artists', label: 'Artists', chevron: true },
      { id: 'albums', label: 'Albums', chevron: true },
      { id: 'songs', label: 'Songs', chevron: true },
    ];
    if (library.genres.length) l.push({ id: 'genres', label: 'Genres', chevron: true });
    l.push(
      { id: 'folders', label: 'Folders', chevron: true },
      { id: 'recent', label: 'Recently Added', chevron: true },
      { id: 'favs', label: 'Favorites', chevron: true },
      { id: 'most', label: 'Most Played', chevron: true },
    );
    return l;
  };
  return new ListPage({
    title: 'Music', items, dynamic: true,
    onEnter: (it) => {
      switch (it.id) {
        case 'artists': stack.push(artistsPage()); break;
        case 'albums': stack.push(albumsPage()); break;
        case 'songs': stack.push(songPage('Songs', () => library.songs, { letters: true })); break;
        case 'genres': stack.push(genresPage()); break;
        case 'folders': stack.push(folderPage(library.folderTree())); break;
        case 'recent': stack.push(songPage('Recently Added', () => library.recentlyAdded())); break;
        case 'favs': stack.push(songPage('Favorites', () => library.favorites(), { dynamic: true, emptyText: 'Favorite songs from Options' })); break;
        case 'most': stack.push(songPage('Most Played', () => library.mostPlayed(), { dynamic: true, emptyText: 'Play some music first', sub: (t) => `${t.artist} · ${plural(t.plays, 'play')}` })); break;
      }
    },
  });
}

function playlistPage(pl) {
  const user = !pl.file && !pl.smart;
  const get = () => {
    const p = user ? playlists().find((x) => x.id === pl.id) : pl;
    return p ? p.items.map((id) => library.get(id)).filter(Boolean) : [];
  };
  const page = songPage(pl.name, pl.smart || get, { dynamic: true, playlistId: user ? pl.id : null, emptyText: user ? 'Add songs from their Options' : 'Empty' });
  if (user) {
    const base = page.o.options;
    page.o.options = (it, pg) => base(it, pg);
    page.o.softkeys = () => ({ l: 'Shuffle', c: 'Play', r: 'Options' });
  }
  return page;
}

function playlistsPage() {
  return new ListPage({
    title: 'Playlists', dynamic: true, twoLine: false,
    items: () => [
      ...library.filePlaylists.map((p) => ({ id: p.id, label: p.name, right: String(p.items.length), chevron: true, pl: p })),
      ...playlists().map((p) => ({ id: p.id, label: p.name, right: String(p.items.length), chevron: true, pl: p })),
      { id: 'smart:recent', label: 'Recently Played', chevron: true, pl: { name: 'Recently Played', smart: () => library.recentlyPlayed() } },
      { id: 'new', label: 'New Playlist…', dim: true },
    ],
    onEnter: async (it, i, page) => {
      if (it.id === 'new') {
        const name = await prompt('New Playlist', '');
        if (name) { createPlaylist(name); page.reload(true); toast(`Created ${name}`); }
        return;
      }
      stack.push(playlistPage(it.pl));
    },
    canOptions: (it) => it.pl && !it.pl.file && !it.pl.smart,
    options: async (it, page) => {
      if (!it.pl || it.pl.file || it.pl.smart) return;
      await sheet(it.label, [
        { label: 'Rename…', run: async () => { const n = await prompt('Rename Playlist', it.label); if (n) { renamePlaylist(it.id, n); page.reload(true); } } },
        { label: 'Delete', run: () => { deletePlaylist(it.id); page.reload(true); toast('Playlist deleted'); } },
      ]);
    },
  });
}

// ---------- main menu with art panel ----------
export class MainMenu {
  constructor() {
    this.title = 'Flippod';
    this.el = h('div', 'page main');
    this.lv = new ListView({
      kind: 'main', rowH: 30,
      onEnter: (it) => this.enter(it),
      onFocus: (it) => this.focus(it),
    });
    this.panel = h('div', 'panel');
    this.layers = [h('div', 'kb'), h('div', 'kb')];
    for (const l of this.layers) { const img = h('img'); img.alt = ''; l.appendChild(img); this.panel.appendChild(l); }
    this.cap = h('div', 'panel-cap');
    this.capT = h('div', 'pc-t');
    this.capA = h('div', 'pc-a');
    this.cap.append(this.capT, this.capA);
    this.empty = h('div', 'panel-empty');
    this.empty.appendChild(icon('note'));
    this.panel.append(this.empty, this.cap);
    this.el.append(this.lv.el, this.panel);
    this.front = 0;
    this.mode = '';
    this.reload();
    player.addEventListener('track', () => { this.reload(); if (this.mode === 'np') this.showNowPlaying(true); });
    library.addEventListener('change', () => this.reload());
  }

  reload() {
    const items = [
      { id: 'music', label: 'Music', chevron: true },
      { id: 'playlists', label: 'Playlists', chevron: true },
      { id: 'shelf', label: 'Album Shelf' },
      { id: 'shuffle', label: 'Shuffle Songs' },
      { id: 'apps', label: 'Apps', chevron: true },
      { id: 'settings', label: 'Settings', chevron: true },
    ];
    if (player.current) items.push({ id: 'np', label: 'Now Playing', chevron: true });
    this.lv.setItems(items, true);
  }

  mount(height) { this.lv.resize(height); }

  enter(it) {
    switch (it.id) {
      case 'music': stack.push(musicPage()); break;
      case 'playlists': stack.push(playlistsPage()); break;
      case 'shelf': if (library.albums.length) stack.push(new ShelfPage(0)); else toast('No albums yet'); break;
      case 'shuffle':
        if (!library.songs.length) { toast('No songs yet'); break; }
        player.playList(ids(library.songs), 0, { shuffle: true, randomStart: true });
        openNowPlaying();
        break;
      case 'apps': stack.push(appsPage()); break;
      case 'settings': stack.push(settingsPage()); break;
      case 'np': openNowPlaying(); break;
    }
  }

  focus(it) {
    if (!it) return;
    if (it.id === 'np' && player.current) this.showNowPlaying();
    else if (this.mode !== 'slides') this.startSlides();
  }

  async showNowPlaying(force) {
    if (this.mode === 'np' && !force) return;
    this.mode = 'np';
    clearTimeout(this.slideT);
    const t = player.current;
    this.capT.textContent = t.title;
    this.capA.textContent = t.artist;
    this.cap.classList.add('on');
    await this.showArt(t.art, true);
  }

  startSlides() {
    this.mode = 'slides';
    this.cap.classList.remove('on');
    clearTimeout(this.slideT);
    const next = async () => {
      if (this.mode !== 'slides' || !this.visible) return;
      const pool = library.albums.filter((a) => a.art);
      if (pool.length) {
        let pick = pool[Math.floor(Math.random() * pool.length)];
        if (pool.length > 1 && pick.art === this.curArt) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
        await this.showArt(pick.art);
      } else this.showArt(null);
      this.slideT = setTimeout(next, 5200);
    };
    next();
  }

  async showArt(key, still) {
    this.curArt = key;
    this.empty.classList.toggle('on', !key);
    if (!key) { for (const l of this.layers) l.classList.remove('on'); return; }
    const url = await artUrl(key, 'large');
    if (this.curArt !== key || !url) return;
    const back = this.layers[1 - this.front];
    const img = back.firstChild;
    img.src = url;
    try { await img.decode(); } catch (e) { /* ignore */ }
    if (this.curArt !== key) return;
    const front = this.layers[this.front];
    back.classList.add('on');
    front.classList.remove('on');
    this.front = 1 - this.front;
    if (back._kb) back._kb.cancel();
    if (still) { back._kb = null; img.style.transform = 'scale(1.02)'; return; }
    const dx = (Math.random() * 2 - 1) * 14;
    const dy = (Math.random() * 2 - 1) * 10;
    const zoomIn = Math.random() > 0.5;
    back._kb = img.animate([
      { transform: `scale(${zoomIn ? 1.08 : 1.28}) translate(${-dx}px, ${-dy}px)` },
      { transform: `scale(${zoomIn ? 1.28 : 1.08}) translate(${dx}px, ${dy}px)` },
    ], { duration: 7600, easing: 'linear', fill: 'forwards' });
  }

  show() {
    this.visible = true;
    this.mode = '';
    this.reload();
    this.focus(this.lv.selected);
  }
  hide() { this.visible = false; clearTimeout(this.slideT); this.mode = ''; }
  softkeys() { return { c: 'Select', r: player.current ? (player.playing ? 'Pause' : 'Play') : '' }; }
  onKey(e) {
    if (e.key === 'SoftRight' && player.current) { player.toggle(); return true; }
    return this.lv.onKey(e);
  }
  keyUp() { this.lv.keyUp(); }
}

// ---------- Now Playing ----------
let npInstance = null;
export function openNowPlaying() {
  if (!player.current) return;
  if (stack.top === npInstance) return;
  const i = stack.views.indexOf(npInstance);
  if (i >= 0) { stack.views.splice(i, 1); npInstance.el.remove(); }
  npInstance = npInstance || new NowPlaying();
  stack.push(npInstance);
}

const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

class NowPlaying {
  constructor() {
    this.title = 'Now Playing';
    this.el = h('div', 'page np');
    this.bg = h('div', 'np-bg');
    this.bgImgs = [h('img'), h('img')];
    this.bgFront = 0;
    for (const im of this.bgImgs) { im.alt = ''; this.bg.appendChild(im); }
    this.stage = h('div', 'np-stage');
    this.covers = [this._cover(), this._cover()];
    this.coverFront = 0;
    this.covers[1].classList.add('off');
    this.glow = h('div', 'np-glow');
    this.stage.append(this.glow, ...this.covers);
    this.info = h('div', 'np-info');
    this.tTitle = h('div', 'np-title');
    this.tTitleS = h('span');
    this.tTitle.appendChild(this.tTitleS);
    this.tArtist = h('div', 'np-artist');
    this.tAlbum = h('div', 'np-album');
    this.info.append(this.tTitle, this.tArtist, this.tAlbum);
    this.prog = h('div', 'np-prog');
    this.tEl = h('span', 'np-time');
    this.tRem = h('span', 'np-time r');
    this.bar = h('div', 'np-bar');
    this.fill = h('div', 'np-fill');
    this.knob = h('div', 'np-knob');
    this.bar.append(this.fill, this.knob);
    this.prog.append(this.tEl, this.bar, this.tRem);
    this.foot = h('div', 'np-foot');
    this.icShuf = icon('shuffle', 'np-ic');
    this.icRep = icon('repeat', 'np-ic');
    this.icSleep = icon('sleep', 'np-ic');
    this.pos = h('span', 'np-pos');
    const left = h('div', 'np-fl'); left.append(this.icShuf, this.icSleep);
    const right = h('div', 'np-fr'); right.append(this.icRep);
    this.foot.append(left, this.pos, right);
    this.seekHint = h('div', 'np-seek');
    this.el.append(this.bg, this.stage, this.info, this.prog, this.foot, this.seekHint);
    this.scale = new Spring(1, 14);
    this.lastSec = -1;
    this.hold = null;
    this._bind();
    this.render(0);
  }

  _cover() {
    const c = h('div', 'np-cover');
    const a = artBox('np-art');
    const ref = artBox('np-ref');
    c.append(a, ref);
    c._a = a; c._r = ref;
    return c;
  }

  _bind() {
    this.onTrack = (e) => this.render(this.dir || 0);
    this.onState = () => { this.state(); stack && stack.softkeys(); };
    this.onQueue = () => this.flags();
    player.addEventListener('track', this.onTrack);
    player.addEventListener('state', this.onState);
    player.addEventListener('queue', this.onQueue);
    player.addEventListener('sleep', this.onQueue);
    player.addEventListener('time', () => this.tick(true));
    settings.addEventListener('change', (e) => { if (e.detail.key === 'shuffle' || e.detail.key === 'repeat') this.flags(); });
  }

  async render(dir) {
    const t = player.current;
    if (!t) return;
    this.dir = 0;
    // text
    const swapText = (el, txt) => {
      if (el.textContent === txt) return;
      el.textContent = txt;
      if (dir) el.animate([{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
    };
    this._stopMarquee();
    swapText(this.tTitleS, t.title);
    swapText(this.tArtist, t.artist || 'Unknown Artist');
    swapText(this.tAlbum, t.album || '');
    clearTimeout(this.mqT);
    this.mqT = setTimeout(() => this._marquee(), 1400);
    // cover
    const cur = this.covers[this.coverFront];
    if (cur._k === (t.art || t.album) && !dir) {
      // same art, nothing to do
    } else if (dir && this.visible) {
      const nxt = this.covers[1 - this.coverFront];
      this._fillCover(nxt, t);
      nxt.classList.remove('off');
      const d = dir * 150;
      cur.animate([{ transform: 'translateX(0) rotateY(0) scale(1)', opacity: 1 }, { transform: `translateX(${-d}px) rotateY(${dir * 50}deg) scale(.8)`, opacity: 0 }], { duration: 380, easing: EASE, fill: 'forwards' })
        .onfinish = () => cur.classList.add('off');
      nxt.animate([{ transform: `translateX(${d}px) rotateY(${-dir * 50}deg) scale(.8)`, opacity: 0 }, { transform: 'translateX(0) rotateY(0) scale(1)', opacity: 1 }], { duration: 420, easing: EASE });
      this.coverFront = 1 - this.coverFront;
    } else {
      this._fillCover(cur, t);
    }
    // background
    const meta = await artMeta(t.art);
    const back = this.bgImgs[1 - this.bgFront];
    if (meta && meta.blur) {
      back.src = meta.blur;
      back.classList.add('on');
      this.bgImgs[this.bgFront].classList.remove('on');
      this.bgFront = 1 - this.bgFront;
      const [r, g, b] = meta.color || [80, 80, 90];
      this.el.style.setProperty('--np-r', r);
      this.el.style.setProperty('--np-g', g);
      this.el.style.setProperty('--np-b', b);
    } else {
      for (const im of this.bgImgs) im.classList.remove('on');
      const hue = hueOf(t.album || t.title);
      this.el.style.setProperty('--np-r', Math.round(120 + 80 * Math.cos(hue)));
      this.el.style.setProperty('--np-g', 90);
      this.el.style.setProperty('--np-b', Math.round(140 + 80 * Math.sin(hue)));
    }
    this.flags();
    this.state(true);
    this.tick(true);
  }

  _fillCover(c, t) {
    c._k = t.art || t.album;
    fillArt(c._a, t.art, t.album || t.title, 'large');
    fillArt(c._r, t.art, t.album || t.title, 'large');
  }

  _marquee() {
    const over = this.tTitleS.scrollWidth - this.tTitle.clientWidth;
    if (over <= 2) return;
    const dist = over + 20;
    this.tTitle.classList.add('mq');
    this._mqa = this.tTitleS.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(0)', offset: 0.2 },
      { transform: `translateX(${-dist}px)`, offset: 0.8 }, { transform: `translateX(${-dist}px)` },
    ], { duration: dist * 45 + 2400, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  }
  _stopMarquee() { if (this._mqa) { this._mqa.cancel(); this._mqa = null; } this.tTitle.classList.remove('mq'); }

  flags() {
    const s = player.shuffle === 'songs';
    this.icShuf.classList.toggle('on', s);
    const r = player.repeat;
    setIcon(this.icRep, r === 'one' ? 'repeat1' : 'repeat');
    this.icRep.classList.toggle('on', r !== 'off');
    this.icSleep.classList.toggle('on', !!player.sleepAt);
    this.icSleep.classList.toggle('gone', !player.sleepAt);
    this.pos.textContent = player.queue.length ? `${player.index + 1} of ${player.queue.length}` : '';
    stack && stack.top === this && stack.softkeys();
  }

  state(instant) {
    const playing = player.playing;
    this.scale.t = playing ? 1 : 0.86;
    if (instant && !this.visible) this.scale.snap(this.scale.t);
    this.el.classList.toggle('paused', !playing);
    this._loop();
  }

  _loop() {
    if (this._looping || !this.visible) return;
    this._looping = true;
    animate((dt) => {
      if (!this.visible) { this._looping = false; return false; }
      const moving = this.scale.step(dt);
      const s = this.scale.v;
      this.stage.style.transform = `scale(${s.toFixed(4)})`;
      this.tick();
      if (moving || player.playing || this.hold) return true;
      this._looping = false;
      return false;
    });
  }

  tick(force) {
    const d = player.duration;
    const t = this.hold && this.hold.seeking ? this.hold.t : player.time;
    const k = d ? Math.min(1, t / d) : 0;
    this.fill.style.transform = `scaleX(${k.toFixed(4)})`;
    this.knob.style.transform = `translateX(${(k * this.bar.clientWidth).toFixed(1)}px)`;
    const sec = Math.floor(t);
    if (force || sec !== this.lastSec) {
      this.lastSec = sec;
      this.tEl.textContent = fmt(t);
      this.tRem.textContent = d ? '-' + fmt(d - t) : '--:--';
    }
  }

  mount() {}
  show() {
    this.visible = true;
    this.render(0);
    this.scale.snap(player.playing ? 1 : 0.86);
    this._loop();
  }
  hide() { this.visible = false; this._stopMarquee(); }
  softkeys() {
    return { l: player.shuffle === 'songs' ? 'Shuffle: On' : 'Shuffle: Off', c: player.playing ? 'Pause' : 'Play', r: 'Options' };
  }

  onKey(e) {
    switch (e.key) {
      case 'Enter': player.toggle(); click(); return true;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (!e.repeat) { this.hold = { dir, n: 0, seeking: false, t: player.time }; return true; }
        if (!this.hold) return true;
        this.hold.n++;
        if (this.hold.n >= 3) {
          if (!this.hold.seeking) { this.hold.seeking = true; this.el.classList.add('seeking'); this.seekHint.textContent = dir > 0 ? '»' : '«'; }
          const rate = this.hold.n > 25 ? 8 : this.hold.n > 12 ? 4 : 2;
          this.hold.t = Math.max(0, Math.min(player.duration - 1, this.hold.t + dir * rate));
          this._loop();
        }
        return true;
      }
      case 'ArrowUp': stack.push(queuePage()); return true;
      case 'ArrowDown': {
        const t = player.current;
        const al = t && library.albums.find((a) => a.key === t._ak);
        if (al) stack.push(albumPage(al));
        return true;
      }
      case 'SoftLeft': player.setShuffle(player.shuffle === 'songs' ? 'off' : 'songs'); toast(player.shuffle === 'songs' ? 'Shuffle on' : 'Shuffle off'); return true;
      case 'SoftRight': this.options(); return true;
      default:
        if (/^[0-9]$/.test(e.key) && player.duration) {
          player.seek(player.duration * (+e.key / 10));
          this._loop();
          return true;
        }
    }
    return false;
  }

  keyUp(e) {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.hold) {
      const hd = this.hold;
      this.hold = null;
      this.el.classList.remove('seeking');
      if (hd.seeking) player.seek(hd.t);
      else { this.dir = hd.dir; click(); hd.dir > 0 ? player.next() : player.prev(); }
    }
  }

  async options() {
    const t = player.current;
    if (!t) return;
    const rep = { off: 'Off', all: 'All', one: 'One' };
    const nextRep = { off: 'all', all: 'one', one: 'off' };
    const sleepLabel = player.sleepAt ? `${Math.ceil((player.sleepAt - Date.now()) / 60000)} min` : 'Off';
    await sheet('Now Playing', [
      { label: 'Repeat', right: rep[player.repeat], run: () => { player.setRepeat(nextRep[player.repeat]); toast(`Repeat ${rep[player.repeat]}`); } },
      { label: 'Up Next', run: () => stack.push(queuePage()) },
      { label: t.fav ? 'Unfavorite' : 'Favorite', run: () => { t.fav = !t.fav; library.update(t); toast(t.fav ? 'Added to Favorites' : 'Removed from Favorites'); } },
      { label: 'Add to Playlist…', run: () => pickPlaylist([t.id]) },
      { label: 'Go to Album', run: () => { const al = library.albums.find((a) => a.key === t._ak); al && stack.push(albumPage(al)); } },
      { label: 'Go to Artist', run: () => { const ar = library.artists.find((a) => a.key === (t.artist || 'Unknown Artist').toLowerCase()); ar && stack.push(artistPage(ar)); } },
      { label: 'Sleep Timer', right: sleepLabel, run: () => sleepMenu() },
    ]);
  }
}

async function sleepMenu() {
  const c = await sheet('Sleep Timer', [0, 15, 30, 45, 60, 90].map((m) => ({ label: m ? `${m} minutes` : 'Off', m })));
  if (!c) return;
  player.setSleep(c.m);
  toast(c.m ? `Sleeping in ${c.m} min` : 'Sleep timer off');
}

function queuePage() {
  return new ListPage({
    title: 'Up Next', kind: 'song', rowH: 38, twoLine: true, thumbs: true, dynamic: true,
    items: () => player.queue.map((id, i) => {
      const t = library.get(id);
      return t ? { ...songItem(t), id: `${i}:${id}`, playing: i === player.index, dim: i < player.index } : null;
    }).filter(Boolean),
    onEnter: (it) => { player.jump(parseInt(it.id, 10)); stack.pop(); },
    softkeys: () => ({ c: 'Play' }),
  });
}

// ---------- 3D album shelf ----------
class ShelfPage {
  constructor(start = 0) {
    this.title = 'Album Shelf';
    this.albums = library.albums;
    this.el = h('div', 'page shelf');
    this.stageEl = h('div', 'shelf-stage');
    this.capT = h('div', 'shelf-t');
    this.capA = h('div', 'shelf-a');
    const cap = h('div', 'shelf-cap');
    cap.append(this.capT, this.capA);
    this.counter = h('div', 'shelf-n');
    this.floor = h('div', 'shelf-floor');
    this.el.append(this.stageEl, this.floor, cap, this.counter);
    this.pos = { t: Math.max(0, start) };
    this.pool = [];
    for (let i = 0; i < 7; i++) {
      const c = h('div', 'shelf-cov');
      const a = artBox('shelf-art');
      const r = artBox('shelf-ref');
      c.append(a, r);
      c._a = a; c._r = r; c._i = -1;
      this.pool.push(c);
      this.stageEl.appendChild(c);
    }
    this.capIdx = -1;
    this.rep = 0;
    this._warm = new Set();
    this._imgs = [];
    this.warm(this.pos.t);
    this.layout(this.pos.t, this.pos.t);
  }

  // Covers animate with CSS transitions so the compositor does the per-frame work.
  static tf(o) {
    const ao = Math.abs(o);
    const sg = Math.sign(o);
    let x, ry, z;
    if (ao < 1) { x = o * 74; ry = -o * 62; z = (1 - ao) * 46; }
    else { x = sg * (74 + (ao - 1) * 26); ry = -sg * 62; z = 0; }
    return `perspective(380px) translateX(${x.toFixed(1)}px) translateZ(${z.toFixed(1)}px) rotateY(${ry.toFixed(1)}deg)`;
  }

  layout(center, prev) {
    const want = new Set();
    for (let i = center - 3; i <= center + 3; i++) if (i >= 0 && i < this.albums.length) want.add(i);
    const free = this.pool.filter((c) => !want.has(c._i));
    for (const c of this.pool) want.delete(c._i);
    const fresh = [];
    for (const i of want) {
      const c = free.pop();
      c._i = i;
      const al = this.albums[i];
      fillArt(c._a, al.art, al.title, 'large');
      fillArt(c._r, al.art, al.title, 'thumb');
      // start where it would have been relative to the previous centre, without animating
      const o0 = Math.max(-4, Math.min(4, i - prev));
      c.style.transition = 'none';
      c.style.transform = ShelfPage.tf(o0);
      c.style.opacity = Math.abs(o0) > 3.5 ? '0' : '1';
      fresh.push(c);
    }
    for (const c of free) { c._i = -1; c.classList.add('hide'); }
    if (fresh.length) void this.stageEl.offsetWidth; // commit start positions
    for (const c of this.pool) {
      if (c._i < 0) continue;
      c.classList.remove('hide');
      const o = c._i - center;
      const ao = Math.abs(o);
      c.style.transition = '';
      c.style.transform = ShelfPage.tf(o);
      c.style.zIndex = String(100 - ao * 10);
      c.style.opacity = ao > 3 ? '0' : '1';
    }
    if (center !== this.capIdx) {
      this.capIdx = center;
      const al = this.albums[center];
      if (al) {
        this.capT.textContent = al.title;
        this.capA.textContent = al.artist;
        this.counter.textContent = `${center + 1} of ${this.albums.length}`;
        this.capT.parentNode.animate([{ opacity: 0.2, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
      }
    }
  }

  warm(center) {
    for (let k = center - 8; k <= center + 8; k++) {
      const al = this.albums[k];
      if (!al || !al.art || this._warm.has(al.art)) continue;
      this._warm.add(al.art);
      artUrl(al.art, 'large').then((u) => { if (u) { const im = new Image(); im.src = u; im.decode().catch(() => {}); this._imgs.push(im); if (this._imgs.length > 48) this._imgs.shift(); } });
    }
  }

  go(i) {
    i = Math.max(0, Math.min(this.albums.length - 1, i));
    this.warm(i);
    if (i === this.pos.t) return;
    const prev = this.pos.t;
    this.pos.t = i;
    click();
    this.layout(i, prev);
  }

  mount() {}
  show() { this.layout(this.pos.t, this.pos.t); }
  softkeys() { return { l: 'Shuffle', c: 'Open', r: 'Play' }; }
  onKey(e) {
    const cur = this.pos.t;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const d = e.key === 'ArrowRight' ? 1 : -1;
        this.rep = e.repeat ? this.rep + 1 : 0;
        const now = performance.now();
        if (e.repeat && now - (this._lastGo || 0) < 85) return true; // pace held keys
        this._lastGo = now;
        const step = this.rep > 24 ? 3 : this.rep > 10 ? 2 : 1;
        this.go(cur + d * step);
        if (this.rep > 8) showLetter(letterOf(this.albums[this.pos.t].title));
        return true;
      }
      case 'Enter':
      case 'ArrowUp': stack.push(albumPage(this.albums[cur])); return true;
      case 'SoftRight': player.playList(ids(this.albums[cur].tracks), 0, { shuffle: false }); openNowPlaying(); return true;
      case 'SoftLeft': player.playList(ids(this.albums[cur].tracks), 0, { shuffle: true, randomStart: true }); openNowPlaying(); return true;
      default:
        if (/^[2-9]$/.test(e.key)) {
          const L = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' }[e.key];
          const now = Date.now();
          this.t9n = this.t9k === e.key && now - this.t9at < 1100 ? (this.t9n + 1) % L.length : 0;
          this.t9k = e.key; this.t9at = now;
          for (let k = 0; k < L.length; k++) {
            const ch = L[(this.t9n + k) % L.length];
            const i = this.albums.findIndex((a) => letterOf(a.title) === ch);
            if (i >= 0) { showLetter(ch); this.go(i); this.t9n = (this.t9n + k) % L.length; break; }
          }
          return true;
        }
    }
    return false;
  }
}

// ---------- apps ----------
function appsPage() {
  return new ListPage({
    title: 'Apps', kind: 'apps', icons: true, rowH: 34,
    items: () => APPS.map((a) => ({ id: a.manifest, label: a.name, iconUrl: a.icon, letters: true })),
    letters: true,
    onEnter: (it) => {
      try { window.open(it.id, '_blank', 'kind=app,noopener=yes'); } catch (e) { toast('Could not open app'); }
    },
    softkeys: () => ({ c: 'Open' }),
  });
}

// ---------- settings ----------
const THEMES = { classic: 'Classic', midnight: 'Midnight', album: 'Album Color' };
const ACCENTS = { blue: 'Blue', pink: 'Pink', mint: 'Mint', orange: 'Orange', violet: 'Violet', red: 'Red' };
const cycle = (obj, cur) => { const k = Object.keys(obj); return k[(k.indexOf(cur) + 1) % k.length]; };

function settingsPage() {
  const page = new ListPage({
    title: 'Settings', dynamic: true,
    items: () => [
      { id: 'shuffle', label: 'Shuffle', right: player.shuffle === 'songs' ? 'Songs' : 'Off' },
      { id: 'repeat', label: 'Repeat', right: { off: 'Off', all: 'All', one: 'One' }[player.repeat] },
      { id: 'sleep', label: 'Sleep Timer', right: player.sleepAt ? `${Math.ceil((player.sleepAt - Date.now()) / 60000)} min` : 'Off' },
      { id: 'theme', label: 'Theme', right: THEMES[settings.get('theme')] },
      { id: 'accent', label: 'Accent', right: ACCENTS[settings.get('accent')] },
      { id: 'clicker', label: 'Click Sound', right: settings.get('clicker') ? 'On' : 'Off' },
      { id: 'rescan', label: isScanning() ? 'Scanning…' : 'Rescan Library' },
      { id: 'about', label: 'About', chevron: true },
    ],
    onEnter: async (it, i, pg) => {
      switch (it.id) {
        case 'shuffle': player.setShuffle(player.shuffle === 'songs' ? 'off' : 'songs'); break;
        case 'repeat': player.setRepeat({ off: 'all', all: 'one', one: 'off' }[player.repeat]); break;
        case 'sleep': await sleepMenu(); break;
        case 'theme': settings.set('theme', cycle(THEMES, settings.get('theme'))); break;
        case 'accent': settings.set('accent', cycle(ACCENTS, settings.get('accent'))); break;
        case 'clicker': settings.set('clicker', !settings.get('clicker')); click(); break;
        case 'rescan': {
          if (isScanning()) return;
          toast('Scanning…');
          const r = await scan();
          toast(r.added || r.removed ? `${r.added} new · ${r.removed} removed` : 'Library up to date');
          break;
        }
        case 'about': stack.push(aboutPage()); return;
      }
      pg.reload(true);
      const row = pg.lv.pool.find((r) => r._i === i);
      if (row) row._right.animate([{ opacity: 0, transform: 'translateX(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
    },
  });
  return page;
}

function aboutPage() {
  const totalSize = library.tracks.reduce((a, t) => a + (t.size || 0), 0);
  const dur = library.tracks.reduce((a, t) => a + (t.dur || 0), 0);
  return new ListPage({
    title: 'About',
    items: () => [
      { id: 1, label: 'Songs', right: String(library.songs.length) },
      { id: 2, label: 'Albums', right: String(library.albums.length) },
      { id: 3, label: 'Artists', right: String(library.artists.length) },
      { id: 4, label: 'Size', right: `${(totalSize / 1073741824).toFixed(2)} GB` },
      { id: 5, label: 'Known Length', right: dur ? `${Math.round(dur / 3600)} hr` : '—' },
      { id: 6, label: 'Version', right: window.FLIPPOD_VERSION || '' },
      { id: 7, label: 'Music Folder', right: 'music/' },
    ],
    softkeys: () => ({}),
  });
}
