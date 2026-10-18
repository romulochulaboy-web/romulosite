(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const roomInput=$("roomInput"), remoteVideo=$("remoteVideo"), videoStage=$("videoStage"), linkText=$("linkText"), qualitySelect=$("qualitySelect");
const watchBtn=$("watchBtn"), shareBtn=$("shareBtn");
const ICE_CONFIG={iceServers:[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]};
let socket=null,room="",role=null,localStream=null,hostId=null;
const peers=new Map();
function qualityPreset(){const presets={auto:{width:1920,height:1080,fps:30,bitrate:3500000,label:"1080P · 30 FPS"},p1080:{width:1920,height:1080,fps:30,bitrate:5000000,label:"1080P · 30 FPS"},p720:{width:1280,height:720,fps:30,bitrate:2500000,label:"720P · 30 FPS"},fluid:{width:1920,height:1080,fps:60,bitrate:6000000,label:"1080P · 60 FPS"},p480:{width:854,height:480,fps:24,bitrate:1200000,label:"480P · 24 FPS"}};return presets[qualitySelect?.value]||presets.auto}
function normalizeRoom(value){return String(value||"").toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,48)}
function currentRoom(){const value=normalizeRoom(roomInput.value);if(value.length<3){showNotice("Use um código de sala com pelo menos 3 caracteres.",true);return ""}roomInput.value=value;return value}
function roomUrl(){const u=new URL(location.href);u.searchParams.set("sala",normalizeRoom(roomInput.value)||"rrzin");return u.toString()}
function updateUrl(value){const u=new URL(location.href);u.searchParams.set("sala",value);history.replaceState({}, "",u);linkText.textContent=u.toString()}
function setConnection(text,ok=false){$("connectionLabel").textContent=text;$("connectionLabel").previousElementSibling.style.background=ok?"#65dba0":"#7e6aff"}
function showNotice(text,error=false){const el=$("notice");el.textContent=text;el.classList.toggle("error",error)}
async function copyText(text){try{await navigator.clipboard.writeText(text);showNotice("Link copiado. Compartilhe com quem vai assistir.");}catch{showNotice("Não foi possível copiar automaticamente. Copie o link exibido.",true)}}
function signal(data){if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data))}
function connect(nextRole,nextRoom){
 if(socket){const oldSocket=socket;socket=null;oldSocket.close()}
 for(const [id,p] of peers){p.pc.close();peers.delete(id)}
 role=nextRole;room=nextRoom;hostId=null;updateUrl(room);setConnection("Conectando…");
 const protocol=location.protocol==="https:"?"wss:":"ws:";
 socket=new WebSocket(protocol+"//"+location.host+"/ws");
 const thisSocket=socket;
 socket.addEventListener("open",()=>socket.send(JSON.stringify({type:"join",room,role})));
 socket.addEventListener("message",async(event)=>{if(socket!==thisSocket)return;let data;try{data=JSON.parse(event.data)}catch{return}try{await handleSignal(data)}catch(err){console.error(err);showNotice("Falha ao negociar a transmissão. Tente entrar novamente.",true)}});
 socket.addEventListener("close",()=>{if(socket!==thisSocket)return;setConnection("Desconectado");if(role==="host")stopSharing(false)});
 socket.addEventListener("error",()=>{if(socket===thisSocket)showNotice("Não foi possível conectar ao servidor. Tente novamente.",true)});
}
function createPeer(peerId,initiator){
 if(peers.has(peerId))return peers.get(peerId);
 const pc=new RTCPeerConnection(ICE_CONFIG),entry={pc,remoteCandidates:[]};peers.set(peerId,entry);
 pc.onicecandidate=e=>{if(e.candidate)signal({type:"ice",to:peerId,candidate:e.candidate})};
 pc.onconnectionstatechange=()=>{if(pc.connectionState==="connected"){setConnection("Transmissão conectada",true);$("streamStatus").textContent="Recebendo transmissão"}if(["failed","closed"].includes(pc.connectionState))dropPeer(peerId)};
 pc.ontrack=e=>{if(role!=="viewer")return;remoteVideo.srcObject=e.streams[0];remoteVideo.play().catch(()=>{});videoStage.classList.add("has-video");$("videoOverlay").classList.remove("hidden");$("videoRoomLabel").textContent="#"+room;$("viewerTitle").textContent="Transmissão ao vivo";$("viewerSubtitle").textContent="Sala "+room;$("streamStatus").textContent="Recebendo transmissão";$("qualityBadge").textContent="WEBRTC";setConnection("Conectado",true);updateResolution()};
 if(role==="host"&&localStream){localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));for(const sender of pc.getSenders()){if(sender.track&&sender.track.kind==="video"){const p=sender.getParameters();const preset=qualityPreset();p.encodings=[{...(p.encodings&&p.encodings[0]),maxBitrate:preset.bitrate,maxFramerate:preset.fps}];sender.setParameters(p).catch(()=>{})}}}
 if(initiator)makeOffer(peerId,entry);return entry
}
async function makeOffer(id,entry){try{await entry.pc.setLocalDescription(await entry.pc.createOffer());signal({type:"offer",to:id,description:entry.pc.localDescription})}catch(e){console.error(e);showNotice("Não foi possível iniciar a conexão com um espectador.",true)}}
async function flushCandidates(entry){for(const c of entry.remoteCandidates.splice(0)){try{await entry.pc.addIceCandidate(c)}catch(e){console.debug("ICE candidate ignorado",e)}}}
async function handleSignal(data){
 switch(data.type){
 case "joined":setConnection("Sinalização conectada",true);if(role==="host"){ $("viewerTitle").textContent="Sua tela";$("viewerSubtitle").textContent="Aguardando espectadores";$("streamStatus").textContent="Transmissão pronta";showNotice("Sala #"+room+" criada. Envie o link para seus amigos.")}else if(!data.hostPresent){$("viewerTitle").textContent="Aguardando transmissão";$("viewerSubtitle").textContent="Você entrou na sala "+room;showNotice("Você entrou na sala. Aguardando o anfitrião compartilhar a tela.")}break;
 case "peer-joined":if(role==="host"&&localStream)createPeer(data.id,true);break;
 case "host-present":hostId=data.id;break;
 case "offer":if(role!=="viewer")break;hostId=data.from;{const entry=createPeer(data.from,false);await entry.pc.setRemoteDescription(data.description);await flushCandidates(entry);await entry.pc.setLocalDescription(await entry.pc.createAnswer());signal({type:"answer",to:data.from,description:entry.pc.localDescription})}break;
 case "answer":{const entry=peers.get(data.from);if(entry&&entry.pc.signalingState==="have-local-offer"){await entry.pc.setRemoteDescription(data.description);await flushCandidates(entry)}}break;
 case "ice":{const entry=peers.get(data.from);if(entry&&data.candidate){if(entry.pc.remoteDescription)try{await entry.pc.addIceCandidate(data.candidate)}catch(e){console.debug("ICE candidate ignorado",e)}else entry.remoteCandidates.push(data.candidate)}}break;
 case "peer-left":dropPeer(data.id);if(role==="viewer"&&data.role==="host"){remoteVideo.srcObject=null;videoStage.classList.remove("has-video");$("videoOverlay").classList.add("hidden");$("streamStatus").textContent="Transmissão encerrada";$("viewerTitle").textContent="Transmissão encerrada";$("viewerSubtitle").textContent="O anfitrião saiu da sala";setConnection("Aguardando anfitrião")}break;
 case "host-stopped":if(role==="viewer"){remoteVideo.srcObject=null;videoStage.classList.remove("has-video");$("videoOverlay").classList.add("hidden");$("streamStatus").textContent="Transmissão encerrada";$("viewerTitle").textContent="Transmissão encerrada";setConnection("Aguardando anfitrião")}break;
 case "error":showNotice(data.message||"Ocorreu um erro.",true);setConnection("Atenção");break;
 }
}
function dropPeer(id){const entry=peers.get(id);if(entry){entry.pc.close();peers.delete(id)}}
function updateResolution(){const track=remoteVideo.srcObject&&remoteVideo.srcObject.getVideoTracks()[0];if(!track)return;const s=track.getSettings();if(s.width&&s.height)$("resolutionLabel").textContent=s.width+" × "+s.height}
async function startSharing(){
 const selectedRoom=currentRoom();if(!selectedRoom)return;
 if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){showNotice("Seu navegador não oferece captura de tela. Use Chrome ou Edge atualizado.",true);return}
 try{
  const preset=qualityPreset();
  localStream=await navigator.mediaDevices.getDisplayMedia({video:{width:{max:preset.width},height:{max:preset.height},frameRate:{ideal:preset.fps,max:preset.fps},displaySurface:"monitor"},audio:true});
  const track=localStream.getVideoTracks()[0];if(track){track.contentHint=qualitySelect.value==="fluid"?"motion":"detail";track.addEventListener("ended",()=>stopSharing(true),{once:true})}
  remoteVideo.srcObject=localStream;remoteVideo.muted=true;videoStage.classList.add("has-video");$("videoOverlay").classList.remove("hidden");$("videoRoomLabel").textContent="#"+selectedRoom;$("viewerTitle").textContent="Sua tela (prévia local)";$("viewerSubtitle").textContent="Você está compartilhando";$("streamStatus").textContent="Transmitindo sua tela";$("qualityBadge").textContent=preset.label;$("resolutionLabel").textContent="Transmissão ativa";connect("host",selectedRoom);showNotice("Tela compartilhada. Envie o link da sala para seus amigos.")
 }catch(err){if(err.name!=="NotAllowedError")showNotice("Não foi possível iniciar o compartilhamento. Verifique as permissões do navegador.",true)}
}
function stopSharing(notify=true){
 if(notify)signal({type:"host-stopped"});
 for(const p of peers.values())p.pc.close();peers.clear();
 if(localStream)localStream.getTracks().forEach(t=>t.stop());localStream=null;remoteVideo.srcObject=null;remoteVideo.muted=false;videoStage.classList.remove("has-video");$("videoOverlay").classList.add("hidden");$("streamStatus").textContent="Nenhuma transmissão";$("resolutionLabel").textContent="Aguardando sinal";$("viewerTitle").textContent="Prévia da transmissão";$("viewerSubtitle").textContent="Aguardando alguém compartilhar a tela";
 if(notify){if(socket)socket.close();setConnection("Pronto para conectar");showNotice("Compartilhamento encerrado.")}
}
watchBtn.addEventListener("click",()=>{const r=currentRoom();if(!r)return;if(localStream)stopSharing(true);connect("viewer",r);$("viewerTitle").textContent="Conectando à sala";$("viewerSubtitle").textContent="Sala "+r;$("streamStatus").textContent="Conectando…"});
shareBtn.addEventListener("click",startSharing);
$("copyRoom").addEventListener("click",()=>copyText(roomUrl()));$("copyLink").addEventListener("click",()=>copyText(roomUrl()));
$("fullscreenBtn").addEventListener("click",()=>{if(videoStage.requestFullscreen)videoStage.requestFullscreen().catch(()=>{})});
roomInput.addEventListener("input",()=>{const clean=normalizeRoom(roomInput.value);if(roomInput.value!==clean)roomInput.value=clean;const u=new URL(location.href);u.searchParams.set("sala",clean||"rrzin");linkText.textContent=u.toString()});
window.addEventListener("beforeunload",()=>{for(const p of peers.values())p.pc.close();if(socket)socket.close()});
roomInput.value=normalizeRoom(new URLSearchParams(location.search).get("sala")||"rrzin");updateUrl(roomInput.value);
remoteVideo.addEventListener("loadedmetadata",updateResolution);
})();