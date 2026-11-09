// Synced lyrics from .lrc files next to the audio file.
const cache = new Map();

function readText(path) {
  return new Promise((ok, no) => {
    let st;
    try { st = navigator.b2g.getDeviceStorage('sdcard'); } catch (e) { no(e); return; }
    const r = st.get(path);
    r.onsuccess = () => r.result.text().then(ok, no);
    r.onerror = () => no(r.error);
  });
}

// Returns [{t: seconds, text}] sorted by time, or null if the file has no timestamps.
export function parseLrc(text) {
  let offset = 0;
  const out = [];
  const stamp = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  for (const raw of text.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) { offset = parseInt(off[1], 10) / 1000; continue; }
    const times = [];
    let m;
    stamp.lastIndex = 0;
    let last = 0;
    while ((m = stamp.exec(raw))) {
      times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
      last = stamp.lastIndex;
    }
    if (!times.length) continue;
    const line = raw.slice(last).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const t of times) out.push({ t: Math.max(0, t - offset), text: line });
  }
  if (!out.length) return null;
  out.sort((a, b) => a.t - b.t);
  return out;
}

export async function lyricsFor(track) {
  if (!track || !track.lrc) return null;
  if (cache.has(track.id)) return cache.get(track.id);
  let lines = null;
  try { lines = parseLrc(await readText(track.lrc)); } catch (e) { lines = null; }
  cache.set(track.id, lines);
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  return lines;
}

// Index of the line being sung at time t (-1 before the first line).
export function lineAt(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t + 0.15) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
