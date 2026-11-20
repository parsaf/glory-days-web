import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AIRCRAFT_CONFIG, DT, SNAPSHOT_INTERVAL_TICKS } from "../shared/constants.mjs";
import {
  addPlayer,
  configureMatch,
  createInitialState,
  createNetworkSnapshot,
  handlePlayerRequisition,
  handlePlayerUtility,
  launchSpecialWeapon,
  removePlayer,
  resetMatch,
  returnToLobby,
  setAutoProduction,
  setPlayerLobbyChoice,
  spawnPlayerP47Test,
  startMatch,
  stepSimulation,
  swapPlayerAircraft,
  syncBotPlayers,
  updateP47Config
} from "../shared/simulation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SHARED_DIR = path.join(ROOT, "shared");
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8"
};

// Minimal RFC 6455 WebSocket frame encoder/decoder (zero external deps)
function encodeWsFrame(payloadText) {
  const data = Buffer.from(payloadText, "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

function decodeWsFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const b1 = buffer[offset];
    const b2 = buffer[offset + 1];
    const opcode = b1 & 0x0f;
    const masked = (b2 & 0x80) !== 0;
    let payloadLen = b2 & 0x7f;
    let cursor = offset + 2;

    if (payloadLen === 126) {
      if (cursor + 2 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLen === 127) {
      if (cursor + 8 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    const maskLen = masked ? 4 : 0;
    if (cursor + maskLen + payloadLen > buffer.length) break;

    let maskKey = null;
    if (masked) {
      maskKey = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    const payload = Buffer.from(buffer.subarray(cursor, cursor + payloadLen));
    if (masked && maskKey) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }
    offset = cursor + payloadLen;

    if (opcode === 0x8) {
      messages.push({ kind: "close" });
    } else if (opcode === 0x9) {
      messages.push({ kind: "ping", data: payload });
    } else if (opcode === 0x1) {
      messages.push({ kind: "text", text: payload.toString("utf8") });
    }
  }

  return { messages, remaining: buffer.subarray(offset) };
}

function persistP47ConfigToFile(config) {
  try {
    const constantsPath = path.join(SHARED_DIR, "constants.mjs");
    const src = fs.readFileSync(constantsPath, "utf8");
    const startToken = "  p47: {\n";
    const endToken = "\n  }\n};";
    const startIdx = src.indexOf(startToken);
    if (startIdx === -1) return false;
    const endIdx = src.indexOf(endToken, startIdx);
    if (endIdx === -1) return false;

    let block = src.slice(startIdx, endIdx + endToken.length);
    for (const [key, val] of Object.entries(config)) {
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
      const re = new RegExp(`^(\\s*${key}:\\s*)(-?\\d+(?:\\.\\d+)?)`, "m");
      block = block.replace(re, `$1${val}`);
    }
    const nextSrc = src.slice(0, startIdx) + block + src.slice(endIdx + endToken.length);
    if (nextSrc !== src) {
      fs.writeFileSync(constantsPath, nextSrc, "utf8");
    }
    return true;
  } catch {
    return false;
  }
}

function resolveStaticPath(urlPath) {
  const cleanUrl = decodeURIComponent(urlPath.split("?")[0]);
  if (cleanUrl === "/flight-lab" || cleanUrl === "/flight-lab/") {
    return path.join(PUBLIC_DIR, "flight-lab.html");
  }
  if (cleanUrl.startsWith("/shared/")) {
    const rel = path.normalize(cleanUrl.slice("/shared/".length)).replace(/^(\.\.[/\\])+/, "");
    const abs = path.join(SHARED_DIR, rel);
    return abs.startsWith(SHARED_DIR) ? abs : null;
  }
  const rel = cleanUrl === "/" ? "index.html" : path.normalize(cleanUrl).replace(/^\/+/, "").replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(PUBLIC_DIR, rel);
  return abs.startsWith(PUBLIC_DIR) ? abs : null;
}

const rooms = new Map();
const allClients = new Map(); // playerId -> client
let playerSeq = 1;

function sanitizeRoomId(raw) {
  const clean = String(raw || "ALPHA").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12);
  return clean || "ALPHA";
}

function getOrCreateRoom(roomId) {
  const id = sanitizeRoomId(roomId);
  if (!rooms.has(id)) {
    rooms.set(id, {
      id,
      state: createInitialState({
        phase: "lobby",
        roomId: id,
        matchMode: "1v1",
        botsEnabled: true,
        includePracticeTargets: false
      }),
      clients: new Map(),
      pendingEvents: [],
      snapshotTickCounter: 0
    });
  }
  return rooms.get(id);
}

for (const preset of ["ALPHA", "BRAVO", "CHARLIE"]) {
  getOrCreateRoom(preset);
}

function getRoomsSummary() {
  const list = [];
  for (const r of rooms.values()) {
    list.push({
      id: r.id,
      phase: r.state.phase,
      matchMode: r.state.matchMode,
      botsEnabled: r.state.botsEnabled,
      humanCount: r.clients.size
    });
  }
  return list;
}

function broadcastRoomSnapshot(room, eventsOverride = null) {
  const frame = encodeWsFrame(JSON.stringify({
    type: "snapshot",
    state: createNetworkSnapshot(room.state, eventsOverride),
    rooms: getRoomsSummary()
  }));
  for (const c of room.clients.values()) {
    if (!c.socket.destroyed) c.socket.write(frame);
  }
}

function nextTeamForRoom(room) {
  let alliedCount = 0;
  let enemyCount = 0;
  for (const c of room.clients.values()) {
    if (c.team === "allied") alliedCount++;
    else enemyCount++;
  }
  return alliedCount <= enemyCount ? "allied" : "enemy";
}

function attachClientToRoom(client, targetRoom, choice = {}) {
  const oldRoom = client.room;
  if (oldRoom === targetRoom) return;

  if (oldRoom) {
    oldRoom.clients.delete(client.id);
    removePlayer(oldRoom.state, client.id);
    syncBotPlayers(oldRoom.state);
    if (oldRoom.clients.size === 0) {
      returnToLobby(oldRoom.state);
      oldRoom.pendingEvents = [];
      oldRoom.snapshotTickCounter = 0;
    } else {
      broadcastRoomSnapshot(oldRoom);
    }
  }

  const team = (choice.team === "allied" || choice.team === "enemy") ? choice.team : nextTeamForRoom(targetRoom);
  const aircraftType = choice.aircraftType === "p47" ? "p47" : "heli";
  const callsign = typeof choice.callsign === "string" && choice.callsign.trim()
    ? choice.callsign.trim().slice(0, 12).toUpperCase()
    : (client.callsign || client.id.toUpperCase());

  client.room = targetRoom;
  client.team = team;
  client.callsign = callsign;
  client.input = {};
  targetRoom.clients.set(client.id, client);

  if (targetRoom.state.winner !== null) {
    returnToLobby(targetRoom.state);
    targetRoom.pendingEvents = [];
    targetRoom.snapshotTickCounter = 0;
  }

  addPlayer(targetRoom.state, client.id, team, aircraftType, { isBot: false, callsign, ready: false });
  syncBotPlayers(targetRoom.state);

  if (!client.socket.destroyed) {
    client.socket.write(encodeWsFrame(JSON.stringify({
      type: "welcome",
      playerId: client.id,
      team,
      roomId: targetRoom.id,
      state: createNetworkSnapshot(targetRoom.state),
      rooms: getRoomsSummary(),
      p47Config: { ...AIRCRAFT_CONFIG.p47 }
    })));
  }
  broadcastRoomSnapshot(targetRoom);
}

const server = http.createServer((req, res) => {
  const filePath = resolveStaticPath(req.url || "/");
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
  });
  fs.createReadStream(filePath).pipe(res);
});

