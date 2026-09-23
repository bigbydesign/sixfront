import http from "http";
import express from "express";
import { Server, matchMaker } from "colyseus";
import { runSanity } from "@sixfront/shared";
import { WarRoom } from "./room";

runSanity();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));

const server = http.createServer(app);
const gameServer = new Server({ server });
gameServer.define("war", WarRoom);

const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, game: "Big Hersh House" });
});

app.post("/api/rooms", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "local";
  if (limited(ip)) {
    res.status(429).json({ error: "Too many rooms. Wait a minute." });
    return;
  }
  const existing = await matchMaker.query({ name: "war" });
  if (existing.length >= 24) {
    res.status(503).json({ error: "All fronts are busy." });
    return;
  }
  const taken = new Set(existing.map((room) => String(room.metadata?.code || "")));
  let code = "";
  for (let i = 0; i < 30; i++) {
    const candidate = `HERSH-${1000 + Math.floor(Math.random() * 9000)}`;
    if (!taken.has(candidate)) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    res.status(503).json({ error: "Could not assign a room code." });
    return;
  }
  const room = await matchMaker.createRoom("war", { code });
  res.json({ code, roomId: room.roomId });
});

app.get("/api/rooms", async (_req, res) => {
  const existing = await matchMaker.query({ name: "war" });
  const rooms = existing
    .map((room) => ({
      code: String(room.metadata?.code || ""),
      roomId: room.roomId,
      clients: room.clients,
      maxClients: room.maxClients,
      phase: String(room.metadata?.phase || "lobby"),
      humans: Number(room.metadata?.humans) || room.clients,
    }))
    .filter((room) => /^(HERSH|BBDN)-\d{4}$/.test(room.code))
    .sort((a, b) => a.code.localeCompare(b.code));
  res.json({ rooms });
});

app.get("/api/rooms/:code", async (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  if (!/^(HERSH|BBDN)-\d{4}$/.test(code)) {
    res.status(400).json({ error: "Use a code like HERSH-4821." });
    return;
  }
  const existing = await matchMaker.query({ name: "war" });
  const found = existing.find((room) => room.metadata?.code === code);
  if (!found) {
    res.status(404).json({ error: "No game with that code." });
    return;
  }
  res.json({ code, roomId: found.roomId, clients: found.clients, maxClients: found.maxClients });
});

const port = Number(process.env.PORT || 2571);
const host = process.env.HOST || "127.0.0.1";

gameServer.listen(port, host).then(() => {
  console.log(`Big Hersh House listening on http://${host}:${port}`);
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
