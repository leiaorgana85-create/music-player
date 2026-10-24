(() => {
 'use strict';
 const KEY='lexiMusicPlaybackDiagnosticsV1';
 let records=[];try{records=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(records))records=[]}catch(_){}
 const audio=window.LexiMusicAudio || document.getElementById('audio');
 function record(stage){
  const entry={at:new Date().toISOString(),stage,visible:document.visibilityState,online:navigator.onLine,standalone:navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches};
  if(audio)Object.assign(entry,{time:Math.round((audio.currentTime||0)*10)/10,paused:audio.paused,ended:audio.ended,muted:audio.muted,ready:audio.readyState,network:audio.networkState,sourceKind:audio.currentSrc?.startsWith('blob:')?'blob':audio.currentSrc?.includes('/__offline_audio/')?'local-media-url':'other',error:audio.error?.code||0});
  records.push(entry);records=records.slice(-300);try{localStorage.setItem(KEY,JSON.stringify(records))}catch(_){}
 }
 window.LexiMusicDiagnostics=Object.freeze({record});
 for(const name of ['play','playing','pause','ended','waiting','stalled','canplay','error','emptied','loadedmetadata'])audio?.addEventListener(name,()=>record('audio:'+name));
 let lastTime=0;audio?.addEventListener('timeupdate',()=>{if(Date.now()-lastTime>5000){lastTime=Date.now();record('audio:progress')}});
 document.addEventListener('visibilitychange',()=>record('visibility'));window.addEventListener('pageshow',()=>record('pageshow'));
 async function share(){
  const file=new File([JSON.stringify({build:'retained-session-v1',userAgent:navigator.userAgent,events:records},null,2)],'lexi-music-playback-log.json',{type:'application/json'});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file]});return}catch(e){if(e.name==='AbortError')return}}
  const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 function addButton(){const dialog=document.getElementById('settingsDialog');if(!dialog||document.getElementById('sharePlaybackLog'))return;const b=document.createElement('button');b.id='sharePlaybackLog';b.type='button';b.className='button secondary';b.textContent='Share playback test log · v4';b.addEventListener('click',share);dialog.append(b)}
 document.getElementById('settingsBtn')?.addEventListener('click',()=>setTimeout(addButton,0));
 record('diagnostics-ready');
})();
