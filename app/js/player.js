// Playback engine: queue, shuffle/repeat, preloading, persistence, remote controls.
import { library, artUrl } from './library.js';
import { getFile } from './scanner.js';
import { settings } from './settings.js';
import * as stats from './stats.js';

const STATE_KEY = 'fp.state';

function makeAudio() {
  const a = new Audio();
  a.preload = 'auto';
  try { a.mozAudioChannelType = 'content'; } catch (e) { /* not KaiOS */ }
  return a;
}

function shuffled(arr, keepFirst) {
  const a = arr.slice();
  let start = 0;
  if (keepFirst != null) {
    const i = a.indexOf(keepFirst);
    if (i > 0) [a[0], a[i]] = [a[i], a[0]];
    start = 1;
  }
  for (let i = a.length - 1; i > start; i--) {
    const j = start + Math.floor(Math.random() * (i - start + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Player extends EventTarget {
  constructor() {
    super();
    this.audio = makeAudio();
    this.next_ = makeAudio(); // preloaded next track
    this.nextId = null;
    this.base = [];     // original (unshuffled) list of ids
    this.queue = [];    // play order
    this.index = -1;
    this.urls = new Map();
    this.counted = false;
    this.sleepAt = 0;
    this.sleepTimer = null;
    this._wire(this.audio);
    this._wire(this.next_);
    this._saveTimer = setInterval(() => { if (!this.audio.paused) this.save(); }, 5000);
    document.addEventListener('visibilitychange', () => this.save());
    this._remote();
  }

  get current() { return this.queue[this.index] ? library.get(this.queue[this.index]) : null; }
  get playing() { return !this.audio.paused; }
  get shuffle() { return settings.get('shuffle'); }
  get repeat() { return settings.get('repeat'); }
  get time() { return this.audio.currentTime || 0; }
  get duration() {
    const d = this.audio.duration;
    if (isFinite(d) && d > 0) return d;
    const c = this.current;
    return c && c.dur ? c.dur : 0;
  }

  _wire(a) {
    a.addEventListener('ended', () => { if (a === this.audio) this._ended(); });
    a.addEventListener('play', () => { if (a === this.audio) this._emit('state'); });
    a.addEventListener('pause', () => { if (a === this.audio) { this._emit('state'); this.save(); } });
    a.addEventListener('timeupdate', () => {
      if (a !== this.audio) return;
      const now = a.currentTime;
      if (!a.paused && this._lastT != null) stats.addSeconds(now - this._lastT);
      this._lastT = now;
      this._progress();
    });
    a.addEventListener('seeking', () => { if (a === this.audio) this._lastT = null; });
    a.addEventListener('emptied', () => { if (a === this.audio) this._lastT = null; });
    a.addEventListener('loadedmetadata', () => {
      if (a !== this.audio) return;
      const c = this.current;
      if (c && isFinite(a.duration) && Math.abs((c.dur || 0) - a.duration) > 1) {
        c.dur = a.duration;
        library.update(c);
      }
      this._emit('time');
    });
    a.addEventListener('error', () => {
      if (a !== this.audio || !this.current) return;
      this._emit('error');
      // Skip unplayable files after a beat, but avoid infinite loops.
      if (!this._errSkips) this._errSkips = 0;
      if (++this._errSkips < 5) setTimeout(() => this.next(true), 400);
    });
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async _url(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    const f = await getFile(id);
    const u = URL.createObjectURL(f);
    this.urls.set(id, u);
    return u;
  }
  _releaseUrls(keep) {
    for (const [id, u] of this.urls) {
      if (!keep.includes(id)) { URL.revokeObjectURL(u); this.urls.delete(id); }
    }
  }

  // Start playing `ids` from position `start`.
  async playList(ids, start = 0, opts = {}) {
    if (!ids.length) return;
    this.base = ids.slice();
    const startId = ids[Math.max(0, start)];
    const shuf = opts.shuffle != null ? opts.shuffle : this.shuffle === 'songs';
    if (opts.shuffle != null) settings.set('shuffle', opts.shuffle ? 'songs' : 'off');
    this.queue = shuf ? shuffled(ids, opts.randomStart ? null : startId) : ids.slice();
    this.index = shuf ? 0 : Math.max(0, start);
    await this._load(true);
  }

  async _load(autoplay, at = 0) {
    const t = this.current;
    if (!t) return;
    this.counted = false;
    this._lastT = null;
    this._errSkips = autoplay ? this._errSkips : 0;
    const want = this.queue[this.index];
    if (this.nextId === want && this.next_.src) {
      // swap in the preloaded element for a seamless start
      const old = this.audio;
      this.audio = this.next_;
      this.next_ = old;
      this.next_.pause();
      this.next_.removeAttribute('src');
      this.next_.load();
      this.nextId = null;
      if (at) this.audio.currentTime = at;
    } else {
      const url = await this._url(want);
      if (this.queue[this.index] !== want) return; // superseded
      this.audio.src = url;
      if (at) {
        const seek = () => { this.audio.currentTime = at; this.audio.removeEventListener('loadedmetadata', seek); };
        this.audio.addEventListener('loadedmetadata', seek);
      }
    }
    this._emit('track', { autoplay });
    if (autoplay) {
      try { await this.audio.play(); } catch (e) { this._emit('state'); }
    }
    this._mediaSession(t);
    this.save();
    this._preloadNext();
  }

  async _preloadNext() {
    const ni = this._nextIndex();
    const nid = ni >= 0 ? this.queue[ni] : null;
    const keep = [this.queue[this.index], nid].filter(Boolean);
    this._releaseUrls(keep);
    if (!nid || nid === this.queue[this.index]) { this.nextId = null; return; }
    if (this.nextId === nid) return;
    this.nextId = nid;
    try {
      this.next_.src = await this._url(nid);
      this.next_.load();
    } catch (e) { this.nextId = null; }
  }

  _nextIndex() {
    if (this.repeat === 'one') return this.index;
    if (this.index + 1 < this.queue.length) return this.index + 1;
    return this.repeat === 'all' ? 0 : -1;
  }

  _ended() {
    this._count(true);
    if (this.repeat === 'one') { this.audio.currentTime = 0; this.audio.play(); return; }
    const ni = this._nextIndex();
    if (ni < 0) {
      this.index = 0;
      this._load(false);
      this._emit('state');
      return;
    }
    this.index = ni;
    this._load(true);
  }

  _progress() {
    const d = this.duration;
    if (!this.counted && d > 30 && this.audio.currentTime > d * 0.5) this._count();
  }

  _count(force) {
    if (this.counted && !force) return;
    if (this.counted) return;
    this.counted = true;
    const t = this.current;
    if (!t) return;
    t.plays = (t.plays || 0) + 1;
    t.lastPlayed = Date.now();
    library.update(t);
    stats.addSong(t.artist);
    this._emit('counted');
  }

  toggle() { this.playing ? this.pause() : this.play(); }
  async play() {
    if (!this.current) {
      if (library.songs.length) await this.playList(library.songs.map((t) => t.id), 0, { shuffle: true, randomStart: true });
      return;
    }
    if (!this.audio.src) await this._load(false, this._restoreAt || 0);
    try { await this.audio.play(); } catch (e) { /* ignore */ }
  }
  pause() { this.audio.pause(); }

  async next(auto) {
    if (!this.queue.length) return;
    let ni = this.index + 1;
    if (ni >= this.queue.length) {
      if (this.repeat === 'off' && auto) return;
      ni = 0;
    }
    const wasPlaying = this.playing || auto;
    this.index = ni;
    await this._load(wasPlaying);
  }

  async prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; this._emit('time'); return; }
    const wasPlaying = this.playing;
    this.index = this.index > 0 ? this.index - 1 : (this.repeat === 'all' ? this.queue.length - 1 : 0);
    await this._load(wasPlaying);
  }

  seek(t) {
    const d = this.duration;
    if (!d) return;
    this.audio.currentTime = Math.max(0, Math.min(d - 0.5, t));
    this._emit('time');
  }

  async jump(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    await this._load(true);
  }

  playNext(ids) {
    if (!this.current) return this.playList(ids, 0);
    this.queue.splice(this.index + 1, 0, ...ids);
    this.base.push(...ids);
    this.save();
    this._preloadNext();
    this._emit('queue');
  }

  enqueue(ids) {
    if (!this.current) return this.playList(ids, 0);
    this.queue.push(...ids);
    this.base.push(...ids);
    this.save();
    this._preloadNext();
    this._emit('queue');
  }

  setShuffle(mode) {
    settings.set('shuffle', mode);
    const cur = this.queue[this.index];
    if (mode === 'songs') {
      this.queue = shuffled(this.base.length ? this.base : this.queue, cur);
      this.index = 0;
    } else {
      this.queue = this.base.length ? this.base.slice() : this.queue;
      this.index = Math.max(0, this.queue.indexOf(cur));
    }
    this.save();
    this._preloadNext();
    this._emit('queue');
  }

  setRepeat(mode) {
    settings.set('repeat', mode);
    this._preloadNext();
    this._emit('queue');
  }

  // ---------- sleep timer ----------
  setSleep(minutes) {
    clearTimeout(this.sleepTimer);
    this.sleepAt = minutes ? Date.now() + minutes * 60000 : 0;
    if (minutes) this.sleepTimer = setTimeout(() => this._fadeOut(), minutes * 60000);
    this._emit('sleep');
  }
  _fadeOut() {
    const a = this.audio;
    const v0 = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = (performance.now() - t0) / 8000;
      if (k >= 1) { a.pause(); a.volume = v0; this.sleepAt = 0; this._emit('sleep'); return; }
      a.volume = v0 * (1 - k);
      setTimeout(step, 100);
    };
    step();
  }

  // ---------- persistence ----------
  save() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        base: this.base, queue: this.queue, index: this.index, pos: this.audio.currentTime || this._restoreAt || 0,
      }));
    } catch (e) { /* storage full */ }
  }

  restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (!s || !s.queue) return;
      const ok = (id) => library.byId.has(id);
      const cur = s.queue[s.index];
      this.queue = s.queue.filter(ok);
      this.base = (s.base || s.queue).filter(ok);
      this.index = Math.max(0, this.queue.indexOf(cur));
      this._restoreAt = ok(cur) ? s.pos || 0 : 0;
      if (this.current) {
        this._emit('track', { autoplay: false });
        this._mediaSession(this.current);
      }
    } catch (e) { /* corrupt state */ }
  }

  // ---------- remote controls ----------
  _remote() {
    const ms = navigator.mediaSession;
    if (ms) {
      const h = { play: () => this.play(), pause: () => this.pause(), nexttrack: () => this.next(), previoustrack: () => this.prev() };
      for (const k in h) { try { ms.setActionHandler(k, h[k]); } catch (e) { /* unsupported */ } }
    }
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', ({ data }) => {
        const m = String(data || '');
        if (!m.endsWith('-press')) return;
        if (m.includes('play-pause') || m === 'media-play-pause-button-press') this.toggle();
        else if (m.includes('pause') || m.includes('stop')) this.pause();
        else if (m.includes('play')) this.play();
        else if (m.includes('next')) this.next();
        else if (m.includes('previous')) this.prev();
      });
    }
    const acm = navigator.b2g && navigator.b2g.audioChannelManager;
    if (acm) {
      try { acm.volumeControlChannel = 'content'; } catch (e) { /* ignore */ }
      acm.addEventListener ? acm.addEventListener('headphoneschange', () => { if (!acm.headphones) this.pause(); })
        : (acm.onheadphoneschange = () => { if (!acm.headphones) this.pause(); });
    }
  }

  async _mediaSession(t) {
    const ms = navigator.mediaSession;
    if (!ms || !window.MediaMetadata) return;
    const art = await artUrl(t.art, 'large');
    try {
      ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art ? [{ src: art, sizes: '240x240', type: 'image/jpeg' }] : [] });
    } catch (e) { /* ignore */ }
  }
}

export const player = new Player();
