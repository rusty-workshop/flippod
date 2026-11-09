#!/usr/bin/env python3
"""Screenshot the KaiOS screen via the parent process. Usage: shot.py out.png [outer]"""
import sys, base64
from rdp import RDP
from wake import wake
JS = r'''
(async () => {
  const ws=[];const e=Services.wm.getEnumerator(null);while(e.hasMoreElements())ws.push(e.getNext());
  const w = ws.find(x => x.location.href.includes(WHICH));
  const bc = w.browsingContext;
  const rect = new w.DOMRect(0, 0, w.innerWidth, w.innerHeight);
  const bmp = await bc.currentWindowGlobal.drawSnapshot(rect, 1, "black");
  const c = w.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c.toDataURL("image/png");
})()
'''
r = RDP()
wake(r)
which = "shell_remote" if len(sys.argv) > 2 and sys.argv[2] == "outer" else "shell.html"
d = r.eval(r.target("parent"), JS.replace("WHICH", repr(which)))
if not str(d).startswith("data:"): raise SystemExit(d)
open(sys.argv[1], "wb").write(base64.b64decode(d.split(",", 1)[1]))
print("saved", sys.argv[1])
