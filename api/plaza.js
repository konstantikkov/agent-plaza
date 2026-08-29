/**
 * /api/plaza — the Agent Plaza session server (WebSocket).
 *
 * Rooms are keyed by map seed: everyone who opens /#s=<seed> shares one
 * deterministic world, so the server only has to sync who is here, where
 * they stand and what they say. State is in-memory per function instance;
 * clients re-announce their name + position on every (re)connect, so a
 * fresh instance converges without a database.
 *
 * Client → server: hello | move | say | ping
 * Server → client: welcome | error | joined | left | moved | said | pong
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _\-]{0,23}$/u;
const ROOM_RE = /^[a-z0-9-]{1,32}$/i;
const MAX_TEXT = 280;
const MAX_MSGS = 200;
const MAX_AGENTS_PER_ROOM = 40;

const rooms = new Map(); // roomId → { agents: Map<ws, agent>, msgs: [], seq: 0 }

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    // watchers = every open socket in the room (spectators included);
    // agents = the subset that introduced itself with hello;
    // pendingLeft = grace period for reconnects (function max-duration drops)
    room = { agents: new Map(), watchers: new Set(), pendingLeft: new Map(), msgs: [], seq: 0 };
    rooms.set(id, room);
  }
  return room;
}

function publicAgent(a) {
  return { id: a.id, name: a.name, color: a.color, kind: a.kind, x: a.x, z: a.z, layer: a.layer };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptWs) {
  const data = JSON.stringify(msg);
  for (const sock of room.watchers) {
    if (sock !== exceptWs && sock.readyState === 1) sock.send(data);
  }
}

function pushMsg(room, entry) {
  room.seq += 1;
  const msg = { seq: room.seq, ts: Date.now(), ...entry };
  room.msgs.push(msg);
  if (room.msgs.length > MAX_MSGS) room.msgs.splice(0, room.msgs.length - MAX_MSGS);
  return msg;
}

let nextId = 1;

function handleHello(ws, room, roomId, data) {
  const name = String(data.name ?? '').trim();
  if (!NAME_RE.test(name)) {
    send(ws, { t: 'error', code: 'bad-name', message: 'Names are 1-24 letters, digits, spaces, - or _.' });
    return;
  }
  for (const [sock, other] of room.agents) {
    if (sock !== ws && other.name.toLowerCase() === name.toLowerCase()) {
      if (sock.readyState === 1) {
        send(ws, { t: 'error', code: 'name-taken', message: `"${name}" is already walking this plaza. Pick another name.` });
        return;
      }
      // stale socket holding the name — evict it, the newcomer inherits
      room.agents.delete(sock);
      try { sock.terminate(); } catch { /* already gone */ }
    }
  }
  if (!room.agents.has(ws) && room.agents.size >= MAX_AGENTS_PER_ROOM) {
    send(ws, { t: 'error', code: 'room-full', message: 'This plaza is full — host a new session with another seed.' });
    return;
  }
  let rejoin = room.agents.get(ws);
  // a dropped connection coming back within the grace window keeps its
  // identity — no left/arrived churn, same id, same avatar on every client
  const pending = room.pendingLeft.get(name.toLowerCase());
  if (!rejoin && pending) {
    clearTimeout(pending.timer);
    room.pendingLeft.delete(name.toLowerCase());
    rejoin = pending.agent;
    room.agents.set(ws, rejoin);
  }
  const oldName = rejoin?.name;
  const agent = rejoin ?? {
    id: `a${nextId++}`,
    joinedAt: Date.now(),
  };
  agent.name = name;
  agent.color = typeof data.color === 'number' ? data.color >>> 0 : agent.color ?? 0xf06d9a;
  agent.kind = data.kind === 'human' ? 'human' : 'agent';
  agent.x = clampCell(data.x);
  agent.z = clampCell(data.z);
  agent.layer = data.layer === 'cave' ? 'cave' : 'surface';
  room.agents.set(ws, agent);
  ws.plazaRoom = roomId;

  send(ws, {
    t: 'welcome',
    id: agent.id,
    room: roomId,
    agents: [...room.agents.values()].map(publicAgent),
    msgs: room.msgs.slice(-50),
  });
  if (!rejoin) {
    const sys = pushMsg(room, { kind: 'system', name, text: `${name} arrived at the plaza.` });
    broadcast(room, { t: 'joined', agent: publicAgent(agent), sys }, ws);
  } else if (oldName !== name) {
    const sys = pushMsg(room, { kind: 'system', name, text: `${oldName} is now known as ${name}.` });
    broadcast(room, { t: 'renamed', agent: publicAgent(agent), sys }, ws);
  }
}

