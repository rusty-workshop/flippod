#!/usr/bin/env python3
"""Inject outer/flippod_outer.{css,js} into the running outer-screen page (non-persistent, for testing)."""
import json, pathlib, sys
from rdp import RDP
root = pathlib.Path(__file__).resolve().parent.parent / 'outer'
css = (root / 'flippod_outer.css').read_text()
js = (root / 'flippod_outer.js').read_text()
r = RDP()
JS = '''(()=>{const ws=[];const e=Services.wm.getEnumerator(null);while(e.hasMoreElements())ws.push(e.getNext());const w=ws.find(x=>x.location.href.includes('shell_remote'));
const g=w.document.getElementById('systemapp').contentWindow;const d=g.document;
const old=d.getElementById('fp-outer');if(old)old.remove();const os=d.getElementById('fp-css');if(os)os.remove();
const st=d.createElement('style');st.id='fp-css';st.textContent=%s;d.head.appendChild(st);
g.eval(%s);return 'injected'})()''' % (json.dumps(css), json.dumps(js))
print(r.eval(r.target('parent'), JS))
