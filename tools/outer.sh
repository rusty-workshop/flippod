#!/usr/bin/env bash
# Install (on) or remove (off) Flippod's outer-screen layer.
# chrome://system/ is served from the /data/local/webapps/vroot/system symlink, so "on" points it at a
# patched copy of the stock system zip (only the outer page gains two tags + two files). "off" restores it.
set -euo pipefail
cd "$(dirname "$0")/.."
LINK=/data/local/webapps/vroot/system
STOCK=/system/b2g/webapps/system
OURS=/data/local/flippod-system
adb root >/dev/null 2>&1 || true
adb wait-for-device
restart() { echo "Restarting the KaiOS UI..."; adb shell 'stop b2g; stop api-daemon; sleep 1; start api-daemon; sleep 1; start b2g'; }
case "${1:-}" in
  on)
    mkdir -p build
    adb pull "$STOCK/application.zip" build/system-stock.zip >/dev/null
    python3 tools/patch_system.py build/system-stock.zip build/system-patched.zip
    adb shell "mkdir -p $OURS && cp $STOCK/manifest.webmanifest $OURS/manifest.webmanifest"
    adb push build/system-patched.zip "$OURS/application.zip" >/dev/null
    adb shell "chmod 644 $OURS/application.zip && ln -sfn $OURS $LINK && sync"
    echo "system -> $(adb shell readlink $LINK)"; restart ;;
  off)
    adb shell "ln -sfn $STOCK $LINK && sync"
    echo "system -> $(adb shell readlink $LINK)"; restart ;;
  status) adb shell "readlink $LINK" ;;
  *) echo "usage: $0 on|off|status"; exit 2 ;;
esac
