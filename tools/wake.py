#!/usr/bin/env python3
"""Turn the KaiOS screen on (via the system app's ScreenManager) without pressing keys."""
from rdp import RDP
JS = r'''(()=>{const ws=[];const e=Services.wm.getEnumerator(null);while(e.hasMoreElements())ws.push(e.getNext());
const w=ws.find(x=>x.location.href.endsWith('shell.html'));const cw=w.document.getElementById('systemapp').contentWindow.wrappedJSObject;
if(!cw.ScreenManager.screenEnabled) cw.ScreenManager.turnScreenOn(); if(!cw.__devWL) cw.__devWL = cw.navigator.b2g.requestWakeLock('screen'); return String(cw.ScreenManager.screenEnabled)})()'''
def wake(r=None):
    r = r or RDP()
    return r.eval(r.target("parent"), JS)


RELEASE = r'''(()=>{const ws=[];const e=Services.wm.getEnumerator(null);while(e.hasMoreElements())ws.push(e.getNext());
const w=ws.find(x=>x.location.href.endsWith('shell.html'));const cw=w.document.getElementById('systemapp').contentWindow.wrappedJSObject;
if(cw.__devWL){cw.__devWL.unlock();cw.__devWL=null;return 'released'}return 'none'})()'''
def release(r=None):
    r = r or RDP()
    return r.eval(r.target("parent"), RELEASE)

if __name__ == "__main__":
    import sys
    print(release() if sys.argv[1:] == ["release"] else wake())
