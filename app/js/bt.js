// Bluetooth helper over KaiOS's navigator.b2g.bluetooth (needs the bluetooth-privileged permission).
// PIN / confirm prompts during pairing are shown by the system, not here.
const PROFILES = [0x110d /* A2DP audio */, 0x111e /* hands-free */, 0x1124 /* HID */];

export const bt = new EventTarget();
let adapter = null;
let ready = null;
let connected = new Set();

const emit = () => bt.dispatchEvent(new Event('change'));

function wire(a) {
  if (!a || a === adapter) return;
  adapter = a;
  a.addEventListener('attributechanged', () => { refreshConnected(); emit(); });
  for (const ev of ['devicepaired', 'deviceunpaired', 'a2dpstatuschanged', 'hfpstatuschanged', 'hidstatuschanged']) {
    a.addEventListener(ev, () => { refreshConnected(); emit(); });
  }
  refreshConnected();
}

export function init() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    const m = navigator.b2g && navigator.b2g.bluetooth;
    if (!m) { resolve(false); return; }
    m.addEventListener('attributechanged', () => { wire(m.defaultAdapter); emit(); resolve(true); });
    if (m.defaultAdapter) { wire(m.defaultAdapter); resolve(true); }
    setTimeout(() => resolve(!!adapter), 5000);
  });
  return ready;
}

export const available = () => !!adapter;
export const state = () => (adapter ? adapter.state : 'unavailable'); // enabled | disabled | enabling | disabling
export const isOn = () => state() === 'enabled';

export async function setEnabled(on) {
  await init();
  if (!adapter) throw new Error('Bluetooth unavailable');
  if (on && state() === 'disabled') await adapter.enable();
  if (!on && state() === 'enabled') await adapter.disable();
  // enable()/disable() resolve before the adapter settles; wait so scans don't fail with InvalidStateError
  const want = on ? 'enabled' : 'disabled';
  for (let i = 0; i < 40 && state() !== want; i++) await new Promise((r) => setTimeout(r, 250));
  await refreshConnected();
  emit();
}

export async function refreshConnected() {
  if (!adapter || !isOn()) { connected = new Set(); return connected; }
  const sets = await Promise.all(PROFILES.map((p) => adapter.getConnectedDevices(p).then((l) => l || [], () => [])));
  const next = new Set();
  for (const l of sets) for (const d of l) next.add(typeof d === 'string' ? d : d.address);
  const changed = next.size !== connected.size || [...next].some((x) => !connected.has(x));
  connected = next;
  if (changed) emit();
  return connected;
}

export const isConnected = (d) => connected.has(d.address);

export function paired() {
  if (!adapter || !isOn()) return [];
  try { return adapter.getPairedDevices() || []; } catch (e) { return []; }
}

export function kind(d) {
  const c = d && d.cod;
  switch (c && c.majorDeviceClass) {
    case 0x04: return 'Audio';
    case 0x01: return 'Computer';
    case 0x02: return 'Phone';
    case 0x05: return 'Accessory';
    case 0x07: return 'Wearable';
    default: return 'Device';
  }
}

export const label = (d) => d.name || d.address;

// ---------- discovery ----------
let handle = null;
let stopT = 0;
export async function discover(onFound, ms = 30000) {
  await init();
  if (!adapter || !isOn()) return false;
  await stopDiscovery();
  handle = await adapter.startDiscovery();
  handle.ondevicefound = (e) => onFound(e.device);
  clearTimeout(stopT);
  stopT = setTimeout(() => { stopDiscovery(); bt.dispatchEvent(new Event('discoveryend')); }, ms);
  return true;
}
export async function stopDiscovery() {
  clearTimeout(stopT);
  handle = null;
  if (adapter && adapter.discovering) { try { await adapter.stopDiscovery(); } catch (e) { /* already stopped */ } }
}
export const discovering = () => !!(adapter && adapter.discovering);

// ---------- pair / connect ----------
export async function pair(device) {
  await stopDiscovery();
  await adapter.pair(device.address);
  // connect right away, like the stock settings do
  const p = paired().find((x) => x.address === device.address) || device;
  try { await connect(p); } catch (e) { /* paired but the device didn't accept a connection */ }
}

export async function connect(device) {
  await stopDiscovery();
  await adapter.connect(device);
  await refreshConnected();
}

export async function disconnect(device) {
  await adapter.disconnect(device);
  await refreshConnected();
}

export async function forget(device) {
  if (isConnected(device)) { try { await adapter.disconnect(device); } catch (e) { /* ignore */ } }
  await adapter.unpair(device.address);
  await refreshConnected();
}
