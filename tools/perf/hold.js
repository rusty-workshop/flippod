(async()=>{__SETUP__
const fr=[];let last=performance.now(),on=true;const f=(t)=>{fr.push(t-last);last=t;if(on)requestAnimationFrame(f)};requestAnimationFrame(f);
const ev=(t,k,rep)=>window.dispatchEvent(new KeyboardEvent(t,{key:k,bubbles:true,repeat:!!rep}));
const K=(__fp.__dir=!__fp.__dir)?'ArrowDown':'ArrowUp';
ev('keydown',K);for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,55));ev('keydown',K,true)}ev('keyup',K);
await new Promise(r=>setTimeout(r,500));on=false;const s=fr.slice(2).sort((a,b)=>a-b);
return JSON.stringify({p50:s[s.length>>1].toFixed(1), p90:s[Math.floor(s.length*.9)].toFixed(1)})})()
