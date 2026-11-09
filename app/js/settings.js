// Persistent user settings (localStorage), with change events.
const KEY = 'fp.settings';
const DEFAULTS = {
  shuffle: 'off',      // off | songs
  repeat: 'off',       // off | all | one
  theme: 'classic',    // classic | midnight | album
  accent: 'blue',      // blue | pink | mint | orange | violet | red
  clicker: false,      // navigation click sound
  shelfOnStart: false,
  playlists: [],       // [{id, name, items: [trackId]}]
};

class Settings extends EventTarget {
  constructor() {
    super();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    this.v = { ...DEFAULTS, ...saved };
  }
  get(k) { return this.v[k]; }
  set(k, val) {
    this.v[k] = val;
    try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch (e) { /* full */ }
    this.dispatchEvent(new CustomEvent('change', { detail: { key: k, value: val } }));
  }
}

export const settings = new Settings();

// ---------- user playlists ----------
export function playlists() { return settings.get('playlists'); }

export function savePlaylists(list) { settings.set('playlists', list); }

export function createPlaylist(name, items = []) {
  const list = playlists().slice();
  const pl = { id: 'pl' + Date.now().toString(36), name, items };
  list.push(pl);
  savePlaylists(list);
  return pl;
}

export function addToPlaylist(id, items) {
  const list = playlists().map((p) => (p.id === id ? { ...p, items: [...p.items, ...items.filter((x) => !p.items.includes(x))] } : p));
  savePlaylists(list);
}

export function removeFromPlaylist(id, trackId) {
  savePlaylists(playlists().map((p) => (p.id === id ? { ...p, items: p.items.filter((x) => x !== trackId) } : p)));
}

export function deletePlaylist(id) { savePlaylists(playlists().filter((p) => p.id !== id)); }

export function renamePlaylist(id, name) { savePlaylists(playlists().map((p) => (p.id === id ? { ...p, name } : p))); }
