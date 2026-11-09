import sys
import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from rdp import RDP
from wake import wake
tpl = open(sys.argv[1]).read()
r = RDP(); wake(r)
t = r.target('flippod.localhost')
r.eval(t, "window.__dbg=document.getElementById('dbg')||document.head.appendChild(Object.assign(document.createElement('style'),{id:'dbg'}));1")
for arg in sys.argv[2:]:
    name, css = arg.split('=', 1)
    r.eval(t, "window.__dbg.textContent=%r;1" % css)
    print(name, r.eval(t, tpl))
r.eval(t, "window.__dbg.textContent='';1")
