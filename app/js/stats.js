// Listening stats: minutes and songs per day, plays per artist per day (kept ~8 days).
const KEY = 'fp.listen';
let data = null;
let dirty = false;

const day = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function load() {
  if (data) return data;
  try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { data = null; }
  if (!data || !data.days) data = { days: {} };
  return data;
}

function today() {
  const d = load();
  const k = day();
  if (!d.days[k]) {
    d.days[k] = { sec: 0, songs: 0, artists: {} };
    const keys = Object.keys(d.days).sort();
    while (keys.length > 8) delete d.days[keys.shift()];
  }
  return d.days[k];
}

function save() {
  if (!dirty) return;
  dirty = false;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* full */ }
}
setInterval(save, 20000);
document.addEventListener('visibilitychange', save);

export function addSeconds(s) {
  if (!(s > 0 && s < 5)) return;
  today().sec += s;
  dirty = true;
}

export function addSong(artist) {
  const t = today();
  t.songs++;
  if (artist) t.artists[artist] = (t.artists[artist] || 0) + 1;
  dirty = true;
  save();
}

export function summary() {
  const t = today();
  const counts = {};
  const d = load();
  const cutoff = day(Date.now() - 6 * 86400000);
  for (const [k, v] of Object.entries(d.days)) {
    if (k < cutoff) continue;
    for (const [a, n] of Object.entries(v.artists || {})) counts[a] = (counts[a] || 0) + n;
  }
  let top = '';
  let best = 0;
  for (const [a, n] of Object.entries(counts)) if (n > best) { best = n; top = a; }
  return { min: Math.round(t.sec / 60), songs: t.songs, top, day: day() };
}