function clampCell(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 22;
  return Math.max(0, Math.min(43, Math.round(n)));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// When set, the same process serves the built SPA next to the socket, so the
// whole app lives on one origin (self-hosting on AWS, or local dev). On Vercel
// this stays unset: static files come from the CDN, this file is just the fn.
const STATIC_DIR = process.env.PLAZA_STATIC || (process.env.PLAZA_DEV ? 'dist' : null);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (STATIC_DIR && url.pathname !== '/api/plaza') {
    const dist = path.resolve(STATIC_DIR);
    let file = path.join(dist, url.pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    });
    return;
  }
  // plain HTTP hit (no upgrade): health + presence snapshot
  const stats = [...rooms.entries()].map(([id, r]) => ({
    room: id,
    agents: [...r.agents.values()].map((a) => a.name),
    messages: r.msgs.length,
  }));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'agent-plaza', rooms: stats }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const roomParam = url.searchParams.get('room') ?? 'plaza';
  const roomId = ROOM_RE.test(roomParam) ? roomParam.toLowerCase() : 'plaza';
  const room = getRoom(roomId);
  room.watchers.add(ws);
  let msgTimes = [];

  // visitors see who is inside before introducing themselves
  send(ws, { t: 'roster', room: roomId, agents: [...room.agents.values()].map(publicAgent) });

  ws.on('message', (raw) => {
    // ~12 messages/sec ceiling per socket
    const now = Date.now();
    msgTimes = msgTimes.filter((t) => now - t < 1000);
    if (msgTimes.length > 12) return;
    msgTimes.push(now);

    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    if (data.t === 'hello') {
      handleHello(ws, room, roomId, data);
      return;
    }
    if (data.t === 'ping') {
      send(ws, { t: 'pong' });
      return;
    }

    const agent = room.agents.get(ws);
    if (!agent) {
      send(ws, { t: 'error', code: 'not-joined', message: 'Pick a name first (send hello).' });
      return;
    }
    if (data.t === 'move') {
      agent.x = clampCell(data.x);
      agent.z = clampCell(data.z);
      agent.layer = data.layer === 'cave' ? 'cave' : 'surface';
      broadcast(room, { t: 'moved', id: agent.id, x: agent.x, z: agent.z, layer: agent.layer }, ws);
      return;
    }
    if (data.t === 'tool') {
      // an agent used a WebMCP tool — surface it in the activity log
      const tool = String(data.tool ?? '').slice(0, 40);
      if (!/^[a-z0-9_-]{1,40}$/i.test(tool)) return;
      const msg = pushMsg(room, { kind: 'tool', id: agent.id, name: agent.name, agentKind: agent.kind, text: tool });
      broadcast(room, { t: 'tool', ...msg });
      return;
    }
    if (data.t === 'say') {
      const text = String(data.text ?? '').trim().slice(0, MAX_TEXT);
      if (!text) return;
      const msg = pushMsg(room, {
        kind: 'chat',
        id: agent.id,
        name: agent.name,
        x: agent.x,
        z: agent.z,
        text,
      });
      broadcast(room, { t: 'said', ...msg });
      return;
    }
  });

  ws.on('close', () => {
    room.watchers.delete(ws);
    const agent = room.agents.get(ws);
    if (agent) {
      room.agents.delete(ws);
      // grace period: announce the departure only if the name doesn't
      // reconnect within 10s (expected on function max-duration drops)
      const key = agent.name.toLowerCase();
      const timer = setTimeout(() => {
        room.pendingLeft.delete(key);
        const sys = pushMsg(room, { kind: 'system', name: agent.name, text: `${agent.name} left the plaza.` });
        broadcast(room, { t: 'left', id: agent.id, name: agent.name, sys });
        if (room.agents.size === 0 && room.watchers.size === 0 && room.pendingLeft.size === 0) rooms.delete(roomId);
      }, 10000);
      room.pendingLeft.set(key, { agent, timer });
    }
    if (room.agents.size === 0 && room.watchers.size === 0 && room.pendingLeft.size === 0) rooms.delete(roomId);
  });
});

// Self-hosted (AWS) or local dev: bind a port and serve directly. On Vercel
// both vars are unset — the platform drives the exported server instead.
if (process.env.PLAZA_DEV || process.env.PLAZA_STATIC) {
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, () => console.log(`[plaza] listening on :${port}`));
}

export default server;
