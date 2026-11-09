// Sends the current song and play state to connected Bluetooth devices (AVRCP),
// so car stereos and headphones can show the title/artist and their buttons stay in sync.
import { player } from './player.js';
import * as BT from './bt.js';

function adapter() {
  const m = navigator.b2g && navigator.b2g.bluetooth;
  return m && m.defaultAdapter;
}

function call(method, data) {
  const a = adapter();
  if (!a || a.state !== 'enabled' || !a[method]) return;
  try {
    const r = a[method](data);
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* no device listening */ }
}

const ms = (s) => Math.max(0, Math.round((s || 0) * 1000));

function sendMeta() {
  const t = player.current;
  if (!t) return;
  call('sendMediaMetaData', {
    title: t.title || '',
    artist: t.artist || 'Unknown Artist',
    album: t.album || '',
    duration: ms(player.duration),
    mediaNumber: player.index + 1,
    totalMediaCount: player.queue.length,
  });
}

function sendStatus() {
  call('sendMediaPlayStatus', {
    playStatus: !player.current ? 'STOPPED' : player.playing ? 'PLAYING' : 'PAUSED',
    duration: ms(player.duration),
    position: ms(player.time),
  });
}

export async function initAvrcp() {
  await BT.init();
  const a = adapter();
  if (!a) return;
  a.addEventListener('requestmediaplaystatus', sendStatus);
  a.addEventListener('a2dpstatuschanged', () => setTimeout(() => { sendMeta(); sendStatus(); }, 800));
  player.addEventListener('track', () => { sendMeta(); sendStatus(); });
  player.addEventListener('state', sendStatus);
  // 'time' fires when a file's metadata loads (duration becomes known) and on seeks
  player.addEventListener('time', () => { sendMeta(); sendStatus(); });
  BT.bt.addEventListener('change', () => { if (BT.isOn()) { sendMeta(); sendStatus(); } });
  sendMeta();
  sendStatus();
}
