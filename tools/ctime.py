#!/usr/bin/env python3
"""Run JS in Flippod while recording compositor frame intervals on the main screen window.
Usage: ctime.py '<js that returns a promise or value>' """
import sys, json
from rdp import RDP
from wake import wake
r = RDP(); wake(r)
par = r.target('parent')
app = r.target('flippod.localhost')
W = "(()=>{const ws=[];const e=Services.wm.getEnumerator(null);while(e.hasMoreElements())ws.push(e.getNext());return ws.find(x=>x.location.href.endsWith('shell.html'))})()"
print(r.eval(par, f"(()=>{{const w={W};globalThis.__fti=w.windowUtils.startFrameTimeRecording();return String(globalThis.__fti)}})()"))
res = r.eval(app, sys.argv[1] if sys.argv[1] != '-' else sys.stdin.read())
out = r.eval(par, f"(()=>{{const w={W};const a=w.windowUtils.stopFrameTimeRecording(globalThis.__fti);const s=[...a].sort((x,y)=>x-y);return JSON.stringify({{n:s.length,p50:s[s.length>>1]&&s[s.length>>1].toFixed(1),p90:s[Math.floor(s.length*.9)]&&s[Math.floor(s.length*.9)].toFixed(1),max:s.length&&s[s.length-1].toFixed(1)}})}})()")
print('app:', res)
print('compositor:', out)
