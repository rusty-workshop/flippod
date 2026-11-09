#!/usr/bin/env bash
# Build app/ into application.zip and install/update it on the phone over adb.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/application.zip
mkdir -p build
rm -f "$OUT"
(cd app && zip -qr -X "../$OUT" . -x '*.DS_Store')
adb root >/dev/null 2>&1 || true
adb shell mkdir -p /data/local/tmp/flippod
adb push "$OUT" /data/local/tmp/flippod/application.zip >/dev/null
adb shell 'echo "{\"cmd\":\"install\",\"param\":\"/data/local/tmp/flippod/application.zip\"}" | timeout 20 nc -U /data/local/tmp/apps-uds.sock'; echo
# If Flippod is the homescreen, the app server caches the launcher zip: restart the UI stack to pick it up.
if adb shell 'readlink /data/local/webapps/vroot/launcher' | grep -q flippod; then
  echo "Flippod is the homescreen: restarting the KaiOS UI to load the update..."
  adb shell 'stop b2g; stop api-daemon; sleep 1; start api-daemon; sleep 1; start b2g'
  exit 0
fi
# Relaunch (an update may close the running app). Skip with NOLAUNCH=1.
if [ -z "${NOLAUNCH:-}" ]; then
  adb forward tcp:6000 localfilesystem:/data/local/firefox-debugger-socket >/dev/null
  sleep 1
  if python3 tools/rdp.py tabs | grep -q "flippod.localhost"; then
    python3 tools/rdp.py eval flippod.localhost 'location.reload(); "reloaded"'
  else
    python3 tools/rdp.py eval launcher 'window.open("http://flippod.localhost/manifest.webmanifest","_blank","kind=app,noopener=yes"); "launched"'
  fi
fi
