(() => {
"use strict";
const $=id=>document.getElementById(id);
const roomInput=$("roomInput"),linkText=$("linkText"),qualitySelect=$("qualitySelect");
const watchBtn=$("watchBtn"),shareBtn=$("shareBtn"),streamGrid=$("streamGrid");
const ICE_CONFIG={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]};
const MAX_SHARES=3;
let socket=null,room="",role="viewer",localStream=null,myId=null,shareCount=0;
const peers=new Map(),remoteTiles=new Map();
function preset(){const all={auto:{width:1920,height:1080,fps:30,bitrate:2800000,label:"1080p · 30 FPS"},p1080:{width:1920,height:1080,fps:30,bitrate:3500000,label:"1080p · 30 FPS"},fluid:{width:1920,height:1080,fps:60,bitrate:4500000,label:"1080p · 60 FPS"},p720:{width:1280,height:720,fps:30,bitrate:1800000,label:"720p · 30 FPS"},p480:{width:854,height:480,fps:24,bitrate:800000,label:"480p · 24 FPS"}};return all[qualitySelect.value]||all.auto}
function normalizeRoom(v){return String(v||"").toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,48)}
function currentRoom(){const v=normalizeRoom(roomInput.value);if(v.length<3){notice("Use um código de sala com pelo menos 3 caracteres.",true);return ""}roomInput.value=v;return v}
function roomUrl(){const u=new URL(location.href);u.searchParams.set("sala",normalizeRoom(roomInput.value)||"rrzin");return u.toString()}
function updateUrl(v){const u=new URL(location.href);u.searchParams.set("sala",v);history.replaceState({},"",u);linkText.textContent=u.toString()}
function setConnection(t,ok=false){$("connectionLabel").textContent=t;$("connectionDot").classList.toggle("connected",ok)}
function notice(t,error=false){$("notice").textContent=t;$("notice").classList.toggle("error",error)}
async function copyText(t){try{await navigator.clipboard.writeText(t);notice("Link copiado. Envie para quem vai entrar na sala.")}catch{notice("Não foi possível copiar automaticamente. Copie o link exibido.",true)}}
function signal(d){if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(d))}
function setShareCount(n){shareCount=Math.max(0,Math.min(MAX_SHARES,n));$("shareCount").textContent=shareCount+" / "+MAX_SHARES+" telas compartilhadas";$("shareCount").classList.toggle("limit-reached",shareCount>=MAX_SHARES)}
function clearRemoteTile(id){const t=remoteTiles.get(id);if(t){t.remove();remoteTiles.delete(id)}}
function addTile(id,title,stream,isLocal=false){
 let tile=isLocal? $("localTile"):remoteTiles.get(id);
 if(!tile){
  tile=document.createElement("article");tile.className="stream-tile";if(isLocal)tile.id="localTile";tile.dataset.peer=id;
  const video=document.createElement("video");video.autoplay=true;video.playsInline=true;
  const meta=document.createElement("div");meta.className="stream-meta";
  const name=document.createElement("strong");name.className="stream-name";name.textContent=title;
  const res=document.createElement("span");res.className="stream-resolution";res.textContent="Conectando…";
  meta.append(name,res);tile.append(video,meta);streamGrid.append(tile);if(!isLocal)remoteTiles.set(id,tile);
  video.addEventListener("loadedmetadata",()=>{if(video.videoWidth&&video.videoHeight)res.textContent=video.videoWidth+" × "+video.videoHeight});
 }
 const video=tile.querySelector("video");if(video.srcObject!==stream){video.srcObject=stream;video.play().catch(()=>{})}
 video.muted=isLocal;tile.querySelector(".stream-name").textContent=title;return tile;
}
function addLocalTile(){if(localStream)addTile("local","Sua tela (você)",localStream,true)}
function removeLocalTile(){const t=$("localTile");if(t)t.remove()}
function updateRoomStatus(){setShareCount([...peers.values()].filter(p=>p.role==="host"&&p.pc.connectionState==="connected").length+(localStream?1:0))}
function connect(nextRole,nextRoom){
 const old=socket;socket=null;if(old){old.onclose=null;old.close()}
 for(const [id,p] of peers){p.pc.close();peers.delete(id)}
 for(const id of [...remoteTiles.keys()])clearRemoteTile(id);
 myId=null;role=nextRole;room=nextRoom;updateUrl(room);setConnection("Conectando…");
 const protocol=location.protocol==="https:"?"wss:":"ws:",ws=new WebSocket(protocol+"//"+location.host+"/ws");socket=ws;
 ws.addEventListener("open",()=>ws.send(JSON.stringify({type:"join",room,role})));
 ws.addEventListener("message",async e=>{if(socket!==ws)return;let d;try{d=JSON.parse(e.data)}catch{return}try{await handleSignal(d)}catch(err){console.error(err);notice("Falha ao negociar uma tela. Tente entrar novamente.",true)}});
 ws.addEventListener("close",()=>{if(socket===ws)setConnection("Desconectado")});
 ws.addEventListener("error",()=>{if(socket===ws)notice("Não foi possível conectar ao servidor. Tente novamente.",true)});
}
function shouldConnect(peerRole){return role==="host"||peerRole==="host"}
function createPeer(id,peerRole,initiator){
 if(peers.has(id))return peers.get(id);if(!shouldConnect(peerRole))return null;
 const pc=new RTCPeerConnection(ICE_CONFIG),entry={pc,role:peerRole,candidates:[]};peers.set(id,entry);
 pc.onicecandidate=e=>{if(e.candidate)signal({type:"ice",to:id,candidate:e.candidate})};
 pc.onconnectionstatechange=()=>{if(pc.connectionState==="connected"){setConnection("Conectado à sala",true);updateRoomStatus()}if(["failed","closed"].includes(pc.connectionState)){dropPeer(id);updateRoomStatus()}};
 pc.ontrack=e=>{if(entry.role!=="host")return;const stream=e.streams&&e.streams[0];if(stream)addTile(id,"Tela compartilhada",stream)};
 if(localStream){for(const track of localStream.getTracks())pc.addTrack(track,localStream)}else pc.addTransceiver("video",{direction:"recvonly"});
 if(initiator)makeOffer(id,entry);return entry;
}
async function applyBitrate(entry){try{const sender=entry.pc.getSenders().find(s=>s.track&&s.track.kind==="video");if(!sender)return;const p=sender.getParameters();p.encodings=p.encodings&&p.encodings.length?p.encodings:[{}];p.encodings[0].maxBitrate=preset().bitrate;p.encodings[0].maxFramerate=preset().fps;await sender.setParameters(p)}catch(e){console.debug("Limites de bitrate não aplicados",e)}}
async function makeOffer(id,entry){try{await entry.pc.setLocalDescription(await entry.pc.createOffer());signal({type:"offer",to:id,description:entry.pc.localDescription})}catch(e){console.error(e);notice("Não foi possível iniciar uma conexão de vídeo.",true)}}
async function flushCandidates(entry){for(const c of entry.candidates.splice(0)){try{await entry.pc.addIceCandidate(c)}catch(e){console.debug("ICE candidate ignorado",e)}}}
async function handleSignal(d){
 switch(d.type){
 case "joined":myId=d.id;setConnection("Sala conectada",true);setShareCount(d.activeShares||0);$("viewerTitle").textContent=role==="host"?"Compartilhando sua tela":"Pronto para assistir";$("viewerSubtitle").textContent="Sala #"+room;notice("Sala conectada. Até 3 pessoas podem compartilhar simultaneamente.");break;
 case "peer-joined":if(myId&&shouldConnect(d.role)){createPeer(d.id,d.role,myId.localeCompare(d.id)<0);if(d.role==="host")setShareCount(Math.min(MAX_SHARES,shareCount+1))}break;
 case "offer":{const entry=createPeer(d.from,"host",false);if(!entry)break;await entry.pc.setRemoteDescription(d.description);await flushCandidates(entry);await entry.pc.setLocalDescription(await entry.pc.createAnswer());signal({type:"answer",to:d.from,description:entry.pc.localDescription});break}
 case "answer":{const entry=peers.get(d.from);if(entry&&entry.pc.signalingState==="have-local-offer"){await entry.pc.setRemoteDescription(d.description);await flushCandidates(entry);await applyBitrate(entry)}break}
 case "ice":{const entry=peers.get(d.from);if(entry&&d.candidate){if(entry.pc.remoteDescription){try{await entry.pc.addIceCandidate(d.candidate)}catch(e){console.debug("ICE candidate ignorado",e)}}else entry.candidates.push(d.candidate)}break}
 case "peer-left":dropPeer(d.id);clearRemoteTile(d.id);if(d.role==="host")setShareCount(Math.max(0,shareCount-1));setConnection("Sala conectada",true);notice(d.role==="host"?"Uma transmissão foi encerrada.":"Um participante saiu da sala.");break;
 case "host-stopped":clearRemoteTile(d.from);setShareCount(Math.max(0,shareCount-1));break;
 case "error":notice(d.message||"Ocorreu um erro.",true);setConnection("Atenção");if(d.code==="SHARE_LIMIT"){if(localStream)stopSharing(false,false);if(socket){const failed=socket;socket=null;failed.close()}role="viewer";setShareCount(MAX_SHARES)}break;
 }
}
function dropPeer(id){const p=peers.get(id);if(p){p.pc.close();peers.delete(id)}}
async function startSharing(){
 if(localStream){notice("Sua tela já está sendo compartilhada.");return}
 const r=currentRoom();if(!r)return;if(!navigator.mediaDevices?.getDisplayMedia){notice("Use uma versão atualizada do Chrome ou Edge.",true);return}
 try{
  const q=preset(),stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:q.width,max:q.width},height:{ideal:q.height,max:q.height},frameRate:{ideal:q.fps,max:q.fps},displaySurface:"monitor"},audio:true});
  localStream=stream;const track=stream.getVideoTracks()[0];if(track){track.contentHint=qualitySelect.value==="fluid"?"motion":"detail";track.addEventListener("ended",()=>stopSharing(true,true),{once:true)}
  addLocalTile();$("viewerTitle").textContent="Compartilhando sua tela";$("viewerSubtitle").textContent="A tela será enviada aos participantes";$("qualityBadge").textContent=q.label;
  connect("host",r);shareBtn.disabled=true;shareBtn.textContent="Compartilhando…";notice("Compartilhamento iniciado. Envie o link da sala.");
 }catch(err){if(err.name!=="NotAllowedError")notice("Não foi possível iniciar o compartilhamento. Confira as permissões do navegador.",true)}
}
function stopSharing(notifyPeers=true,reconnectViewer=true){
 if(notifyPeers)signal({type:"host-stopped"});if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}
 removeLocalTile();shareBtn.disabled=false;shareBtn.innerHTML="<span>▣</span> Compartilhar tela";
 if(reconnectViewer&&room){const r=room;connect("viewer",r);notice("Compartilhamento encerrado. Você continua na sala para assistir às outras telas.")}else{if(socket){const old=socket;socket=null;old.close()}role="viewer"}
 $("viewerTitle").textContent="Pronto para assistir";$("viewerSubtitle").textContent="Sala #"+room;$("qualityBadge").textContent="AO VIVO";updateRoomStatus();
}
watchBtn.addEventListener("click",()=>{const r=currentRoom();if(!r)return;if(localStream){notice("Você já está compartilhando; também pode receber outras telas.");return}connect("viewer",r);$("viewerTitle").textContent="Conectando à sala";$("viewerSubtitle").textContent="Sala #"+r;notice("Conectando às transmissões da sala…")});
shareBtn.addEventListener("click",startSharing);$("stopShareBtn").addEventListener("click",()=>{if(localStream)stopSharing(true,true)});
$("copyRoom").addEventListener("click",()=>copyText(roomUrl()));$("copyLink").addEventListener("click",()=>copyText(roomUrl()));
$("fullscreenBtn").addEventListener("click",()=>{const v=streamGrid.querySelector(".stream-tile video");if(v?.requestFullscreen)v.requestFullscreen().catch(()=>{})});
roomInput.addEventListener("input",()=>{const c=normalizeRoom(roomInput.value);if(roomInput.value!==c)roomInput.value=c;const u=new URL(location.href);u.searchParams.set("sala",c||"rrzin");linkText.textContent=u.toString()});
qualitySelect.addEventListener("change",async()=>{if(!localStream)return;const q=preset(),track=localStream.getVideoTracks()[0];try{await track.applyConstraints({width:{ideal:q.width,max:q.width},height:{ideal:q.height,max:q.height},frameRate:{ideal:q.fps,max:q.fps}})}catch(e){console.debug("Captura não aceitou as restrições",e)}for(const p of peers.values())await applyBitrate(p);$("qualityBadge").textContent=q.label;notice("Preferência de qualidade atualizada.")});
window.addEventListener("beforeunload",()=>{for(const p of peers.values())p.pc.close();if(socket)socket.close()});
roomInput.value=normalizeRoom(new URLSearchParams(location.search).get("sala")||"rrzin");updateUrl(roomInput.value);setShareCount(0);
})();