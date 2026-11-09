// UI toolkit: springs, virtualized lists, view stack, overlays.
import { artUrl, artUrlSync, hueOf, letterOf } from './library.js';
import { settings } from './settings.js';

// ---------- helpers ----------
export function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export const EASE = 'cubic-bezier(.2,.85,.25,1)';
export const EASE_IN_OUT = 'cubic-bezier(.45,0,.2,1)';

const ICONS = {
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>',
  next: '<path d="M4 5v14l8-7zM12 5v14l8-7z"/>',
  prev: '<path d="M20 5v14l-8-7zM12 5v14l-8-7z"/>',
  shuffle: '<path d="M3 7h3.5c2 0 3.2.9 4.3 2.5l2.4 3.6c1 1.5 2 2.4 3.8 2.4H19v-2.3l3.5 3.3L19 19.8v-2.3h-2c-2.6 0-4-1.3-5.4-3.4l-2.4-3.6C8.5 9.4 7.8 9 6.5 9H3zM19 4.2l3.5 3.3L19 10.8V8.5h-2c-1 0-1.7.4-2.3 1.2l-1.2-1.8c1-1.2 2.1-1.9 3.5-1.9h2zM3 15h3.5c1 0 1.6-.3 2.2-1l1.2 1.8c-.9 1-2 1.5-3.4 1.5H3z"/>',
  repeat: '<path d="M6 7h11V4.5L21 8l-4 3.5V9H7v3H5V8a1 1 0 0 1 1-1zm12 10H7v2.5L3 16l4-3.5V15h10v-3h2v4a1 1 0 0 1-1 1z"/>',
  repeat1: '<path d="M6 7h11V4.5L21 8l-4 3.5V9H7v3H5V8a1 1 0 0 1 1-1zm12 10H7v2.5L3 16l4-3.5V15h10v-3h2v4a1 1 0 0 1-1 1z"/><path d="M11.2 10.2h1.6v4.6h-1.5v-3l-.8.3v-1.2z"/>',
  chevron: '<path d="M9 5.5l6.5 6.5L9 18.5l-1.6-1.6 4.9-4.9-4.9-4.9z"/>',
  note: '<path d="M10 3v11.3A3.8 3.8 0 1 0 12 18V8h6V3z"/>',
  heart: '<path d="M12 20.5s-8-4.9-8-10.6C4 7.1 6 5 8.5 5c1.6 0 2.8.8 3.5 2 .7-1.2 1.9-2 3.5-2C18 5 20 7.1 20 9.9c0 5.7-8 10.6-8 10.6z"/>',
  sleep: '<path d="M15.5 3.2A8.8 8.8 0 1 0 20.8 15 7 7 0 0 1 15.5 3.2z"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ic ' + cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}
export function setIcon(svg, name) { svg.innerHTML = ICONS[name] || ''; }

// ---------- animation ticker ----------
const tasks = new Set();
let raf = 0;
let last = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  for (const fn of [...tasks]) if (!fn(dt, now)) tasks.delete(fn);
  raf = tasks.size ? requestAnimationFrame(loop) : 0;
}
export function animate(fn) {
  tasks.add(fn);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}

export class Spring {
  constructor(v = 0, k = 20) { this.v = v; this.t = v; this.k = k; }
  step(dt) {
    const d = this.t - this.v;
    if (Math.abs(d) < 0.08) { this.v = this.t; return false; }
    this.v += d * (1 - Math.exp(-this.k * dt));
    return true;
  }
  snap(v) { this.v = this.t = v; }
}

// ---------- click sound ----------
let actx = null;
export function click() {
  if (!settings.get('clicker')) return;
  try {
    if (!actx) { actx = new AudioContext(); try { actx.mozAudioChannelType = 'normal'; } catch (e) { /* */ } }
    const len = 0.012;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6) * 0.35;
    const s = actx.createBufferSource();
    s.buffer = buf;
    s.connect(actx.destination);
    s.start();
  } catch (e) { /* audio unavailable */ }
}

