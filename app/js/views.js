// Screens.
import { h, icon, setIcon, clearAnims, ListView, Spring, animate, artBox, fillArt, toast, sheet, prompt, showLetter, click, EASE, EASE_IN_OUT } from './ui.js';
import { library, artUrl, artMeta, letterOf, hueOf } from './library.js';
import { player } from './player.js';
import { settings, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist, renamePlaylist } from './settings.js';
import { scan, isScanning } from './scanner.js';
import { APPS } from './apps.js';
import { lyricsFor, lineAt } from './lyrics.js';
import * as BT from './bt.js';
import * as LB from './scrobble.js';
import * as WIFI from './wifi.js';

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
  show(back) { if (back && this.o.dynamic) this.reload(true); if (this.o.onShow) this.o.onShow(this, back); }
  hide() { if (this.o.onHide) this.o.onHide(this); }
  softkeys() {
    if (this.o.softkeys) return this.o.softkeys(this);
    if (this.o.songs) return { l: 'Shuffle', c: 'Play', r: 'Options' };
    const sel = this.lv && this.lv.selected;
    const can = this.o.options && (!this.o.canOptions || (sel && this.o.canOptions(sel)));
    return { c: 'Select', r: can ? 'Options' : '' };
  }
  onKey(e) {
    if (e.key === 'SoftRight' && this.o.onRight) { this.o.onRight(this); return true; }
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
  destroy() { player.removeEventListener('track', this._onTrack); if (this.o.onDestroy) this.o.onDestroy(this); }
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
      { id: 'search', label: 'Search', chevron: true },
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
      case 'search': openSearch(); break;
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
    this.lyr = h('div', 'np-lyr');
    this.lyrIn = h('div', 'np-lyr-in');
    this.lyr.appendChild(this.lyrIn);
    this.icLrc = h('span', 'np-lrc gone', 'LRC');
    left.appendChild(this.icLrc);
    this.lines = null;
    this.lineIdx = -2;
    this.el.append(this.bg, this.stage, this.info, this.lyr, this.prog, this.foot, this.seekHint);
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
      clearAnims(cur);
      clearAnims(nxt);
      this._fillCover(nxt, t);
      nxt.classList.remove('off');
      const d = dir * 150;
      const out = cur.animate([{ transform: 'translateX(0) rotateY(0) scale(1)', opacity: 1 }, { transform: `translateX(${-d}px) rotateY(${dir * 50}deg) scale(.8)`, opacity: 0 }], { duration: 380, easing: EASE, fill: 'forwards' });
      out.onfinish = () => { if (this.covers[this.coverFront] !== cur) cur.classList.add('off'); out.cancel(); };
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
    this._loadLyrics(t);
  }

  async _loadLyrics(t) {
    if (this._lyrFor === t.id) return;
    this._lyrFor = t.id;
    this.lines = null;
    this._applyLyrMode();
    const lines = await lyricsFor(t);
    if (!player.current || player.current.id !== t.id) return;
    this.lines = lines;
    this.lyrIn.textContent = '';
    this.lyrIn.style.transform = '';
    this.lineEls = (lines || []).map((l) => {
      const d = h('div', 'l', l.text || '\u266A');
      this.lyrIn.appendChild(d);
      return d;
    });
    this.lineIdx = -2;
    this._applyLyrMode();
    this.flags();
    this.tick(true);
  }

  _applyLyrMode() {
    this.el.classList.toggle('lyr-on', !!(settings.get('lyricsView') && this.lines));
  }

  _lyricsTick(t) {
    if (!this.lines || !this.el.classList.contains('lyr-on')) return;
    const i = lineAt(this.lines, t);
    if (i === this.lineIdx) return;
    const prev = this.lineEls[this.lineIdx];
    if (prev) prev.classList.remove('on');
    this.lineIdx = i;
    const cur = this.lineEls[Math.max(0, i)];
    if (i >= 0 && cur) cur.classList.add('on');
    if (cur) {
      const y = cur.offsetTop + cur.offsetHeight / 2 - this.lyr.clientHeight * 0.4;
      this.lyrIn.style.transform = `translateY(${-Math.max(0, y).toFixed(0)}px)`;
    }
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
    this.icLrc.classList.toggle('gone', !this.lines);
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
    this._lyricsTick(t);
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
        if (!this.lines) { toast(player.current && player.current.lrc ? 'Lyrics not synced' : 'No lyrics for this song'); return true; }
        settings.set('lyricsView', !settings.get('lyricsView'));
        this.lineIdx = -2;
        this._applyLyrMode();
        this.tick(true);
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
      { id: 'wifi', label: 'Wi-Fi', right: wifiStateLabel(), chevron: true },
      { id: 'bt', label: 'Bluetooth', right: btStateLabel(), chevron: true },
      { id: 'lb', label: 'ListenBrainz', right: LB.enabled() ? 'On' : 'Off', chevron: true },
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
        case 'bt': stack.push(btPage()); return;
        case 'wifi': stack.push(wifiPage()); return;
        case 'lb': stack.push(lbPage()); return;
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

// ---------- bluetooth ----------
function btStateLabel() {
  if (!BT.available()) return '';
  return { enabled: 'On', disabled: 'Off', enabling: 'Turning on…', disabling: 'Turning off…' }[BT.state()] || '';
}

// Re-render a page whenever Bluetooth state changes, for as long as the page exists.
function watchBt(page) {
  const fn = () => { page.reload(true); stack.softkeys(); };
  BT.bt.addEventListener('change', fn);
  page.o.onDestroy = () => BT.bt.removeEventListener('change', fn);
}

function btPage() {
  const page = new ListPage({
    title: 'Bluetooth', twoLine: false,
    items: () => {
      if (!BT.available()) return [{ id: 'na', label: 'Bluetooth unavailable', dim: true }];
      const l = [{ id: 'toggle', label: 'Bluetooth', right: btStateLabel() }];
      if (!BT.isOn()) return l;
      for (const d of BT.paired().filter(BT.isConnected)) l.push({ id: 'c:' + d.address, label: BT.label(d), right: 'Connected', dev: d });
      l.push({ id: 'pair', label: 'Pair New Device', chevron: true });
      l.push({ id: 'paired', label: 'Paired Devices', right: String(BT.paired().length), chevron: true });
      return l;
    },
    onEnter: async (it) => {
      if (it.id === 'toggle') {
        const on = !BT.isOn();
        toast(on ? 'Turning Bluetooth on…' : 'Turning Bluetooth off…');
        try { await BT.setEnabled(on); } catch (e) { toast('Could not change Bluetooth'); }
      } else if (it.id === 'pair') stack.push(btPairPage());
      else if (it.id === 'paired') stack.push(btPairedPage());
      else if (it.dev) btDeviceSheet(it.dev);
    },
    softkeys: () => ({ c: 'Select' }),
  });
  BT.init().then(() => { BT.refreshConnected(); page.reload(true); });
  watchBt(page);
  return page;
}

async function btDeviceSheet(d) {
  const conn = BT.isConnected(d);
  await sheet(BT.label(d), [
    conn
      ? { label: 'Disconnect', run: () => btRun(() => BT.disconnect(d), 'Disconnected', 'Could not disconnect') }
      : { label: 'Connect', run: () => btRun(() => BT.connect(d), `Connected to ${BT.label(d)}`, 'Could not connect', 'Connecting…') },
    { label: 'Forget Device', run: () => btRun(() => BT.forget(d), 'Device forgotten', 'Could not forget device') },
  ]);
}

async function btRun(fn, ok, fail, pending) {
  if (pending) toast(pending);
  try { await fn(); toast(ok); } catch (e) { toast(fail); }
}

function btPairPage() {
  const found = new Map();
  let searching = false;
  const page = new ListPage({
    title: 'Pair New Device', kind: 'song', rowH: 38, twoLine: true,
    emptyText: 'Searching for devices…',
    items: () => [...found.values()]
      .sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || BT.label(a).localeCompare(BT.label(b)))
      .map((d) => ({ id: d.address, label: BT.label(d), sub: d.paired ? `${BT.kind(d)} · Paired` : BT.kind(d), dev: d })),
    onEnter: async (it) => {
      const d = it.dev;
      if (d.paired) { btRun(() => BT.connect(d), `Connected to ${BT.label(d)}`, 'Could not connect', 'Connecting…'); return; }
      toast(`Pairing with ${BT.label(d)}…`);
      try {
        await BT.pair(d);
        toast(BT.isConnected(d) ? `Connected to ${BT.label(d)}` : `Paired with ${BT.label(d)}`);
        stack.pop();
      } catch (e) {
        toast('Pairing failed');
        scan();
      }
    },
    softkeys: () => ({ c: 'Pair', r: searching ? 'Searching…' : 'Rescan' }),
    onRight: () => { if (!searching) scan(); },
    onShow: () => scan(),
    onHide: () => BT.stopDiscovery(),
  });
  const end = () => {
    searching = false;
    page.lv.o.emptyText = 'No devices found. Press Rescan.';
    page.reload(true);
    stack.top === page && stack.softkeys();
  };
  async function scan() {
    if (!BT.isOn()) { toast('Turn Bluetooth on first'); return; }
    found.clear();
    searching = true;
    page.lv.o.emptyText = 'Searching for devices…';
    page.reload(false);
    stack.top === page && stack.softkeys();
    let reloadT = 0;
    try {
      await BT.discover((d) => {
        if (!d || !d.address) return;
        found.set(d.address, d);
        clearTimeout(reloadT);
        reloadT = setTimeout(() => page.reload(true), 250);
      });
    } catch (e) { toast('Could not search'); end(); }
  }
  BT.bt.addEventListener('discoveryend', end);
  page.o.onDestroy = () => { BT.bt.removeEventListener('discoveryend', end); BT.stopDiscovery(); };
  return page;
}

