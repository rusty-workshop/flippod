#!/usr/bin/env bash
# Make Flippod the KaiOS homescreen (on) or restore the stock launcher (off).
# KaiOS hardcodes the homescreen to http://launcher.localhost, served from the
# /data/local/webapps/vroot/launcher symlink, so we repoint that symlink.
# Needs adb root. Fully reversible: "off" restores the original link.
set -euo pipefail
LINK=/data/local/webapps/vroot/launcher
STOCK=/system/b2g/webapps/launcher
OURS=/data/local/webapps/installed/flippod
adb root >/dev/null 2>&1 || true
adb wait-for-device
case "${1:-}" in
  on)
    adb shell "test -f $OURS/application.zip" || { echo "Install Flippod first (tools/deploy.sh)"; exit 1; }
    adb shell "ln -sfn $OURS $LINK && sync" ;;
  off)
    adb shell "ln -sfn $STOCK $LINK && sync" ;;
  status)
    adb shell "readlink $LINK"; exit 0 ;;
  *) echo "usage: $0 on|off|status"; exit 2 ;;
esac
echo "launcher -> $(adb shell readlink $LINK)"
echo "Restarting the KaiOS UI..."
adb shell 'stop b2g; stop api-daemon; sleep 1; start api-daemon; sleep 1; start b2g'
