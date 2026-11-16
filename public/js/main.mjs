import { DT } from "../../shared/constants.mjs";
import {
  addPlayer,
  createInitialState,
  handlePlayerUtility,
  stepSimulation,
  swapPlayerAircraft
} from "../../shared/simulation.mjs";
import { TacticalHud } from "./hud.mjs";
import { KeyboardInput } from "./input.mjs";
import { SpriteBattlefieldRenderer } from "./renderer.mjs";

const canvas = document.getElementById("battlefield");
const renderer = new SpriteBattlefieldRenderer(canvas);
const hud = new TacticalHud();

let state = createInitialState();
let localPlayerId = "local_p1";
addPlayer(state, localPlayerId, "allied", "heli");

let ws = null;
let wsConnected = false;

const input = new KeyboardInput((action) => {
  if (action.type === "toggleMenu") {
    hud.setMenuOpen(action.open);
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
  if (action.type === "menuKey" && action.key === "0") {
    if (wsConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "swapAircraft" }));
    } else {
      swapPlayerAircraft(state, localPlayerId);
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
        hud.setNetStatus(`ONLINE (${data.team.toUpperCase()})`, "#22c55e");
      } else if (data.type === "snapshot") {
        state = data.state;
        if (state.events?.length) renderer.ingestEvents(state.events);
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

  const snap = input.getSnapshot();
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input", input: snap }));
  } else {
    accumulator += frameDt;
    while (accumulator >= DT) {
      stepSimulation(state, { [localPlayerId]: snap });
      if (state.events.length) renderer.ingestEvents(state.events);
      accumulator -= DT;
    }
  }

  renderer.render(state, localPlayerId, frameDt);
  hud.update(state, localPlayerId, renderer.camX);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
