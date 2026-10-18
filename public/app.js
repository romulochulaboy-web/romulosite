(() => {
"use strict";
const $ = id => document.getElementById(id);
const roomInput = $("roomInput"), linkText = $("linkText"), qualitySelect = $("qualitySelect");
const watchBtn = $("watchBtn"), shareBtn = $("shareBtn"), streamGrid = $("streamGrid");
const MAX_SHARES = 3;
const ICE_CONFIG = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
] };
let socket = null, room = "", role = "viewer", localStream = null, myId = null, shareCount = 0;
const peers = new Map(), remoteTiles = new Map();
const statsTimer = setInterval(monitorConnections, 2500);

function preset() {
  const choices = {
    auto: { width: 1920, height: 1080, fps: 30, bitrate: 2200000, aggregateBitrate: 4200000, label: "1080p · 30 FPS" },
    p1080: { width: 1920, height: 1080, fps: 30, bitrate: 3000000, aggregateBitrate: 5000000, label: "1080p · 30 FPS" },
    fluid: { width: 1920, height: 1080, fps: 60, bitrate: 3500000, aggregateBitrate: 5000000, label: "1080p · 60 FPS" },
    p720: { width: 1280, height: 720, fps: 30, bitrate: 1500000, aggregateBitrate: 3200000, label: "720p · 30 FPS" },
    p480: { width: 854, height: 480, fps: 24, bitrate: 650000, aggregateBitrate: 1800000, label: "480p · 24 FPS" }
  };
  return choices[qualitySelect.value] || choices.auto;
}
function normalizeRoom(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48); }
function currentRoom() {
  const value = normalizeRoom(roomInput.value);
  if (value.length < 3) { notice("Use um código de sala com pelo menos 3 caracteres.", true); return ""; }
  roomInput.value = value;
  return value;
}
function roomUrl() { const u = new URL(location.href); u.searchParams.set("sala", normalizeRoom(roomInput.value) || "rrzin"); return u.toString(); }
function updateUrl(value) { const u = new URL(location.href); u.searchParams.set("sala", value); history.replaceState({}, "", u); linkText.textContent = u.toString(); }
function setConnection(value, connected = false) { $("connectionLabel").textContent = value; $("connectionDot").classList.toggle("connected", connected); }
function notice(value, error = false) { $("notice").textContent = value; $("notice").classList.toggle("error", error); }
async function copyText(value) {
  try { await navigator.clipboard.writeText(value); notice("Link copiado. Envie para quem vai entrar na sala."); }
  catch { notice("Não foi possível copiar automaticamente. Copie o link exibido.", true); }
}
function signal(data) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function setShareCount(value) {
  shareCount = Math.max(0, Math.min(MAX_SHARES, value));
  $("shareCount").textContent = shareCount + " / " + MAX_SHARES + " telas compartilhadas";
  $("shareCount").classList.toggle("limit-reached", shareCount >= MAX_SHARES);
}
function clearRemoteTile(id) { const tile = remoteTiles.get(id); if (tile) { tile.remove(); remoteTiles.delete(id); } }
function addTile(id, title, stream, isLocal = false) {
  let tile = isLocal ? $("localTile") : remoteTiles.get(id);
  if (!tile) {
    tile = document.createElement("article");
    tile.className = "stream-tile";
    if (isLocal) tile.id = "localTile";
    tile.dataset.peer = id;
    const video = document.createElement("video");
    video.autoplay = true; video.playsInline = true; video.muted = true;
    const meta = document.createElement("div"); meta.className = "stream-meta";
    const name = document.createElement("strong"); name.className = "stream-name"; name.textContent = title;
    const resolution = document.createElement("span"); resolution.className = "stream-resolution"; resolution.textContent = "Conectando…";
    meta.append(name, resolution); tile.append(video, meta); streamGrid.append(tile);
    if (!isLocal) remoteTiles.set(id, tile);
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth && video.videoHeight) resolution.textContent = video.videoWidth + " × " + video.videoHeight;
    });
    video.addEventListener("stalled", () => { video.play().catch(() => {}); });
  }
  const video = tile.querySelector("video");
  if (video.srcObject !== stream) video.srcObject = stream;
  video.play().catch(() => {});
  video.muted = true;
  tile.querySelector(".stream-name").textContent = title;
  return tile;
}
function addLocalTile() { if (localStream) addTile("local", "Sua tela (você)", localStream, true); }
function removeLocalTile() { const tile = $("localTile"); if (tile) tile.remove(); }
function updateRoomStatus() {
  const remoteSharers = [...peers.values()].filter(p => p.role === "host" && p.pc.connectionState !== "closed").length;
  setShareCount(remoteSharers + (localStream ? 1 : 0));
}
function connect(nextRole, nextRoom) {
  const old = socket; socket = null;
  if (old) { old.onclose = null; old.close(); }
  for (const [id, peer] of peers) { if (peer.recoveryTimer) clearTimeout(peer.recoveryTimer); peer.pc.close(); peers.delete(id); }
  for (const id of [...remoteTiles.keys()]) clearRemoteTile(id);
  myId = null; role = nextRole; room = nextRoom; updateUrl(room); setConnection("Conectando…");
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(protocol + "//" + location.host + "/ws"); socket = ws;
  ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "join", room, role })));
  ws.addEventListener("message", async event => {
    if (socket !== ws) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    try { await handleSignal(data); }
    catch (error) { console.error(error); notice("Falha ao negociar a transmissão. Tente reconectar à sala.", true); }
  });
  ws.addEventListener("close", () => { if (socket === ws) setConnection("Desconectado"); });
  ws.addEventListener("error", () => { if (socket === ws) notice("Não foi possível conectar ao servidor. Tente novamente.", true); });
}
function shouldConnect(peerRole) { return role === "host" || peerRole === "host"; }
function createPeer(id, peerRole, initiator) {
  if (peers.has(id)) return peers.get(id);
  if (!shouldConnect(peerRole)) return null;
  const pc = new RTCPeerConnection(ICE_CONFIG);
  const entry = { pc, role: peerRole, candidates: [], initiator, currentBitrate: preset().bitrate, lastLoss: 0, lastRtt: 0, recoveryTimer: null, recovering: false };
  peers.set(id, entry);
  pc.onicecandidate = event => { if (event.candidate) signal({ type: "ice", to: id, candidate: event.candidate }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      entry.recovering = false;
      if (entry.recoveryTimer) { clearTimeout(entry.recoveryTimer); entry.recoveryTimer = null; }
      setConnection("Conectado à sala", true); updateRoomStatus();
    } else if (pc.connectionState === "disconnected") {
      if (!entry.recoveryTimer) entry.recoveryTimer = setTimeout(() => recoverPeer(id, entry), 4000);
    } else if (pc.connectionState === "failed") {
      recoverPeer(id, entry);
    } else if (pc.connectionState === "closed") {
      updateRoomStatus();
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed") recoverPeer(id, entry);
  };
  pc.ontrack = event => {
    if (entry.role !== "host") return;
    let stream = event.streams && event.streams[0];
    if (!stream) stream = new MediaStream([event.track]);
    addTile(id, "Tela compartilhada", stream);
    event.track.addEventListener("ended", () => clearRemoteTile(id), { once: true });
  };
  if (localStream) {
    for (const track of localStream.getTracks()) {
      const sender = pc.addTrack(track, localStream);
      if (track.kind === "video") {
        try { const params = sender.getParameters(); params.degradationPreference = "maintain-framerate"; sender.setParameters(params).catch(() => {}); } catch {}
      }
    }
  } else {
    pc.addTransceiver("video", { direction: "recvonly" });
  }
  if (initiator) makeOffer(id, entry, false);
  return entry;
}
function perPeerBitrate() {
  const outgoing = [...peers.values()].filter(item => item.pc.connectionState !== "closed" && item.pc.getSenders().some(sender => sender.track && sender.track.kind === "video")).length;
  const quality = preset();
  return Math.max(250000, Math.min(quality.bitrate, quality.aggregateBitrate / Math.max(1, outgoing)));
}
async function applyBitrate(entry, target = null) {
  try {
    const sender = entry.pc.getSenders().find(item => item.track && item.track.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
    const ceiling = perPeerBitrate();
    const wanted = Math.max(250000, Math.min(ceiling, target || entry.currentBitrate || ceiling));
    params.encodings[0].maxBitrate = Math.round(wanted);
    params.encodings[0].maxFramerate = preset().fps;
    params.degradationPreference = "maintain-framerate";
    await sender.setParameters(params);
    entry.currentBitrate = wanted;
  } catch (error) { console.debug("Ajuste adaptativo de bitrate não suportado", error); }
}
async function makeOffer(id, entry, iceRestart = false) {
  try {
    const offer = await entry.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await entry.pc.setLocalDescription(offer);
    signal({ type: "offer", to: id, description: entry.pc.localDescription });
  } catch (error) { console.warn("Não foi possível criar oferta WebRTC", error); }
}
async function flushCandidates(entry) {
  for (const candidate of entry.candidates.splice(0)) {
    try { await entry.pc.addIceCandidate(candidate); } catch (error) { console.debug("ICE candidate ignorado", error); }
  }
}
async function recoverPeer(id, entry) {
  if (!peers.has(id) || peers.get(id) !== entry || entry.recovering || entry.pc.connectionState === "closed") return;
  if (entry.recoveryTimer) { clearTimeout(entry.recoveryTimer); entry.recoveryTimer = null; }
  if (!entry.initiator) {
    // Only the deterministic offerer restarts ICE, avoiding simultaneous renegotiation.
    entry.recoveryTimer = setTimeout(() => {
      if (entry.pc.connectionState === "failed" && peers.get(id) === entry) {
        dropPeer(id); clearRemoteTile(id); updateRoomStatus();
        notice("Uma conexão caiu. Reentre na sala se a tela não voltar.", true);
      }
    }, 9000);
    return;
  }
  entry.recovering = true;
  try {
    if (entry.pc.signalingState !== "stable") {
      entry.pc.setLocalDescription({ type: "rollback" }).catch(() => {});
    }
    entry.pc.restartIce();
    await makeOffer(id, entry, true);
    setConnection("Recuperando transmissão…");
  } catch (error) {
    console.warn("Recuperação de conexão falhou", error);
    entry.recovering = false;
  }
}
async function handleSignal(data) {
  switch (data.type) {
    case "joined":
      myId = data.id; setConnection("Sala conectada", true); setShareCount(data.activeShares || 0);
      $("viewerTitle").textContent = role === "host" ? "Compartilhando sua tela" : "Pronto para assistir";
      $("viewerSubtitle").textContent = "Sala #" + room;
      notice("Sala conectada. Até 3 pessoas podem compartilhar simultaneamente.");
      break;
    case "peer-joined":
      if (myId && shouldConnect(data.role)) createPeer(data.id, data.role, myId.localeCompare(data.id) < 0);
      updateRoomStatus();
      break;
    case "offer": {
      const entry = createPeer(data.from, "host", false);
      if (!entry) break;
      if (entry.pc.signalingState !== "stable") {
        try { await entry.pc.setLocalDescription({ type: "rollback" }); } catch {}
      }
      await entry.pc.setRemoteDescription(data.description);
      await flushCandidates(entry);
      await entry.pc.setLocalDescription(await entry.pc.createAnswer());
      signal({ type: "answer", to: data.from, description: entry.pc.localDescription });
      await applyBitrate(entry);
      break;
    }
    case "answer": {
      const entry = peers.get(data.from);
      if (entry && entry.pc.signalingState === "have-local-offer") {
        await entry.pc.setRemoteDescription(data.description);
        await flushCandidates(entry);
        await applyBitrate(entry);
        entry.recovering = false;
      }
      break;
    }
    case "ice": {
      const entry = peers.get(data.from);
      if (entry && data.candidate) {
        if (entry.pc.remoteDescription) {
          try { await entry.pc.addIceCandidate(data.candidate); } catch (error) { console.debug("ICE candidate ignorado", error); }
        } else entry.candidates.push(data.candidate);
      }
      break;
    }
    case "peer-left":
      dropPeer(data.id); clearRemoteTile(data.id); updateRoomStatus(); setConnection("Sala conectada", true);
      notice(data.role === "host" ? "Uma transmissão foi encerrada." : "Um participante saiu da sala.");
      break;
    case "host-stopped":
      clearRemoteTile(data.from);
      break;
    case "error":
      notice(data.message || "Ocorreu um erro.", true); setConnection("Atenção");
      if (data.code === "SHARE_LIMIT") {
        if (localStream) stopSharing(false, false);
        if (socket) { const failed = socket; socket = null; failed.close(); }
        role = "viewer"; setShareCount(MAX_SHARES);
      }
      break;
  }
}
function dropPeer(id) {
  const entry = peers.get(id);
  if (entry) {
    if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer);
    entry.pc.ontrack = null;
    entry.pc.close();
    peers.delete(id);
  }
}
async function monitorConnections() {
  for (const [id, entry] of peers) {
    if (entry.pc.connectionState !== "connected") continue;
    try {
      const stats = await entry.pc.getStats();
      let loss = 0, rtt = 0;
      stats.forEach(report => {
        if (report.type === "remote-inbound-rtp" && report.kind === "video") {
          loss = Math.max(loss, report.fractionLost || 0);
          if (typeof report.roundTripTime === "number") rtt = Math.max(rtt, report.roundTripTime);
        }
      });
      entry.lastLoss = loss; entry.lastRtt = rtt;
      if (localStream && entry.pc.getSenders().some(sender => sender.track && sender.track.kind === "video")) {
        const ceiling = perPeerBitrate();
        let target = entry.currentBitrate || ceiling;
        if (loss > 0.08 || rtt > 0.55) target = Math.max(350000, target * 0.68);
        else if (loss > 0.035 || rtt > 0.32) target = Math.max(450000, target * 0.84);
        else target = Math.min(ceiling, target * 1.08);
        if (Math.abs(target - (entry.currentBitrate || ceiling)) > 100000) await applyBitrate(entry, target);
      }
    } catch (error) { console.debug("Monitoramento WebRTC indisponível", error); }
  }
}
async function startSharing() {
  if (localStream) { notice("Sua tela já está sendo compartilhada."); return; }
  const targetRoom = currentRoom(); if (!targetRoom) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { notice("Use uma versão atualizada do Chrome ou Edge.", true); return; }
  try {
    const quality = preset();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: quality.width, max: quality.width }, height: { ideal: quality.height, max: quality.height }, frameRate: { ideal: quality.fps, max: quality.fps }, displaySurface: "monitor" },
      audio: false
    });
    localStream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.contentHint = qualitySelect.value === "fluid" ? "motion" : "detail";
      track.addEventListener("ended", () => stopSharing(true, true), { once: true });
    }
    addLocalTile();
    $("viewerTitle").textContent = "Compartilhando sua tela";
    $("viewerSubtitle").textContent = "A tela será enviada aos participantes";
    $("qualityBadge").textContent = quality.label;
    connect("host", targetRoom);
    shareBtn.disabled = true; shareBtn.textContent = "Compartilhando…";
    notice("Compartilhamento iniciado. Envie o link da sala.");
  } catch (error) {
    if (error.name !== "NotAllowedError") notice("Não foi possível iniciar o compartilhamento. Confira as permissões do navegador.", true);
  }
}
function stopSharing(notifyPeers = true, reconnectViewer = true) {
  if (notifyPeers) signal({ type: "host-stopped" });
  if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
  removeLocalTile(); shareBtn.disabled = false; shareBtn.innerHTML = "<span>▣</span> Compartilhar minha tela";
  if (reconnectViewer && room) {
    const current = room; connect("viewer", current);
    notice("Compartilhamento encerrado. Você continua na sala para assistir às outras telas.");
  } else {
    if (socket) { const old = socket; socket = null; old.close(); }
    role = "viewer";
  }
  $("viewerTitle").textContent = "Pronto para assistir";
  $("viewerSubtitle").textContent = "Sala #" + room;
  $("qualityBadge").textContent = "AO VIVO";
  updateRoomStatus();
}
watchBtn.addEventListener("click", () => {
  const targetRoom = currentRoom(); if (!targetRoom) return;
  if (localStream) { notice("Você já está compartilhando; também pode receber outras telas."); return; }
  connect("viewer", targetRoom);
  $("viewerTitle").textContent = "Conectando à sala";
  $("viewerSubtitle").textContent = "Sala #" + targetRoom;
  notice("Conectando às transmissões da sala…");
});
shareBtn.addEventListener("click", startSharing);
$("stopShareBtn").addEventListener("click", () => { if (localStream) stopSharing(true, true); });
$("copyRoom").addEventListener("click", () => copyText(roomUrl()));
$("copyLink").addEventListener("click", () => copyText(roomUrl()));
$("fullscreenBtn").addEventListener("click", () => {
  const video = streamGrid.querySelector(".stream-tile video");
  if (video && video.requestFullscreen) video.requestFullscreen().catch(() => {});
});
roomInput.addEventListener("input", () => {
  const clean = normalizeRoom(roomInput.value);
  if (roomInput.value !== clean) roomInput.value = clean;
  const u = new URL(location.href); u.searchParams.set("sala", clean || "rrzin"); linkText.textContent = u.toString();
});
qualitySelect.addEventListener("change", async () => {
  if (!localStream) return;
  const quality = preset(), track = localStream.getVideoTracks()[0];
  try { await track.applyConstraints({ width: { ideal: quality.width, max: quality.width }, height: { ideal: quality.height, max: quality.height }, frameRate: { ideal: quality.fps, max: quality.fps } }); }
  catch (error) { console.debug("Captura não aceitou as restrições", error); }
  for (const entry of peers.values()) await applyBitrate(entry, quality.bitrate);
  $("qualityBadge").textContent = quality.label; notice("Preferência de qualidade atualizada.");
});
window.addEventListener("beforeunload", () => {
  clearInterval(statsTimer);
  for (const entry of peers.values()) { if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer); entry.pc.close(); }
  if (socket) socket.close();
});
roomInput.value = normalizeRoom(new URLSearchParams(location.search).get("sala") || "rrzin");
updateUrl(roomInput.value); setShareCount(0);
})();