function btPairedPage() {
  const page = new ListPage({
    title: 'Paired Devices', kind: 'song', rowH: 38, twoLine: true,
    emptyText: 'No paired devices yet',
    items: () => BT.paired()
      .map((d) => ({ d, c: BT.isConnected(d) }))
      .sort((a, b) => (b.c - a.c) || BT.label(a.d).localeCompare(BT.label(b.d)))
      .map(({ d, c }) => ({ id: d.address, label: BT.label(d), sub: `${BT.kind(d)} · ${c ? 'Connected' : 'Not connected'}`, dev: d, playing: c })),
    onEnter: (it) => {
      const d = it.dev;
      if (BT.isConnected(d)) btRun(() => BT.disconnect(d), 'Disconnected', 'Could not disconnect');
      else btRun(() => BT.connect(d), `Connected to ${BT.label(d)}`, 'Could not connect', 'Connecting…');
    },
    options: (it) => btDeviceSheet(it.dev),
    softkeys: (pg) => {
      const sel = pg.lv && pg.lv.selected;
      if (!sel) return {};
      return { c: BT.isConnected(sel.dev) ? 'Disconnect' : 'Connect', r: 'Options' };
    },
  });
  watchBt(page);
  return page;
}

// ---------- ListenBrainz ----------
function lbPage() {
  const page = new ListPage({
    title: 'ListenBrainz', kind: 'song', rowH: 38, twoLine: true,
    items: () => {
      if (!LB.enabled()) {
        return [
          { id: 'na', label: 'Not set up', sub: 'Plays are saved and sent later' },
          { id: 'how', label: 'Set up from your computer', sub: 'Run tools/listenbrainz-login', dim: true },
          { id: 'q', label: 'Waiting to send', sub: `${LB.queued()} play${LB.queued() === 1 ? '' : 's'}` },
        ];
      }
      const n = LB.queued();
      return [
        { id: 'acct', label: LB.user() || 'Connected', sub: 'Scrobbling to ListenBrainz' },
        { id: 'q', label: 'Waiting to send', sub: `${n} play${n === 1 ? '' : 's'}${LB.lastError ? ' · ' + LB.lastError : LB.lastSent ? ' · all caught up' : ''}` },
        { id: 'send', label: 'Send now', sub: navigator.onLine ? 'Upload queued plays' : 'Needs Wi-Fi' },
        { id: 'recs', label: 'Recommendations', sub: 'Playlists made for you', chevron: true },
        { id: 'wish', label: 'Wishlist', sub: `${wishlist().length} song${wishlist().length === 1 ? '' : 's'} to download`, chevron: true },
        { id: 'off', label: 'Disconnect', sub: 'Forget the token on this phone', dim: true },
      ];
    },
    onEnter: async (it, i, pg) => {
      switch (it.id) {
        case 'send': {
          if (!navigator.onLine) { toast('Connect to Wi-Fi first'); return; }
          toast('Sending…');
          const n = await LB.flush();
          toast(LB.lastError ? LB.lastError : n ? `Sent ${n} play${n === 1 ? '' : 's'}` : 'Nothing to send');
          break;
        }
        case 'wish': stack.push(wishlistPage()); break;
        case 'recs':
          if (!navigator.onLine) { toast('Connect to Wi-Fi first'); return; }
          stack.push(lbRecsPage());
          break;
        case 'off': {
          const c = await sheet('Disconnect ListenBrainz?', [{ label: 'Disconnect', ok: true }, { label: 'Cancel' }]);
          if (c && c.ok) { LB.disconnect(); toast('Disconnected'); }
          break;
        }
        case 'how': toast('See the README for setup'); break;
      }
    },
    softkeys: () => ({ c: 'Select' }),
  });
  const fn = () => { page.reload(true); };
  LB.lb.addEventListener('change', fn);
  page.o.onDestroy = () => LB.lb.removeEventListener('change', fn);
  return page;
}

