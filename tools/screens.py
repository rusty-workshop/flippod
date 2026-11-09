#!/usr/bin/env python3
"""Capture marketing screenshots of every main screen (both displays) into docs/img/."""
import base64, pathlib
from rdp import RDP
from wake import wake, release

OUT = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'img'
OUT.mkdir(parents=True, exist_ok=True)
r = RDP()
wake(r)
app = r.target('launcher.localhost')
par = r.target('parent')

SNAP = r'''(async () => {
  const ws=[];const e=Services.wm.getEnumerator(null);while(e.hasMoreElements())ws.push(e.getNext());
  const w = ws.find(x => x.location.href.includes(WHICH));
  const bmp = await w.browsingContext.currentWindowGlobal.drawSnapshot(new w.DOMRect(0,0,w.innerWidth,w.innerHeight), 1, "black");
  const c = w.document.createElementNS("http://www.w3.org/1999/xhtml","canvas"); c.width=bmp.width; c.height=bmp.height;
  c.getContext("2d").drawImage(bmp,0,0); return c.toDataURL("image/png"); })()'''

def shot(name, outer=False):
    d = r.eval(par, SNAP.replace('WHICH', repr('shell_remote' if outer else 'shell.html')))
    (OUT / f'{name}.png').write_bytes(base64.b64decode(d.split(',', 1)[1]))
    print('saved', name)

def nav(steps, wait=1100):
    js = ("(async()=>{const s=__fp.stack;const W=ms=>new Promise(r=>setTimeout(r,ms));"
          "const ent=async(i)=>{s.top.lv.select(i,false);s.top.lv.o.onEnter(s.top.lv.selected);await W(500)};"
          "while(s.depth>1)s.pop(false);s.top.reload();" + steps + f"await W({wait});return s.views.map(v=>v.title).join('>')}})()")
    print(r.eval(app, js))

r.eval(app, '''(async()=>{const L=__fp.library,P=__fp.player;const t=L.tracks.find(x=>x.lrc&&/Turn the Lights Off/.test(x.title));
await P.playList(L.songs.map(x=>x.id),L.songs.indexOf(t),{shuffle:false});P.pause();P.seek(62);__fp.settings.set("lyricsView",false);return 1})()''')
nav('s.top.lv.select(0,false);', 2500); shot('main')
nav('await ent(0);await ent(0);'); shot('artists')
nav('await ent(s.top.lv.items.length-1);', 1500); shot('nowplaying')
r.eval(app, '(async()=>{__fp.settings.set("lyricsView",true);const np=__fp.stack.top;np._applyLyrMode();np.lineIdx=-2;np.tick(true);await new Promise(r=>setTimeout(r,900));return 1})()')
shot('lyrics')
r.eval(app, '__fp.settings.set("lyricsView",false);1')
nav('await ent(2);s.top.go(30);', 1400); shot('shelf')
nav('await ent(5);await ent(0);', 1200); shot('bluetooth')
nav('s.top.lv.select(0,false);', 300)

OUTER = r'''(async()=>{const ws=[];const e=Services.wm.getEnumerator(null);while(e.hasMoreElements())ws.push(e.getNext());
const w=ws.find(x=>x.location.href.includes("shell_remote"));const g=w.document.getElementById("systemapp").contentWindow.wrappedJSObject;
const d=g.document;const so=d.querySelector(".screenoff");so&&so.classList.remove("screenoff");const o=g.__flippodOuter;
const np=Object.assign({},o.np,PATCH);
g.SettingsObserver.setValue(Cu.cloneInto([{name:"flippod.np",value:np},{name:"flippod.stats",value:{day:STATSDAY,min:47,songs:12,top:"Tally Hall"}}],g));
await new Promise(r=>w.setTimeout(r,1500));o.setMode("");o.render();return d.getElementById("fp-outer").dataset.mode})()'''
day = r.eval(app, '(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`})()')
print(r.eval(par, OUTER.replace('PATCH', '{playing:false,pausedAt:0}').replace('STATSDAY', repr(day)))); shot('lid-clock', True)
print(r.eval(par, OUTER.replace('PATCH', '{playing:true,at:Date.now(),pos:62}').replace('STATSDAY', repr(day)))); shot('lid-np', True)
r.eval(app, '__fp.player.pause();1')
release(r)
