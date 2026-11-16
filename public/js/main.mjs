import { DT, MAX_X, MIN_X, STRATEGIC_CONFIG } from "../../shared/constants.mjs";
import {
  addPlayer,
  createInitialState,
  handlePlayerRequisition,
  handlePlayerUtility,
  resetMatch,
  stepSimulation,
  swapPlayerAircraft,
  updateP47Config
} from "../../shared/simulation.mjs";
import { TacticalHud } from "./hud.mjs";
import { KeyboardInput } from "./input.mjs";
import { SpriteBattlefieldRenderer } from "./renderer.mjs";

const canvas = document.getElementById("battlefield");
const renderer = new SpriteBattlefieldRenderer(canvas);
const hud = new TacticalHud();

try {
  const saved = localStorage.getItem("glory_days_p47_config_v2");
  if (saved) updateP47Config(JSON.parse(saved));
} catch {
  // Ignore invalid or inaccessible storage
}

let state = createInitialState();
let localPlayerId = "local_p1";
addPlayer(state, localPlayerId, "allied", "heli");

let ws = null;
let wsConnected = false;
const b52Aiming = { active: false, targetX: 1800 };

const input = new KeyboardInput((action) => {
  if (action.type === "toggleMenu") {
    hud.setMenuOpen(action.open);
    return;
  }
  if (action.type === "cancelMenu") {
    b52Aiming.active = false;
    input.b52Aiming = false;
    hud.setMenuOpen(false);
    return;
  }
  if (action.type === "confirmB52") {
    if (!b52Aiming.active) return;
    if (wsConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "requisition", key: "8", targetX: b52Aiming.targetX }));
    } else {
      handlePlayerRequisition(state, localPlayerId, "8", { targetX: b52Aiming.targetX });
      if (state.events.length) {
        renderer.ingestEvents(state.events);
        hud.ingestEvents(state.events);
      }
    }
    b52Aiming.active = false;
    input.b52Aiming = false;
    return;
  }
  if (action.type === "restartMatch") {
    if (!state.winner) return;
    b52Aiming.active = false;
    input.b52Aiming = false;
    input.menuOpen = false;
    hud.setMenuOpen(false);
    if (wsConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "restartMatch" }));
    } else {
      resetMatch(state);
    }
    return;
  }
  if (action.type === "utility") {
    if (wsConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "utility" }));
    } else {
      handlePlayerUtility(state, localPlayerId);
    }
    return;
  }
  if (action.type === "menuKey") {
    const p = state.players[localPlayerId];
    if (action.key === "0") {
      if (wsConnected && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "swapAircraft" }));
      } else {
        swapPlayerAircraft(state, localPlayerId);
      }
      return;
    }
    if (action.key === "8") {
      if (p && !state.winner && state.teamFunds[p.team] >= STRATEGIC_CONFIG.b52_raid.cost) {
        b52Aiming.active = true;
        b52Aiming.targetX = p.team === "allied" ? 1800 : -1800;
        input.menuOpen = false;
        input.b52Aiming = true;
        hud.setMenuOpen(false);
      } else {
        hud.showToast("NEED $750 FOR B-52 CARPET RAID", "info");
      }
      return;
    }
    if (/^[1-79]$/.test(action.key)) {
      if (wsConnected && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "requisition", key: action.key }));
      } else {
        const res = handlePlayerRequisition(state, localPlayerId, action.key);
        if (!res) hud.showToast("REQUISITION UNAVAILABLE", "info");
      }
      if (action.key === "9") {
        input.menuOpen = false;
        hud.setMenuOpen(false);
      }
    }
  }
});

function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => {
      wsConnected = true;
      hud.setNetStatus("MULTIPLAYER WS", "#22c55e");
    };
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "welcome") {
        localPlayerId = data.playerId;
        state = data.state;
        if (data.p47Config) {
          updateP47Config(data.p47Config);
        }
        hud.setNetStatus(`ONLINE (${data.team.toUpperCase()})`, "#22c55e");
      } else if (data.type === "p47Config") {
        updateP47Config(data.config);
      } else if (data.type === "snapshot") {
        state = data.state;
        if (state.events?.length) {
          renderer.ingestEvents(state.events);
          hud.ingestEvents(state.events);
        }
      }
    };
    ws.onclose = () => {
      wsConnected = false;
      hud.setNetStatus("LOCAL SANDBOX", "#f59e0b");
      setTimeout(connectWebSocket, 3000);
    };
    ws.onerror = () => {
      wsConnected = false;
      hud.setNetStatus("LOCAL SANDBOX", "#f59e0b");
    };
  } catch {
    hud.setNetStatus("LOCAL SANDBOX", "#f59e0b");
  }
}

await renderer.loadAll();
connectWebSocket();

let accumulator = 0;
let lastTime = performance.now();

function loop(now) {
  const frameDt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (b52Aiming.active) {
    const aimDir = (input.isRawKeyDown("ArrowRight") ? 1 : 0) - (input.isRawKeyDown("ArrowLeft") ? 1 : 0);
    b52Aiming.targetX = Math.max(MIN_X + 800, Math.min(MAX_X - 800, b52Aiming.targetX + aimDir * 1800 * frameDt));
  }

  const snap = input.getSnapshot();
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input", input: snap }));
  } else {
    accumulator += frameDt;
    while (accumulator >= DT) {
      stepSimulation(state, { [localPlayerId]: snap });
      if (state.events.length) {
        renderer.ingestEvents(state.events);
        hud.ingestEvents(state.events);
      }
      accumulator -= DT;
    }
  }

  renderer.render(state, localPlayerId, frameDt);
  hud.update(state, localPlayerId, renderer.camX, b52Aiming);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
