import sys
import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from rdp import RDP
from wake import wake
tpl = open('hold.js').read()
r = RDP(); wake(r)
t = r.target('flippod.localhost')
r.eval(t, "window.__dbg=document.getElementById('dbg')||document.head.appendChild(Object.assign(document.createElement('style'),{id:'dbg'}));1")
for name, css in ([('baseline', '')] if len(sys.argv) > 1 else []) + [(a, b) for a, b in (x.split('=', 1) for x in sys.argv[1:])]:
    setup = "window.__dbg.textContent=%r;" % css
    print(name, r.eval(t, tpl.replace('__SETUP__', setup)))
r.eval(t, "window.__dbg.textContent='';1")