// ---------- thumbnails ----------
export function fillArt(box, artKey, seed, size = 'thumb') {
  const img = box.firstChild;
  box.dataset.k = artKey || '';
  if (!artKey) {
    img.removeAttribute('src');
    img.className = 'hide';
    box.style.setProperty('--h', hueOf(seed || ''));
    box.classList.add('ph');
    return;
  }
  const sync = artUrlSync(artKey, size);
  if (sync) {
    img.src = sync;
    img.className = '';
    box.classList.remove('ph');
    return;
  }
  img.className = 'hide';
  box.style.setProperty('--h', hueOf(seed || artKey));
  box.classList.add('ph');
  artUrl(artKey, size).then((u) => {
    if (box.dataset.k !== artKey) return;
    if (!u) return;
    img.src = u;
    img.onload = () => { if (box.dataset.k === artKey) { img.className = 'fade-in'; box.classList.remove('ph'); } };
  });
}

export function artBox(cls = '') {
  const b = h('div', 'art ' + cls);
  const img = h('img', 'hide');
  img.alt = '';
  b.appendChild(img);
  b.appendChild(icon('note', 'ph-note'));
  return b;
}

// ---------- letter overlay ----------
let letterEl = null;
let letterTimer = 0;
export function showLetter(ch) {
  if (!letterEl) {
    letterEl = h('div', 'letter');
    document.getElementById('app').appendChild(letterEl);
  }
  if (letterEl.textContent !== ch) letterEl.textContent = ch;
  if (!letterEl.classList.contains('on')) {
    letterEl.classList.add('on');
    letterEl.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.7)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 160, easing: EASE });
  }
  clearTimeout(letterTimer);
  letterTimer = setTimeout(() => {
    const a = letterEl.animate([{ opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.1)' }], { duration: 220, easing: EASE });
    a.onfinish = () => letterEl.classList.remove('on');
  }, 650);
}

const T9 = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '#', 1: '#' };

// ---------- virtualized list ----------
export class ListView {
  constructor(opts) {
    this.o = Object.assign({ rowH: 30, kind: 'menu', letters: false }, opts);
    this.items = [];
    this.sel = 0;
    this.el = h('div', 'lv lv-' + this.o.kind);
    // Native scroll container: WebRender caches scrolled content instead of re-rasterizing it.
    this.scroller = h('div', 'lv-scroll');
    this.rowsEl = h('div', 'lv-rows');
    this.hl = h('div', 'lv-hl');
    this.hl.style.height = this.o.rowH + 'px';
    this.rowsEl.appendChild(this.hl);
    this.scroller.appendChild(this.rowsEl);
    this.bar = h('div', 'lv-bar');
    this.thumb = h('div', 'lv-thumb');
    this.bar.appendChild(this.thumb);
    this.empty = h('div', 'lv-empty');
    this.el.append(this.scroller, this.bar, this.empty);
    this.pool = [];
    this.scroll = new Spring(0, 17);
    this.hly = new Spring(0, 26);
    this.bounce = new Spring(0, 14);
    this.height = this.o.height || 240;
    this.rep = 0;
    this.t9 = { key: null, n: 0, at: 0 };
    this.setItems(opts.items || []);
  }

  get selected() { return this.items[this.sel]; }

  resize(height) {
    this.height = height;
    this.el.style.height = height + 'px';
    this.rowsEl.style.height = Math.max(height, this.items.length * this.o.rowH) + 'px';
    this._ensurePool();
    this.select(this.sel, false);
  }

  setItems(items, keepSel = false) {
    const prevId = keepSel && this.selected ? this.selected.id : null;
    this.items = items;
    let sel = 0;
    if (prevId != null) {
      const i = items.findIndex((x) => x.id === prevId);
      sel = i >= 0 ? i : Math.min(this.sel, items.length - 1);
    }
    this.empty.textContent = items.length ? '' : (this.o.emptyText || 'Nothing here');
    this.empty.classList.toggle('on', !items.length);
    this.hl.classList.toggle('hide', !items.length);
    for (const r of this.pool) r._i = -1;
    this.rowsEl.style.height = Math.max(this.height, items.length * this.o.rowH) + 'px';
    this._ensurePool();
    this.select(Math.max(0, sel), false);
  }

