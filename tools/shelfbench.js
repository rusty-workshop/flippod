(async()=>{const K=(__fp.__sd=!__fp.__sd)?'ArrowLeft':'ArrowRight';const fr=[];let last=performance.now(),on=true;const f=(t)=>{fr.push(t-last);last=t;if(on)requestAnimationFrame(f)};requestAnimationFrame(f);
const ev=(t,k,rep)=>window.dispatchEvent(new KeyboardEvent(t,{key:k,bubbles:true,repeat:!!rep}));
for(let j=0;j<6;j++){ev('keydown',K);await new Promise(r=>setTimeout(r,30));ev('keyup',K);await new Promise(r=>setTimeout(r,250));}
ev('keydown',K);for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,55));ev('keydown',K,true)}ev('keyup',K);
await new Promise(r=>setTimeout(r,700));on=false;const s=fr.slice(2).sort((a,b)=>a-b);
return JSON.stringify({view:__fp.stack.top.title,frames:s.length,p50:s[s.length>>1].toFixed(1), p90:s[Math.floor(s.length*.9)].toFixed(1), max:s[s.length-1].toFixed(1)})})()
