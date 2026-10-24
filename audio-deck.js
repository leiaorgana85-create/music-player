/* Two paused/playing native elements behind one stable application audio handle. */
(() => {
 'use strict';
 const first=document.getElementById('audio');if(!first)return;
 const standalone=navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches;
 if(!standalone)return; // Preserve the regular-Safari playback path.
 const second=document.createElement('audio');second.id='audio-preload';second.preload='auto';second.setAttribute('playsinline','');second.hidden=true;document.body.append(second);
 const elements=[first,second],listeners=[];let active=first,prepared=null;
 const trace=stage=>window.LexiMusicDiagnostics?.record(stage);
 function remove(type,callback,options){const capture=typeof options==='boolean'?options:!!options?.capture;for(let i=listeners.length-1;i>=0;i--){const r=listeners[i];if(r.type===type&&r.callback===callback&&r.capture===capture){elements.forEach(el=>el.removeEventListener(type,r.wrapper,capture));listeners.splice(i,1)}}}
 function add(type,callback,options){const capture=typeof options==='boolean'?options:!!options?.capture;if(listeners.some(r=>r.type===type&&r.callback===callback&&r.capture===capture))return;
  const r={type,callback,capture,wrapper:null};r.wrapper=function(event){if(this!==active)return;if(options?.once)remove(type,callback,options);if(typeof callback==='function')callback.call(handle,event);else callback?.handleEvent(event)};listeners.push(r);elements.forEach(el=>el.addEventListener(type,r.wrapper,typeof options==='object'?{...options,once:false}:options));
 }
 const handle=new Proxy(first,{get(_,name){if(name==='addEventListener')return add;if(name==='removeEventListener')return remove;const value=active[name];return typeof value==='function'?value.bind(active):value},set(_,name,value){active[name]=value;return true}});
 function clear(){if(!prepared)return;const spare=prepared.element;prepared=null;spare.pause();spare.removeAttribute('src');spare.load()}
 function prepare(id,url){if(prepared?.id===id&&prepared.url===url)return;clear();const spare=elements.find(el=>el!==active);prepared={id,url,element:spare};spare.preload='auto';spare.muted=true;spare.src=url;spare.load();trace('native-preload-start')}
 for(const element of elements){element.addEventListener('canplay',()=>{if(prepared?.element===element)trace('native-preload-ready')});element.addEventListener('error',()=>{if(prepared?.element===element)trace('native-preload-error')})}
 function activate(id,url){const entry=prepared;if(!entry||entry.id!==id||entry.url!==url||entry.element.readyState<3||entry.element.error){trace('native-preload-not-ready');return false}
  const old=active;old.pause();active=entry.element;prepared=null;active.muted=false;
  // The previous element cannot emit state changes into the active player.
  old.removeAttribute('src');old.load();trace('native-preload-adopted');return true;
 }
 window.LexiMusicAudio=handle;window.LexiMusicDeck=Object.freeze({prepare,activate,clear});
})();
