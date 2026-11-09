// Forwards headset/Bluetooth media-button system messages to the open window.
self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.onsystemmessage = (evt) => {
  if (evt.name !== 'media-button') return;
  let msg = null;
  try { msg = evt.data.json().message; } catch (e) { try { msg = evt.data.text(); } catch (e2) { msg = null; } }
  evt.waitUntil(self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((list) => {
    for (const c of list) c.postMessage(msg);
  }));
};