  _ensurePool() {
    const need = Math.min(this.items.length, Math.ceil(this.height / this.o.rowH) + 3);
    while (this.pool.length < need) {
      const r = this._makeRow();
      r._i = -1;
      this.pool.push(r);
      this.rowsEl.appendChild(r);
    }
    for (let i = need; i < this.pool.length; i++) this.pool[i].classList.add('hide');
    for (let i = 0; i < need; i++) this.pool[i].classList.remove('hide');
    this.activePool = need;
  }

  _makeRow() {
    const r = h('div', 'row');
    r.style.height = this.o.rowH + 'px';
    if (this.o.thumbs) { r._art = artBox('row-art'); r.appendChild(r._art); }
    if (this.o.icons) { r._ico = h('div', 'row-ico'); r.appendChild(r._ico); }
    const txt = h('div', 'row-txt');
    r._l1 = h('div', 'l1');
    r._l1s = h('span');
    r._l1.appendChild(r._l1s);
    txt.appendChild(r._l1);
    if (this.o.twoLine) { r._l2 = h('div', 'l2'); txt.appendChild(r._l2); }
    r.appendChild(txt);
    r._right = h('div', 'row-right');
    r.appendChild(r._right);
    return r;
  }

  _fill(r, i) {
    const it = this.items[i];
    r._i = i;
    r._l1s.textContent = it.label;
    if (r._l2) r._l2.textContent = it.sub || '';
    if (r._art) fillArt(r._art, it.art, it.seed || it.label);
    if (r._ico) {
      r._ico.textContent = '';
      if (it.iconUrl) { const im = h('img'); im.src = it.iconUrl; im.alt = ''; r._ico.appendChild(im); }
      else if (it.icon) r._ico.appendChild(icon(it.icon));
    }
    r._right.textContent = '';
    if (it.right) r._right.textContent = it.right;
    if (it.chevron) r._right.appendChild(icon('chevron', 'chev'));
    if (it.playing) r._right.appendChild(icon('play', 'mini-play'));
    r.classList.toggle('sel', i === this.sel);
    r.classList.toggle('dim', !!it.dim);
    this._stopMarquee(r);
  }

  _render() {
    const rh = this.o.rowH;
    const s = this.scroll.v;
    const first = Math.max(0, Math.floor(s / rh) - 1);
    const n = this.activePool || 0;
    const want = new Set();
    for (let i = first; i < Math.min(this.items.length, first + n); i++) want.add(i);
    const free = [];
    for (let p = 0; p < n; p++) {
      const r = this.pool[p];
      if (want.has(r._i)) want.delete(r._i);
      else free.push(r);
    }
    for (const i of want) {
      const r = free.pop();
      if (!r) break;
      this._fill(r, i);
      r.style.transform = `translateY(${i * rh}px)`;
    }
    const b = this.bounce.v;
    this.scroller.scrollTop = s;
    if (b !== this._lastB) { this.scroller.style.transform = b ? `translateY(${b.toFixed(1)}px)` : ''; this._lastB = b; }
    this.hl.style.transform = `translateY(${this.hly.v.toFixed(2)}px)`;
    const total = this.items.length * rh;
    if (total > this.height) {
      const th = Math.max(18, (this.height / total) * this.height);
      const ty = (s / (total - this.height)) * (this.height - th);
      this.thumb.style.height = th + 'px';
      this.thumb.style.transform = `translateY(${ty.toFixed(1)}px)`;
    }
  }

  _kick() {
    if (this._running) return;
    this._running = true;
    this._showBar();
    animate((dt) => {
      const a = this.scroll.step(dt);
      const b = this.hly.step(dt);
      const c = this.bounce.step(dt);
      if (!c && this.bounce.t !== 0) { this.bounce.t = 0; }
      this._render();
      if (a || b || c || this.bounce.t !== 0) return true;
      this._running = false;
      this._settled();
      return false;
    });
  }

  _showBar() {
    if (this.items.length * this.o.rowH <= this.height) return;
    this.bar.classList.add('on');
    clearTimeout(this._barT);
    this._barT = setTimeout(() => this.bar.classList.remove('on'), 1200);
  }