server.on("upgrade", (req, socket) => {
  if ((req.url || "").split("?")[0] !== "/ws") {
    socket.destroy();
    return;
  }
  const wsKey = req.headers["sec-websocket-key"];
  if (!wsKey) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${wsKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );

  const playerId = `p${playerSeq++}`;
  const reqUrl = new URL(req.url || "/ws", "http://localhost");
  const referer = String(req.headers.referer || "");
  const isTunerOnly = referer.includes("/flight-lab") || reqUrl.searchParams.get("tuner") === "1";
  const client = { id: playerId, socket, room: null, tunerOnly: isTunerOnly, team: "allied", callsign: playerId.toUpperCase(), input: {} };
  allClients.set(playerId, client);

  if (isTunerOnly) {
    if (!socket.destroyed) {
      socket.write(encodeWsFrame(JSON.stringify({ type: "p47Config", config: { ...AIRCRAFT_CONFIG.p47 } })));
    }
  } else {
    const initialRoom = getOrCreateRoom(reqUrl.searchParams.get("room") || "ALPHA");
    attachClientToRoom(client, initialRoom);
  }

  let rxBuf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    rxBuf = Buffer.concat([rxBuf, chunk]);
    const parsed = decodeWsFrames(rxBuf);
    rxBuf = parsed.remaining;
    for (const msg of parsed.messages) {
      if (msg.kind === "close") {
        socket.end();
        return;
      }
      if (msg.kind === "ping") {
        const pong = Buffer.concat([Buffer.from([0x8a, msg.data.length]), msg.data]);
        socket.write(pong);
        continue;
      }
      if (msg.kind === "text") {
        try {
          const cmd = JSON.parse(msg.text);
          const activeClient = allClients.get(playerId);
          if (!activeClient) continue;

          if (cmd.type === "updateP47Config" && cmd.patch) {
            const config = updateP47Config(cmd.patch);
            if (cmd.persist === true) {
              persistP47ConfigToFile(config);
            }
            const frame = encodeWsFrame(JSON.stringify({ type: "p47Config", config }));
            for (const c of allClients.values()) {
              if (!c.socket.destroyed) c.socket.write(frame);
            }
            continue;
          }

          const room = activeClient.room;
          if (!room) continue;

          if (cmd.type === "input" && cmd.input) {
            activeClient.input = cmd.input;
          } else if (cmd.type === "joinRoom") {
            const targetRoom = getOrCreateRoom(cmd.roomId);
            attachClientToRoom(activeClient, targetRoom, {
              team: cmd.team,
              aircraftType: cmd.aircraftType,
              callsign: cmd.callsign
            });
          } else if (cmd.type === "lobbySelect") {
            const updated = setPlayerLobbyChoice(room.state, playerId, {
              team: cmd.team,
              aircraftType: cmd.aircraftType,
              callsign: cmd.callsign,
              ready: cmd.ready
            });
            if (updated) {
              activeClient.team = updated.team;
              activeClient.callsign = updated.callsign;
            }
            if (room.state.phase === "lobby" && room.clients.size >= 2) {
              const allHumansReady = Array.from(room.clients.keys()).every((id) => room.state.players[id]?.ready);
              if (allHumansReady) {
                startMatch(room.state);
                room.pendingEvents = [];
                room.snapshotTickCounter = 0;
              }
            }
            broadcastRoomSnapshot(room, room.state.events);
          } else if (cmd.type === "startMatch") {
            if (cmd.team || cmd.aircraftType || cmd.callsign) {
              const updated = setPlayerLobbyChoice(room.state, playerId, {
                team: cmd.team,
                aircraftType: cmd.aircraftType,
                callsign: cmd.callsign
              });
              if (updated) {
                activeClient.team = updated.team;
                activeClient.callsign = updated.callsign;
              }
            }
            if (cmd.matchMode || typeof cmd.botsEnabled === "boolean") {
              configureMatch(room.state, { matchMode: cmd.matchMode, botsEnabled: cmd.botsEnabled });
            }
            if (typeof cmd.autoProduction === "boolean") {
              setAutoProduction(room.state, activeClient.team, cmd.autoProduction);
            }
            startMatch(room.state);
            room.pendingEvents = [];
            room.snapshotTickCounter = 0;
            broadcastRoomSnapshot(room, room.state.events);
          } else if (cmd.type === "setAutoProduction") {
            const targetTeam = (cmd.team === "allied" || cmd.team === "enemy") ? cmd.team : activeClient.team;
            const nextEnabled = typeof cmd.enabled === "boolean"
              ? cmd.enabled
              : !Boolean(room.state.autoProduction?.[targetTeam]);
            setAutoProduction(room.state, targetTeam, nextEnabled);
            broadcastRoomSnapshot(room, room.state.events);
          } else if (cmd.type === "returnToLobby") {
            returnToLobby(room.state);
            room.pendingEvents = [];
            room.snapshotTickCounter = 0;
            broadcastRoomSnapshot(room, room.state.events);
          } else if (cmd.type === "utility") {
            handlePlayerUtility(room.state, playerId);
          } else if (cmd.type === "swapAircraft") {
            swapPlayerAircraft(room.state, playerId);
          } else if (cmd.type === "requisition") {
            handlePlayerRequisition(room.state, playerId, String(cmd.key), { targetX: cmd.targetX });
          } else if (cmd.type === "specialWeapon") {
            launchSpecialWeapon(room.state, playerId, String(cmd.weapon || ""), { targetX: cmd.targetX });
            broadcastRoomSnapshot(room, room.state.events);
          } else if (cmd.type === "configureMatch") {
            configureMatch(room.state, { matchMode: cmd.matchMode, botsEnabled: cmd.botsEnabled });
            broadcastRoomSnapshot(room, room.state.events);
          } else if (cmd.type === "restartMatch") {
            resetMatch(room.state);
            room.pendingEvents = [];
            room.snapshotTickCounter = 0;
            broadcastRoomSnapshot(room, room.state.events);
          } else if (cmd.type === "spawnP47Test") {
            spawnPlayerP47Test(room.state, playerId, cmd.mode || "air");
          }
        } catch {
          // Ignore malformed JSON payloads
        }
      }
    }
  });

  const cleanup = () => {
    const activeClient = allClients.get(playerId);
    allClients.delete(playerId);
    const room = activeClient?.room;
    if (!room) return;
    room.clients.delete(playerId);
    removePlayer(room.state, playerId);
    syncBotPlayers(room.state);
    if (room.clients.size === 0) {
      returnToLobby(room.state);
      room.pendingEvents = [];
      room.snapshotTickCounter = 0;
    } else {
      broadcastRoomSnapshot(room);
    }
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

// Fixed-timestep 60 Hz authoritative simulation loop + 20 Hz compact snapshot broadcasts
let lastHr = process.hrtime.bigint();
let acc = 0;

setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - lastHr) / 1e9;
  lastHr = now;
  if (acc > 0.25) acc = 0.25;

  while (acc >= DT) {
    for (const room of rooms.values()) {
      if (room.clients.size === 0 || room.state.phase !== "playing") continue;
      const inputs = {};
      for (const [id, c] of room.clients.entries()) {
        inputs[id] = c.input;
      }
      stepSimulation(room.state, inputs);
      if (room.state.events.length) {
        room.pendingEvents.push(...room.state.events);
      }
      room.snapshotTickCounter += 1;
      const immediate = room.pendingEvents.some(
        (e) =>
          e.type === "match_won" ||
          e.type === "match_reset" ||
          e.type === "match_configured" ||
          e.type === "auto_production_toggled" ||
          e.type === "special_weapon_unlocked" ||
          e.type === "b52_raid_called" ||
          e.type === "v2_launched"
      );
      if (immediate || room.snapshotTickCounter >= SNAPSHOT_INTERVAL_TICKS) {
        room.snapshotTickCounter = 0;
        const batch = room.pendingEvents;
        room.pendingEvents = [];
        broadcastRoomSnapshot(room, batch);
      }
    }
    acc -= DT;
  }
}, 8);

server.listen(PORT, () => {
  console.log(`Glory Days Web server listening on http://localhost:${PORT}`);
});
