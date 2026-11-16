import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AIRCRAFT_CONFIG, DT } from "../shared/constants.mjs";
import {
  addPlayer,
  createInitialState,
  handlePlayerUtility,
  removePlayer,
  spawnPlayerP47Test,
  stepSimulation,
  swapPlayerAircraft,
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

function resolveStaticPath(urlPath) {
  const cleanUrl = decodeURIComponent(urlPath.split("?")[0]);
  if (cleanUrl.startsWith("/shared/")) {
    const rel = path.normalize(cleanUrl.slice("/shared/".length)).replace(/^(\.\.[/\\])+/, "");
    const abs = path.join(SHARED_DIR, rel);
    return abs.startsWith(SHARED_DIR) ? abs : null;
  }
  const rel = cleanUrl === "/" ? "index.html" : path.normalize(cleanUrl).replace(/^\/+/, "").replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(PUBLIC_DIR, rel);
  return abs.startsWith(PUBLIC_DIR) ? abs : null;
}

const state = createInitialState();
const clients = new Map(); // playerId -> { socket, team, input }
let playerSeq = 1;

function nextTeam() {
  let alliedCount = 0;
  let enemyCount = 0;
  for (const c of clients.values()) {
    if (c.team === "allied") alliedCount++;
    else enemyCount++;
  }
  return alliedCount <= enemyCount ? "allied" : "enemy";
}

const server = http.createServer((req, res) => {
  const filePath = resolveStaticPath(req.url || "/");
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
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
  const team = nextTeam();
  addPlayer(state, playerId, team, "heli");
  clients.set(playerId, { socket, team, input: {} });

  socket.write(encodeWsFrame(JSON.stringify({ type: "welcome", playerId, team, state, p47Config: { ...AIRCRAFT_CONFIG.p47 } })));

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
          const client = clients.get(playerId);
          if (!client) continue;
          if (cmd.type === "input" && cmd.input) {
            client.input = cmd.input;
          } else if (cmd.type === "utility") {
            handlePlayerUtility(state, playerId);
          } else if (cmd.type === "swapAircraft") {
            swapPlayerAircraft(state, playerId);
          } else if (cmd.type === "updateP47Config" && cmd.patch) {
            const config = updateP47Config(cmd.patch);
            const frame = encodeWsFrame(JSON.stringify({ type: "p47Config", config }));
            for (const c of clients.values()) {
              if (!c.socket.destroyed) c.socket.write(frame);
            }
          } else if (cmd.type === "spawnP47Test") {
            spawnPlayerP47Test(state, playerId, cmd.mode || "air");
          }
        } catch {
          // Ignore malformed JSON payloads
        }
      }
    }
  });

  const cleanup = () => {
    clients.delete(playerId);
    removePlayer(state, playerId);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

// Fixed-timestep 60 Hz authoritative game loop
let lastHr = process.hrtime.bigint();
let acc = 0;

setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - lastHr) / 1e9;
  lastHr = now;
  if (acc > 0.25) acc = 0.25;

  while (acc >= DT) {
    if (clients.size > 0) {
      const inputs = {};
      for (const [id, c] of clients.entries()) {
        inputs[id] = c.input;
      }
      stepSimulation(state, inputs);
      const frame = encodeWsFrame(JSON.stringify({ type: "snapshot", state }));
      for (const c of clients.values()) {
        if (!c.socket.destroyed) c.socket.write(frame);
      }
    }
    acc -= DT;
  }
}, 8);

server.listen(PORT, () => {
  console.log(`Glory Days Web server listening on http://localhost:${PORT}`);
});
