const express = require("express");
const compression = require("compression");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024, perMessageDeflate: false });
const rooms = new Map();
const MAX_SHARERS_PER_ROOM = 3;

app.disable("x-powered-by");
app.use(compression());
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), display-capture=(self)");
  next();
});
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0, setHeaders(res, filePath) { if (/\.(html|js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache"); } }));
app.get("/healthz", (_req, res) => res.json({ ok: true, maxSimultaneousShares: MAX_SHARERS_PER_ROOM }));
app.get("/rtc-config", (_req, res) => {
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({ urls: process.env.TURN_URL.split(",").map(value => value.trim()), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ iceServers });
});

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function membersFor(room) {
  if (!rooms.has(room)) rooms.set(room, new Map());
  return rooms.get(room);
}
function participantList(room) {
  const members = rooms.get(room);
  if (!members) return [];
  return [...members.values()].map(peer => ({
    id: peer.id,
    name: peer.displayName || "Participante",
    role: peer.role
  }));
}
function broadcastParticipants(room) {
  const members = rooms.get(room);
  if (!members) return;
  const participants = participantList(room);
  for (const peer of members.values()) send(peer, { type: "participant-list", participants });
}
function relay(room, ws, data) {
  const members = rooms.get(room);
  if (!members) return;
  if (data.to) {
    const target = members.get(data.to);
    if (target) send(target, { ...data, from: ws.id });
  } else {
    for (const peer of members.values()) if (peer.id !== ws.id) send(peer, { ...data, from: ws.id });
  }
}

wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.id = crypto.randomUUID();
  ws.room = null;
  ws.role = null;
  ws.displayName = "Participante";

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!data || typeof data.type !== "string") return;

    if (data.type === "join") {
      if (ws.room) return;
      const room = String(data.room || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48);
      const role = data.role === "host" ? "host" : "viewer";
      const displayName = String(data.name || "").replace(/[<>\r\n\t]/g, "").trim().slice(0, 32);
      ws.displayName = displayName || "Participante";
      if (room.length < 3) return send(ws, { type: "error", message: "O código da sala precisa ter pelo menos 3 caracteres." });

      const members = membersFor(room);
      const activeSharers = [...members.values()].filter(p => p.role === "host").length;
      if (role === "host" && activeSharers >= MAX_SHARERS_PER_ROOM) {
        if (!members.size) rooms.delete(room);
        return send(ws, { type: "error", code: "SHARE_LIMIT", message: "Esta sala já tem 3 compartilhamentos ativos. Para compartilhar, aguarde alguém encerrar a transmissão." });
      }

      ws.room = room;
      ws.role = role;
      members.set(ws.id, ws);
      send(ws, {
        type: "joined",
        id: ws.id,
        room,
        role,
        name: ws.displayName,
        maxSimultaneousShares: MAX_SHARERS_PER_ROOM,
        activeShares: activeSharers + (role === "host" ? 1 : 0)
      });

      for (const peer of members.values()) {
        if (peer.id === ws.id) continue;
        send(peer, { type: "peer-joined", id: ws.id, role: ws.role, name: ws.displayName });
        send(ws, { type: "peer-joined", id: peer.id, role: peer.role, name: peer.displayName });
      }
      broadcastParticipants(room);
      return;
    }

    if (ws.room && ["offer", "answer", "ice", "host-stopped"].includes(data.type)) relay(ws.room, ws, data);
  });

  ws.on("close", () => {
    if (!ws.room) return;
    const room = ws.room;
    const members = rooms.get(room);
    if (!members) return;
    members.delete(ws.id);
    for (const peer of members.values()) send(peer, { type: "peer-left", id: ws.id, role: ws.role });
    if (!members.size) rooms.delete(room);
    else broadcastParticipants(room);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log("ShareRoom online na porta " + port));
