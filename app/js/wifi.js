// Wi-Fi helper over KaiOS's navigator.b2g.wifiManager (needs the wifi-manage permission).
// On/off goes through the `wifi.enabled` setting, the same way the stock Settings app does it.
export const wifi = new EventTarget();
const wm = () => navigator.b2g && navigator.b2g.wifiManager;
const emit = () => wifi.dispatchEvent(new Event('change'));

// DOMRequest or Promise -> Promise
function req(r) {
  if (!r) return Promise.reject(new Error('unavailable'));
  if (typeof r.then === 'function') return r;
  return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error || new Error('failed')); });
}

let inited = false;
export function init() {
  const m = wm();
  if (!m || inited) return !!m;
  inited = true;
  for (const ev of ['enabled', 'disabled', 'statuschange', 'connectioninfoupdate', 'wifihasinternet']) {
    m.addEventListener(ev, (e) => { if (ev === 'statuschange') wifi.dispatchEvent(new CustomEvent('status', { detail: e })); emit(); });
  }
  return true;
}

export const available = () => !!wm();
export const isOn = () => !!(wm() && wm().enabled);

export async function setEnabled(on) {
  if (!window.SettingsObserver) throw new Error('settings unavailable');
  await window.SettingsObserver.setValue([{ name: 'wifi.enabled', value: !!on }]);
  for (let i = 0; i < 60 && isOn() !== !!on; i++) await new Promise((r) => setTimeout(r, 250));
  emit();
}

// {status: 'connected'|'connecting'|'associated'|'disconnected'|..., ssid}
export function current() {
  const m = wm();
  const c = m && m.connection;
  if (!c) return { status: 'disconnected', ssid: '' };
  return { status: c.status || 'disconnected', ssid: (c.network && c.network.ssid) || '' };
}

export function kind(net) {
  const s = (net && net.security) || '';
  if (/OPEN$/.test(s) || s === '') return 'OPEN';
  if (/WEP$/.test(s)) return 'WEP';
  if (/WAPI-PSK$/.test(s)) return 'WAPI-PSK';
  if (/SAE$/.test(s)) return 'SAE';
  if (/PSK$/.test(s)) return 'WPA-PSK';
  if (/EAP$/.test(s)) return 'WPA-EAP';
  return s || 'OPEN';
}

export function securityLabel(net) {
  return { OPEN: 'Open', WEP: 'WEP', 'WPA-PSK': 'Secured', SAE: 'WPA3', 'WPA-EAP': 'Enterprise', 'WAPI-PSK': 'WAPI' }[kind(net)] || 'Secured';
}

export function signalLabel(net) {
  const s = net.relSignalStrength != null ? net.relSignalStrength : net.signalStrength;
  if (s == null) return '';
  return s >= 75 ? 'Excellent' : s >= 50 ? 'Good' : s >= 25 ? 'Fair' : 'Weak';
}

const key = (n) => `${n.ssid}+${kind(n) === 'SAE' ? 'SAE' : kind(n)}`;

export async function scan() {
  // the radio refuses scans for a moment right after Wi-Fi turns on, so retry a few times
  let list;
  for (let attempt = 0; ; attempt++) {
    try { list = await req(wm().getNetworks()); break; } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const seen = new Map();
  for (const n of list || []) {
    if (!n.ssid) continue; // hidden networks
    const k = key(n);
    const prev = seen.get(k);
    if (!prev || (n.relSignalStrength || 0) > (prev.relSignalStrength || 0)) seen.set(k, n);
  }
  return [...seen.values()].sort((a, b) => (b.connected - a.connected) || ((b.relSignalStrength || 0) - (a.relSignalStrength || 0)));
}

export async function known() {
  try { return (await req(wm().getKnownNetworks())) || []; } catch (e) { return []; }
}

// `saved`: whether this network is in the phone's saved list (WifiNetwork.known is read-only, so callers pass it).
export function needsPassword(net, saved) {
  return kind(net) !== 'OPEN' && !saved && !net.known;
}

export async function connect(net, password) {
  const k = kind(net);
  if (k === 'WPA-EAP') throw new Error('enterprise');
  if (password != null) {
    if (k === 'WEP') { net.wep = password; net.keyIndex = 0; } else if (k === 'WAPI-PSK') net.wapi_psk = password; else net.psk = password;
  }
  net.keyManagement = k;
  await req(wm().associate(net));
  emit();
}

// Resolves 'connected' or 'failed' once the connection settles (or 'timeout').
export function waitForResult(ms = 20000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { wifi.removeEventListener('status', on); resolve('timeout'); }, ms);
    function on(e) {
      const st = e.detail && e.detail.status;
      if (st === 'connected') { clearTimeout(t); wifi.removeEventListener('status', on); resolve('connected'); }
      else if (st === 'connectingfailed') {
        clearTimeout(t); wifi.removeEventListener('status', on); resolve('failed');
      }
    }
    wifi.addEventListener('status', on);
  });
}

export async function forget(net) {
  net.keyManagement = kind(net);
  await req(wm().forget(net));
  emit();
}
