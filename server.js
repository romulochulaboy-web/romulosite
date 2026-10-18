const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
const rooms = new Map();
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

function send(ws, payload) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
function membersFor(room) { if (!rooms.has(room)) rooms.set(room, new Map()); return rooms.get(room); }
function relay(room, ws, data) {
  const members = rooms.get(room);
  if (!members) return;
  if (data.to) { const target = members.get(data.to); if (target) send(target, { ...data, from: ws.id }); }
  else for (const peer of members.values()) if (peer.id !== ws.id) send(peer, { ...data, from: ws.id });
}
wss.on("connection", ws => {
  ws.id = crypto.randomUUID(); ws.room = null; ws.role = null;
  ws.on("message", raw => {
    let data; try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!data || typeof data.type !== "string") return;
    if (data.type === "join") {
      const room = String(data.room || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0,48);
      const role = data.role === "host" ? "host" : "viewer";
      if (room.length < 3) return send(ws,{type:"error",message:"O código da sala precisa ter pelo menos 3 caracteres."});
      const members = membersFor(room);
      if (role === "host" && [...members.values()].some(p => p.role === "host")) return send(ws,{type:"error",message:"Já existe uma transmissão ativa nesta sala."});
      ws.room = room; ws.role = role; members.set(ws.id, ws);
      send(ws,{type:"joined",id:ws.id,room,role,hostPresent:[...members.values()].some(p=>p.role==="host"&&p.id!==ws.id)});
      for (const peer of members.values()) {
        if (peer.id === ws.id) continue;
        if (role === "host" && peer.role === "viewer") send(ws,{type:"peer-joined",id:peer.id});
        if (role === "viewer" && peer.role === "host") { send(peer,{type:"peer-joined",id:ws.id}); send(ws,{type:"host-present",id:peer.id}); }
      }
      return;
    }
    if (ws.room && ["offer","answer","ice","host-stopped"].includes(data.type)) relay(ws.room, ws, data);
  });
  ws.on("close", () => {
    if (!ws.room) return;
    const members = rooms.get(ws.room); if (!members) return;
    members.delete(ws.id);
    for (const peer of members.values()) send(peer,{type:"peer-left",id:ws.id,role:ws.role});
    if (!members.size) rooms.delete(ws.room);
  });
});
const port = process.env.PORT || 3000;
server.listen(port,"0.0.0.0",()=>console.log("ShareRoom online na porta "+port));