  select(i, anim = true) {
    if (!this.items.length) { this._render(); return; }
    i = Math.max(0, Math.min(this.items.length - 1, i));
    const prev = this.sel;
    this.sel = i;
    const rh = this.o.rowH;
    const total = this.items.length * rh;
    const maxScroll = Math.max(0, total - this.height);
    const margin = total > this.height ? rh : 0;
    let t = this.scroll.t;
    const y = i * rh;
    if (y - margin < t) t = y - margin;
    if (y + rh + margin > t + this.height) t = y + rh + margin - this.height;
    t = Math.max(0, Math.min(maxScroll, t));
    this.scroll.t = t;
    this.hly.t = y;
    if (!anim) { this.scroll.snap(t); this.hly.snap(y); }
    for (const r of this.pool) {
      if (r._i === prev || r._i === i) r.classList.toggle('sel', r._i === i);
      if (r._i === prev) this._stopMarquee(r);
    }
    if (anim) this._kick(); else this._render();
    if (this.o.onFocus) this.o.onFocus(this.selected, i);
    clearTimeout(this._mq);
    this._mq = setTimeout(() => this._marquee(), 900);
  }

  _settled() {}

  _marquee() {
    const r = this.pool.find((x) => x._i === this.sel);
    if (!r) return;
    const box = r._l1;
    const span = r._l1s;
    const over = span.scrollWidth - box.clientWidth;
    if (over <= 2) return;
    const dist = over + 16;
    const dur = Math.max(1800, dist * 38);
    r._mqa = span.animate([
      { transform: 'translateX(0)' },
      { transform: 'translateX(0)', offset: 0.15 },
      { transform: `translateX(${-dist}px)`, offset: 0.75 },
      { transform: `translateX(${-dist}px)` },
    ], { duration: dur + 1400, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    box.classList.add('mq');
  }
  _stopMarquee(r) {
    if (r._mqa) { r._mqa.cancel(); r._mqa = null; }
    r._l1.classList.remove('mq');
  }

  move(d, repeat) {
    if (!this.items.length) return;
    let step = 1;
    if (repeat) {
      this.rep++;
      if (this.items.length > 40) step = this.rep > 30 ? 6 : this.rep > 14 ? 3 : this.rep > 6 ? 2 : 1;
      if (this.o.letters && this.rep > 8) showLetter(letterOf(this.items[this.sel].sortLabel || this.items[this.sel].label));
    } else this.rep = 0;
    const n = this.sel + d * step;
    if (n < 0 || n >= this.items.length) {
      if (!repeat && (this.sel === 0 || this.sel === this.items.length - 1)) {
        // wrap around like most KaiOS lists, with a soft bounce
        if (this.items.length > 1 && !this.o.noWrap) { this.select(n < 0 ? this.items.length - 1 : 0); click(); return; }
        this.bounce.v = d > 0 ? -9 : 9; this.bounce.t = 0; this._kick();
        return;
      }
    }
    this.select(n);
    click();
  }

  jumpLetter(key) {
    if (!this.o.letters || !T9[key]) return false;
    const now = Date.now();
    const letters = T9[key];
    if (this.t9.key === key && now - this.t9.at < 1100) this.t9.n = (this.t9.n + 1) % letters.length;
    else this.t9.n = 0;
    this.t9.key = key;
    this.t9.at = now;
    // find first item at or after chosen letter that exists, trying letters in order
    for (let k = 0; k < letters.length; k++) {
      const L = letters[(this.t9.n + k) % letters.length];
      const i = this.items.findIndex((it) => {
        const l = letterOf(it.sortLabel || it.label);
        return L === '#' ? l === '#' : l === L;
      });
      if (i >= 0) {
        this.t9.n = (this.t9.n + k) % letters.length;
        showLetter(L);
        this.select(i);
        click();
        return true;
      }
    }
    showLetter(letters[this.t9.n]);
    return true;
  }

  onKey(e) {
    switch (e.key) {
      case 'ArrowUp': this.move(-1, e.repeat); return true;
      case 'ArrowDown': this.move(1, e.repeat); return true;
      case 'Enter':
        if (this.selected && this.o.onEnter) { click(); this.o.onEnter(this.selected, this.sel); }
        return true;
      default:
        if (/^[0-9]$/.test(e.key)) return this.jumpLetter(e.key);
    }
    return false;
  }

  keyUp() { this.rep = 0; }

  refresh() {
    for (let p = 0; p < (this.activePool || 0); p++) {
      const r = this.pool[p];
      if (r._i >= 0 && r._i < this.items.length) this._fill(r, r._i);
    }
  }
}

// Cancel animations left on an element (fill: 'forwards' ones would otherwise pin it in place forever).
export function clearAnims(el) {
  for (const a of el.getAnimations()) a.cancel();
}

// ---------- view stack with header + softkeys ----------
export class Stack {
  constructor(root) {
    this.root = root;
    this.views = [];
    this.hdr = root.querySelector('.hdr');
    this.titleBox = this.hdr.querySelector('.hdr-title');
    this.body = root.querySelector('.views');
    this.sk = root.querySelector('.sk');
    this.skEls = [...this.sk.children];
  }
  get top() { return this.views[this.views.length - 1]; }
  get depth() { return this.views.length; }
  get bodyHeight() { return this.body.clientHeight; }

  push(view, anim = true) {
    const prev = this.top;
    this.views.push(view);
    view.stack = this;
    if (!view.el.parentNode) this.body.appendChild(view.el);
    view.el.classList.add('view');
    if (view.mount && !view._mounted) { view._mounted = true; view.mount(this.bodyHeight); }
    view.show && view.show();
    this._title(view.title, anim ? 1 : 0);
    this.softkeys();
    this._finish();
    clearAnims(view.el);
    if (anim && prev) {
      clearAnims(prev.el);
      const w = this.body.clientWidth;
      const out = prev.el.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-w * 0.33}px)`, opacity: 0.2 }], { duration: 300, easing: EASE, fill: 'forwards' });
      out.onfinish = () => { if (this.top !== prev) prev.el.classList.add('off'); out.cancel(); };
      this._anims = [out, view.el.animate([{ transform: `translateX(${w}px)` }, { transform: 'translateX(0)' }], { duration: 300, easing: EASE })];
    } else if (prev) prev.el.classList.add('off');
    view.el.classList.remove('off');
    prev && prev.hide && prev.hide();
  }

  pop(anim = true) {
    if (this.views.length <= 1) return false;
    const view = this.views.pop();
    const next = this.top;
    next.el.classList.remove('off');
    next.show && next.show(true);
    this._title(next.title, anim ? -1 : 0);
    this.softkeys();
    view.hide && view.hide();
    // A reused view (Now Playing) may be pushed again before this pop's animation ends; don't tear it down then.
    const done = () => {
      if (this.views.includes(view)) return;
      clearAnims(view.el);
      view.el.remove();
      view.destroy && view.destroy();
    };
    this._finish();
    clearAnims(next.el);
    if (anim) {
      clearAnims(view.el);
      const w = this.body.clientWidth;
      this._anims = [
        next.el.animate([{ transform: `translateX(${-w * 0.33}px)`, opacity: 0.2 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 280, easing: EASE }),
        view.el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${w}px)` }], { duration: 280, easing: EASE, fill: 'forwards' }),
      ];
      this._anims[1].onfinish = done;
    } else done();
    return true;
  }

  popToRoot() {
    while (this.views.length > 2) {
      const v = this.views.splice(this.views.length - 2, 1)[0];
      clearAnims(v.el);
      v.el.remove();
      v.hide && v.hide();
      v.destroy && v.destroy();
    }
    if (this.views.length > 1) this.pop();
  }

  _finish() {
    if (this._anims) for (const a of this._anims) { try { a.finish(); } catch (e) { /* */ } }
    this._anims = null;
  }

  setTitle(view, t) {
    view.title = t;
    if (this.top === view) this._title(t, 0, true);
  }

  _title(text, dir, quick) {
    const old = this.titleBox.querySelector('.t:not(.out)');
    if (old && old.textContent === text) return;
    const n = h('span', 't', text);
    this.titleBox.appendChild(n);
    if (old) {
      old.classList.add('out');
      const dx = dir * 36;
      const a = old.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-dx}px)` }], { duration: quick ? 150 : 260, easing: EASE, fill: 'forwards' });
      a.onfinish = () => old.remove();
      n.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: quick ? 150 : 300, easing: EASE });
    }
  }

  softkeys() {
    const v = this.top;
    const sk = (v && v.softkeys && v.softkeys()) || {};
    const vals = [sk.l || '', sk.c || '', sk.r || ''];
    this.skEls.forEach((el, i) => {
      if (el.textContent === vals[i]) return;
      el.textContent = vals[i];
      el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE });
    });
  }
}

// ---------- toast ----------
let toastEl = null;
let toastT = 0;
export function toast(msg) {
  if (!toastEl) { toastEl = h('div', 'toast'); document.getElementById('app').appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  toastEl.animate([{ opacity: 0, transform: 'translate(-50%, 10px) scale(.96)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1)' }], { duration: 220, easing: EASE });
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    const a = toastEl.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, 6px)' }], { duration: 200, easing: EASE });
    a.onfinish = () => toastEl.classList.remove('on');
  }, 1600);
}

// ---------- modal layer (options sheet, prompt) ----------
export const modal = { top: null };

export function sheet(title, options) {
  return new Promise((resolve) => {
    const app = document.getElementById('app');
    const scrim = h('div', 'scrim');
    const panel = h('div', 'sheet');
    const head = h('div', 'sheet-title', title);
    const rowH = 30;
    const height = Math.min(options.length, 6) * rowH;
    const lv = new ListView({
      kind: 'sheet', rowH, height, noWrap: false,
      items: options.map((o, i) => ({ id: i, label: o.label, right: o.right || '', dim: o.dim })),
      onEnter: (it) => close(options[it.id]),
    });
    lv.el.style.height = height + 'px';
    panel.append(head, lv.el);
    const sk = h('div', 'sheet-sk');
    sk.append(h('span', '', 'Cancel'), h('span', '', 'Select'), h('span', '', ''));
    panel.appendChild(sk);
    app.append(scrim, panel);
    lv.resize(height);
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE });
    panel.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 300, easing: EASE });
    let closed = false;
    function close(val) {
      if (closed) return;
      closed = true;
      modal.top = null;
      scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE, fill: 'forwards' });
      const a = panel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(105%)' }], { duration: 220, easing: EASE_IN_OUT, fill: 'forwards' });
      a.onfinish = () => { scrim.remove(); panel.remove(); };
      resolve(val || null);
      if (val && val.run) val.run();
    }
    modal.top = {
      onKey(e) {
        if (e.key === 'Backspace' || e.key === 'SoftLeft' || e.key === 'SoftRight') { e.preventDefault(); close(null); return true; }
        return lv.onKey(e);
      },
      keyUp() { lv.keyUp(); },
    };
  });
}

export function prompt(title, value = '') {
  return new Promise((resolve) => {
    const app = document.getElementById('app');
    const scrim = h('div', 'scrim');
    const panel = h('div', 'sheet prompt');
    const head = h('div', 'sheet-title', title);
    const input = h('input', 'prompt-in');
    input.type = 'text';
    input.value = value;
    const sk = h('div', 'sheet-sk');
    sk.append(h('span', '', 'Cancel'), h('span', '', ''), h('span', '', 'Save'));
    panel.append(head, input, sk);
    app.append(scrim, panel);
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    panel.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 280, easing: EASE });
    setTimeout(() => { input.focus(); input.setSelectionRange(value.length, value.length); }, 60);
    let closed = false;
    function close(v) {
      if (closed) return;
      closed = true;
      modal.top = null;
      input.blur();
      scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
      const a = panel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(105%)' }], { duration: 200, easing: EASE_IN_OUT, fill: 'forwards' });
      a.onfinish = () => { scrim.remove(); panel.remove(); };
      resolve(v);
    }
    modal.top = {
      onKey(e) {
        if (e.key === 'SoftLeft' || (e.key === 'Backspace' && !input.value)) { e.preventDefault(); close(null); return true; }
        if (e.key === 'SoftRight' || e.key === 'Enter') { e.preventDefault(); close(input.value.trim() || null); return true; }
        return 'pass';
      },
    };
  });
}