function lbRecsPage() {
  let lists = null;
  const page = new ListPage({
    title: 'Recommendations', kind: 'song', rowH: 38, twoLine: true,
    emptyText: 'Loading…',
    items: () => (lists || []).map((p) => ({ id: p.id, label: p.title.replace(/ for \S+.*$/, '') || p.title, sub: p.date ? new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '', chevron: true, pl: p })),
    onEnter: (it) => stack.push(lbTracksPage(it.pl)),
  });
  LB.recommendationPlaylists().then((l) => {
    lists = l;
    page.lv.o.emptyText = 'No playlists yet. ListenBrainz makes them weekly once it knows your taste.';
    page.reload(false);
  }, () => { page.lv.o.emptyText = 'Could not load recommendations'; page.reload(false); });
  return page;
}

const norm = (x) => (x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function findLocal(t) {
  const ti = norm(t.title);
  const ar = norm(t.artist).split(' ')[0];
  return library.tracks.find((x) => norm(x.title) === ti && norm(x.artist).includes(ar));
}

// ---------- wishlist (songs to download on the laptop with flippod-sync) ----------
const wkey = (t) => `${norm(t.artist)}|${norm(t.title)}`;
const wishlist = () => settings.get('wishlist') || [];
const onWishlist = (t) => wishlist().some((w) => wkey(w) === wkey(t));
function toggleWish(t) {
  const list = wishlist();
  if (onWishlist(t)) { settings.set('wishlist', list.filter((w) => wkey(w) !== wkey(t))); toast('Removed from wishlist'); return false; }
  settings.set('wishlist', [...list, { title: t.title, artist: t.artist, album: t.album || '', dur: t.dur || 0, added: Date.now() }]);
  toast('Added to wishlist');
  return true;
}

function lbTracksPage(pl) {
  let tracks = null;
  const page = new ListPage({
    title: pl.title.replace(/ for \S+.*$/, '') || 'Playlist', kind: 'song', rowH: 38, twoLine: true, thumbs: true,
    emptyText: 'Loading…',
    dynamic: true,
    items: () => (tracks || []).map((t, i) => {
      const local = findLocal(t);
      const wished = !local && onWishlist(t);
      return { id: 'r' + i, label: (wished ? '★ ' : '') + t.title, sub: local ? `${t.artist} · in your library` : wished ? `${t.artist} · on your wishlist` : t.artist, art: local ? local.art : null, seed: t.artist, playing: false, local, dim: !local && !wished, t };
    }),
    onEnter: (it) => {
      if (!it.local) { toast('Not in your library yet. Right key: wishlist'); return; }
      const owned = page.lv.items.filter((x) => x.local).map((x) => x.local.id);
      player.playList(owned, owned.indexOf(it.local.id), { shuffle: false });
      openNowPlaying();
    },
    onRight: (pg) => {
      const it = pg.lv.selected;
      if (!it) return;
      if (it.local) { toast('Already in your library'); return; }
      toggleWish(it.t);
      pg.reload(true);
      stack.softkeys();
    },
    softkeys: (pg) => {
      const it = pg.lv && pg.lv.selected;
      if (!it) return { c: 'Play' };
      if (it.local) return { c: 'Play' };
      return { c: '', r: onWishlist(it.t) ? 'Unwish' : 'Wishlist' };
    },
  });
  LB.playlistTracks(pl.id).then((t) => { tracks = t; page.lv.o.emptyText = 'Empty playlist'; page.reload(false); stack.softkeys(); },
    () => { page.lv.o.emptyText = 'Could not load this playlist'; page.reload(false); });
  return page;
}

function wishlistPage() {
  return new ListPage({
    title: 'Wishlist', kind: 'song', rowH: 38, twoLine: true, dynamic: true,
    emptyText: 'Star songs in Recommendations, then run flippod-sync --wishlist on your computer',
    items: () => wishlist().map((w, i) => ({ id: 'w' + i, label: w.title, sub: w.artist, w })),
    onEnter: () => toast('Downloads next time you run flippod-sync'),
    options: async (it, pg) => {
      await sheet(it.label, [{ label: 'Remove from Wishlist', run: () => { toggleWish(it.w); pg.reload(true); } }]);
    },
    softkeys: () => ({ r: 'Options' }),
  });
}

// ---------- Wi-Fi ----------
function wifiStateLabel() {
  if (!WIFI.available()) return '';
  if (!WIFI.isOn()) return 'Off';
  const c = WIFI.current();
  return c.status === 'connected' && c.ssid ? c.ssid : 'On';
}

function watchWifi(page) {
  WIFI.init();
  const fn = () => { page.reload(true); stack.top === page && stack.softkeys(); };
  WIFI.wifi.addEventListener('change', fn);
  const prev = page.o.onDestroy;
  page.o.onDestroy = (pg) => { WIFI.wifi.removeEventListener('change', fn); prev && prev(pg); };
}

const wifiStatusText = (c) => ({ connected: 'Connected', connecting: 'Connecting…', associated: 'Connecting…', authenticating: 'Connecting…', connectingfailed: 'Could not connect' }[c.status] || '');

function wifiPage() {
  const page = new ListPage({
    title: 'Wi-Fi', kind: 'song', rowH: 38, twoLine: true,
    items: () => {
      if (!WIFI.available()) return [{ id: 'na', label: 'Wi-Fi unavailable', dim: true }];
      const l = [{ id: 'toggle', label: 'Wi-Fi', sub: WIFI.isOn() ? 'On' : 'Off' }];
      if (!WIFI.isOn()) return l;
      const c = WIFI.current();
      if (c.ssid && c.status !== 'disconnected') l.push({ id: 'cur', label: c.ssid, sub: wifiStatusText(c) || 'Connected', playing: c.status === 'connected' });
      l.push({ id: 'avail', label: 'Available Networks', sub: 'Scan and join', chevron: true });
      l.push({ id: 'saved', label: 'Saved Networks', sub: 'Join or forget', chevron: true });
      return l;
    },
    onEnter: async (it) => {
      if (it.id === 'toggle') {
        const on = !WIFI.isOn();
        toast(on ? 'Turning Wi-Fi on…' : 'Turning Wi-Fi off…');
        try { await WIFI.setEnabled(on); } catch (e) { toast('Could not change Wi-Fi'); }
      } else if (it.id === 'avail') stack.push(wifiScanPage());
      else if (it.id === 'saved') stack.push(wifiSavedPage());
      else if (it.id === 'cur') {
        const nets = await WIFI.known();
        const n = nets.find((x) => x.ssid === it.label);
        if (!n) return;
        await sheet(it.label, [{ label: 'Forget Network', run: () => wifiForget(n) }]);
      }
    },
    softkeys: () => ({ c: 'Select' }),
  });
  watchWifi(page);
  return page;
}

async function wifiForget(n) {
  try { await WIFI.forget(n); toast(`Forgot ${n.ssid}`); } catch (e) { toast('Could not forget network'); }
}

async function wifiJoin(net, saved) {
  if (WIFI.kind(net) === 'WPA-EAP') { toast('Enterprise Wi-Fi: use KaiOS Settings'); return false; }
  let pw = null;
  if (WIFI.needsPassword(net, saved)) {
    pw = await prompt(`Password for ${net.ssid}`, '');
    if (pw == null) return false;
    if (WIFI.kind(net) !== 'WEP' && pw.length < 8) { toast('Passwords are at least 8 characters'); return false; }
  }
  toast(`Connecting to ${net.ssid}…`);
  const result = WIFI.waitForResult();
  try { await WIFI.connect(net, pw); } catch (e) { toast('Could not connect'); return false; }
  const r = await result;
  toast(r === 'connected' ? `Connected to ${net.ssid}` : r === 'failed' ? (pw != null ? 'Wrong password?' : 'Could not connect') : 'Still connecting…');
  return r === 'connected';
}

function wifiScanPage() {
  let nets = [];
  let savedSsids = new Set();
  let scanning = false;
  const page = new ListPage({
    title: 'Available Networks', kind: 'song', rowH: 38, twoLine: true,
    emptyText: 'Scanning…',
    items: () => nets.map((n, i) => ({
      id: 'n' + i, label: n.ssid, net: n, playing: !!n.connected,
      sub: [n.connected ? 'Connected' : savedSsids.has(n.ssid) ? 'Saved' : '', WIFI.securityLabel(n), WIFI.signalLabel(n)].filter(Boolean).join(' · '),
    })),
    onEnter: async (it) => { if (it.net.connected) { toast('Already connected'); return; } if (await wifiJoin(it.net, savedSsids.has(it.net.ssid))) stack.pop(); },
    softkeys: () => ({ c: 'Join', r: scanning ? 'Scanning…' : 'Rescan' }),
    onRight: () => { if (!scanning) scan(); },
    onShow: (pg, back) => { if (!back) scan(); },
  });
  async function scan() {
    if (!WIFI.isOn()) { toast('Turn Wi-Fi on first'); return; }
    scanning = true;
    stack.top === page && stack.softkeys();
    try {
      const [found, saved] = await Promise.all([WIFI.scan(), WIFI.known()]);
      savedSsids = new Set(saved.map((x) => x.ssid));
      nets = found;
      page.lv.o.emptyText = 'No networks found. Press Rescan.';
    } catch (e) {
      page.lv.o.emptyText = 'Scan failed. Press Rescan.';
    }
    scanning = false;
    page.reload(true);
    stack.top === page && stack.softkeys();
  }
  watchWifi(page);
  return page;
}

function wifiSavedPage() {
  let nets = [];
  const page = new ListPage({
    title: 'Saved Networks', kind: 'song', rowH: 38, twoLine: true,
    emptyText: 'No saved networks',
    items: () => {
      const c = WIFI.current();
      return nets.map((n, i) => {
        const on = c.status === 'connected' && c.ssid === n.ssid;
        return { id: 's' + i, label: n.ssid, net: n, playing: on, sub: `${on ? 'Connected · ' : ''}${WIFI.securityLabel(n)}` };
      });
    },
    onEnter: (it) => {
      const c = WIFI.current();
      if (c.status === 'connected' && c.ssid === it.net.ssid) { toast('Already connected'); return; }
      wifiJoin(it.net, true);
    },
    options: async (it, pg) => {
      await sheet(it.label, [
        { label: 'Join', run: () => wifiJoin(it.net, true) },
        { label: 'Forget Network', run: async () => { await wifiForget(it.net); load(); } },
      ]);
    },
    softkeys: () => ({ c: 'Join', r: 'Options' }),
  });
  async function load() { nets = await WIFI.known(); page.reload(true); }
  load();
  watchWifi(page);
  return page;
}

// ---------- T9 search ----------
const T9MAP = (() => {
  const m = {};
  const keys = { 2: 'abc', 3: 'def', 4: 'ghi', 5: 'jkl', 6: 'mno', 7: 'pqrs', 8: 'tuv', 9: 'wxyz' };
  for (const [d, letters] of Object.entries(keys)) for (const c of letters) m[c] = d;
  for (let d = 0; d <= 9; d++) m[String(d)] = String(d);
  return m;
})();
const T9LETTERS = { 1: '1', 2: 'abc', 3: 'def', 4: 'ghi', 5: 'jkl', 6: 'mno', 7: 'pqrs', 8: 'tuv', 9: 'wxyz' };

function t9words(name) {
  return (name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean).map((w) => [...w].map((c) => T9MAP[c] || '').join(''));
}

let t9index = null;
function buildT9() {
  const idx = [];
  for (const ar of library.artists) idx.push({ type: 'artist', name: ar.name, words: t9words(ar.name), ar });
  for (const al of library.albums) idx.push({ type: 'album', name: al.title, words: t9words(al.title), al });
  for (const t of library.songs) idx.push({ type: 'song', name: t.title, words: t9words(t.title).concat(t9words(t.artist)), t, own: t9words(t.title).length });
  t9index = idx;
}
library.addEventListener('change', () => { t9index = null; });

// Each 0-separated token must prefix-match a word, in order. Lower score = better.
function t9score(entry, tokens) {
  let wi = 0;
  let first = -1;
  for (const tok of tokens) {
    while (wi < entry.words.length && !entry.words[wi].startsWith(tok)) wi++;
    if (wi >= entry.words.length) return -1;
    if (first < 0) first = wi;
    wi++;
  }
  // songs also match on artist words; rank title matches above artist-only matches
  const artistOnly = entry.own != null && first >= entry.own ? 2 : 0;
  return first + artistOnly + entry.name.length / 1000;
}

class SearchPage {
  constructor() {
    this.title = 'Search';
    this.q = '';
    this.el = h('div', 'page search');
    this.box = h('div', 'srch-box');
    this.keys = h('div', 'srch-keys');
    this.hint = h('div', 'srch-hint', 'Type with the keypad · 0 = next word');
    this.box.append(this.keys, this.hint);
    this.lv = new ListView({
      kind: 'song', rowH: 38, twoLine: true, thumbs: true,
      emptyText: 'Start typing',
      onEnter: (it) => this.open(it),
    });
    this.el.append(this.box, this.lv.el);
    if (!t9index) buildT9();
  }

  mount(height) { this.lv.resize(height - 46); }
  show() {}

  update() {
    this.keys.textContent = '';
    for (const d of this.q) {
      const k = h('span', d === '0' ? 'srch-k sp' : 'srch-k');
      k.append(h('b', '', d === '0' ? '␣' : d), h('i', '', d === '0' ? '' : T9LETTERS[d] || ''));
      this.keys.appendChild(k);
    }
    this.hint.style.display = this.q ? 'none' : '';
    const tokens = this.q.split('0').filter(Boolean);
    let items = [];
    if (tokens.length) {
      const hits = [];
      for (const e of t9index) { const sc = t9score(e, tokens); if (sc >= 0) hits.push([sc, e]); }
      hits.sort((a, b) => a[0] - b[0]);
      const pick = (type, n) => hits.filter(([, e]) => e.type === type).slice(0, n).map(([, e]) => e);
      const fmt = {
        artist: (e) => ({ id: 'a:' + e.ar.key, label: e.ar.name, sub: `Artist · ${plural(e.ar.tracks.length, 'song')}`, art: e.ar.art, seed: e.ar.name, chevron: true, e }),
        album: (e) => ({ id: 'l:' + e.al.key, label: e.al.title, sub: `Album · ${e.al.artist}`, art: e.al.art, seed: e.al.title, chevron: true, e }),
        song: (e) => ({ id: 's:' + e.t.id, label: e.t.title, sub: e.t.artist || 'Unknown Artist', art: e.t.art, seed: e.t.album, e }),
      };
      items = [...pick('artist', 4).map(fmt.artist), ...pick('album', 6).map(fmt.album), ...pick('song', 60).map(fmt.song)];
    }
    this.lv.o.emptyText = this.q ? 'No matches' : 'Start typing';
    this.lv.setItems(items);
    stack && stack.top === this && stack.softkeys();
  }

  open(it) {
    const e = it.e;
    if (e.type === 'artist') stack.push(artistPage(e.ar));
    else if (e.type === 'album') stack.push(albumPage(e.al));
    else {
      const songs = this.lv.items.filter((x) => x.e.type === 'song').map((x) => x.e.t.id);
      player.playList(songs, songs.indexOf(e.t.id), { shuffle: false });
      openNowPlaying();
    }
  }

  softkeys() { return { l: this.q ? 'Clear' : '', c: this.lv.items.length ? 'Open' : '' }; }

  onKey(e) {
    if (/^[0-9]$/.test(e.key)) {
      if (e.key === '0' && (!this.q || this.q.endsWith('0'))) return true;
      if (this.q.length < 24) { this.q += e.key; click(); this.update(); }
      return true;
    }
    if (e.key === 'Backspace' && this.q) { this.q = this.q.slice(0, -1); this.update(); return true; }
    if (e.key === 'SoftLeft' && this.q) { this.q = ''; this.update(); return true; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') return this.lv.onKey(e);
    return false;
  }
  keyUp() { this.lv.keyUp(); }
}

export function openSearch() {
  if (stack.top instanceof SearchPage) return;
  stack.push(new SearchPage());
}
