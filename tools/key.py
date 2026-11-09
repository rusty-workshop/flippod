#!/usr/bin/env python3
"""Send key presses into the running Flippod (or another app tab).
Usage: key.py [--tab flippod.localhost] Down Down Enter hold:Right:20 wait:500
Key names: Up Down Left Right Enter Back SoftLeft SoftRight Call EndCall 0-9
"""
import sys
from rdp import RDP
from wake import wake
ALIAS = {"Up": "ArrowUp", "Down": "ArrowDown", "Left": "ArrowLeft", "Right": "ArrowRight", "Back": "Backspace"}
args = sys.argv[1:]
tab = "flippod.localhost"
if args and args[0] == "--tab":
    tab, args = args[1], args[2:]
steps = []
for a in args:
    if a.startswith("wait:"):
        steps.append(f"await new Promise(r=>setTimeout(r,{int(a[5:])}));")
    elif a.startswith("hold:"):
        _, k, n = a.split(":")
        k = ALIAS.get(k, k)
        steps.append(f"await hold({k!r},{int(n)});")
    else:
        k = ALIAS.get(a, a)
        steps.append(f"await press({k!r});")
js = """
(async()=>{
const ev=(t,k,rep)=>{const e=new KeyboardEvent(t,{key:k,bubbles:true,cancelable:true,repeat:!!rep});(document.activeElement||document.body).dispatchEvent(e);};
const press=async(k)=>{ev('keydown',k);await new Promise(r=>setTimeout(r,40));ev('keyup',k);await new Promise(r=>setTimeout(r,180));};
const hold=async(k,n)=>{ev('keydown',k);for(let i=0;i<n;i++){await new Promise(r=>setTimeout(r,60));ev('keydown',k,true);}ev('keyup',k);await new Promise(r=>setTimeout(r,200));};
%s
return 'ok';})()
""" % "\n".join(steps)
r = RDP()
wake(r)
print(r.eval(r.target(tab), js))
