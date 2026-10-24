/* Worker-only access to existing downloads. Never fetch private audio from network. */
(() => {
 'use strict';
 function readAudio(id){return new Promise((resolve,reject)=>{
  const request=indexedDB.open('music-pwa-audio-db',1);let db,settled=false;
  const finish=(error,row)=>{if(settled)return;settled=true;try{db?.close()}catch(_){}error?reject(error):resolve(row)};
  request.onupgradeneeded=()=>{request.transaction.abort()};
  request.onerror=()=>finish(request.error||Error('Offline audio database unavailable'));
  request.onblocked=()=>finish(Error('Offline audio database blocked'));
  request.onsuccess=()=>{db=request.result;if(settled){db.close();return}db.onversionchange=()=>db.close();
   try{const tx=db.transaction('audio','readonly'),get=tx.objectStore('audio').get(id);let row;
    get.onsuccess=()=>{row=get.result};
    tx.oncomplete=()=>finish(null,row);tx.onerror=()=>finish(tx.error||Error('Read failed'));tx.onabort=()=>finish(tx.error||Error('Read aborted'));
   }catch(error){finish(error)}
  };
 })}
 function audioBlob(row){const value=row?.blob;if(value instanceof Blob)return value;if(value?.__musicBytes instanceof ArrayBuffer)return new Blob([value.__musicBytes],{type:value.type||'application/octet-stream'});if(value instanceof ArrayBuffer||ArrayBuffer.isView(value))return new Blob([value],{type:'application/octet-stream'});return null}
 function respond(blob,request){
  const headers={'Content-Type':blob.type||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const range=request.headers.get('range');let start=0,end=blob.size-1,status=200;
  if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
   const invalid=()=>new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${blob.size}`,'Content-Length':'0'}});
   if(!match||(!match[1]&&!match[2])||!blob.size)return invalid();
   if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return invalid();start=Math.max(0,blob.size-suffix)}
   else {start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end)}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=blob.size||end<start)return invalid();
   status=206;headers['Content-Range']=`bytes ${start}-${end}/${blob.size}`;
  }
  const body=range?blob.slice(start,end+1):blob;headers['Content-Length']=String(body.size);
  return new Response(request.method==='HEAD'?null:body,{status,headers});
 }
 self.LexiOfflineAudio={readAudio,audioBlob,respond,async handle(request,id){
  try{const blob=audioBlob(await readAudio(id));return blob?respond(blob,request):new Response('Downloaded song unavailable',{status:404,headers:{'Cache-Control':'no-store'}})}
  catch(_){return new Response('Offline audio read failed',{status:503,headers:{'Cache-Control':'no-store'}})}
 }};
})();
