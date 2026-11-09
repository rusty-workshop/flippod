(async()=>{const KEY=__KEY__, N=__N__;
const fr=[];let last=performance.now(),on=true;const f=(t)=>{fr.push(t-last);last=t;if(on)requestAnimationFrame(f)};requestAnimationFrame(f);
const ev=(t,k,rep)=>window.dispatchEvent(new KeyboardEvent(t,{key:k,bubbles:true,repeat:!!rep}));
for(let i=0;i<N;i++){ev('keydown',KEY);await new Promise(r=>setTimeout(r,40));ev('keyup',KEY);await new Promise(r=>setTimeout(r,140));}
await new Promise(r=>setTimeout(r,400));on=false;
const s=fr.slice(2).sort((a,b)=>a-b);
return JSON.stringify({view:__fp.stack.top.title, frames:s.length, p50:s[s.length>>1].toFixed(1), p90:s[Math.floor(s.length*.9)].toFixed(1), max:s[s.length-1].toFixed(1)})})()
