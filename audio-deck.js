/* Two paused/playing native elements behind one stable application audio handle. */
(() => {
 'use strict';
 const first=document.getElementById('audio');if(!first)return;
 const standalone=navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches;
 if(!standalone)return; // Preserve the regular-Safari playback path.
 const second=document.createElement('audio');second.id='audio-preload';second.preload='auto';second.setAttribute('playsinline','');second.hidden=true;document.body.append(second);
 const elements=[first,second],listeners=[];let active=first,prepared=null,handoff=null;
 const trace=stage=>window.LexiMusicDiagnostics?.record(stage);
 function remove(type,callback,options){const capture=typeof options==='boolean'?options:!!options?.capture;for(let i=listeners.length-1;i>=0;i--){const r=listeners[i];if(r.type===type&&r.callback===callback&&r.capture===capture){elements.forEach(el=>el.removeEventListener(type,r.wrapper,capture));listeners.splice(i,1)}}}
 function add(type,callback,options){const capture=typeof options==='boolean'?options:!!options?.capture;if(listeners.some(r=>r.type===type&&r.callback===callback&&r.capture===capture))return;
  const r={type,callback,capture,wrapper:null};r.wrapper=function(event){if(this!==active)return;if(options?.once)remove(type,callback,options);if(typeof callback==='function')callback.call(handle,event);else callback?.handleEvent(event)};listeners.push(r);elements.forEach(el=>el.addEventListener(type,r.wrapper,typeof options==='object'?{...options,once:false}:options));
 }
 const handle=new Proxy(first,{get(_,name){if(name==='play')return play; if(name==='pause')return pause; if(name==='addEventListener')return add;if(name==='removeEventListener')return remove;const value=active[name];return typeof value==='function'?value.bind(active):value},set(_,name,value){active[name]=value;return true}});
 function clear(){if(!prepared)return;const spare=prepared.element;prepared=null;spare.pause();spare.removeAttribute('src');spare.load()}
 function prepare(id,url){if(prepared?.id===id&&prepared.url===url)return;clear();const spare=elements.find(el=>el!==active);prepared={id,url,element:spare};spare.preload='auto';spare.muted=true;spare.src=url;spare.load();trace('native-preload-start')}
 for(const element of elements){element.addEventListener('pause',()=>{if(handoff?.old===element)trace('handoff-old-paused-before-clock')});element.addEventListener('canplay',()=>{if(prepared?.element===element)trace('native-preload-ready')});element.addEventListener('error',()=>{if(prepared?.element===element)trace('native-preload-error')})}
 function canActivate(id,url){return !!(prepared&&prepared.id===id&&(!url||prepared.url===url)&&prepared.element.readyState>=3&&!prepared.element.error&&!handoff)}
 function pause(){if(handoff){const current=handoff;current.cancel?.();current.old.pause()}active.pause()}
 function play(){
  if(!handoff)return active.play();
  const state=handoff;if(state.promise)return state.promise;
  const next=state.next,initial=next.currentTime||0;
  state.promise=new Promise((resolve,reject)=>{
   let settled=false;
   const cleanup=()=>{clearTimeout(timer);next.removeEventListener('timeupdate',progress);next.removeEventListener('playing',progress);next.removeEventListener('error',failed);if(handoff===state)handoff=null};
   const finish=(error)=>{if(settled)return;settled=true;cleanup();state.old.pause();state.old.removeAttribute('src');state.old.load();
    if(error){next.pause();trace(error.name==='AbortError'?'handoff-cancelled':'handoff-failed');reject(error)}else{trace('handoff-clock-advanced');resolve()}
   };
   const progress=()=>{if(!next.paused&&next.currentTime>initial+0.05)finish()};
   const failed=()=>finish(new Error('Prepared player reported a media error'));
   state.cancel=()=>finish(new DOMException('Handoff cancelled','AbortError'));
   const timer=setTimeout(()=>{trace('handoff-timeout');finish(new Error('Next song did not advance; playback stopped.'))},7000);
   next.addEventListener('timeupdate',progress);next.addEventListener('playing',progress);next.addEventListener('error',failed);
   trace('handoff-start-old-retained');
   try{Promise.resolve(next.play()).then(()=>{trace('handoff-play-resolved');progress()},error=>finish(error))}catch(error){finish(error)}
  });return state.promise;
 }
 function activate(id,url){if(!canActivate(id,url)){trace('native-preload-not-ready');return false}
  const old=active;active=prepared.element;prepared=null;active.muted=false;
  handoff={old,next:active,promise:null,cancel:null};trace('native-preload-adopted');return true;
 }
 window.LexiMusicAudio=handle;window.LexiMusicDeck=Object.freeze({prepare,activate,canActivate,clear});
})();
