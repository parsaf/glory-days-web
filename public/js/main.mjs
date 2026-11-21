import { DT, MAX_X, MIN_X } from "../../shared/constants.mjs";
import {
  addPlayer,
  configureMatch,
  createInitialState,
  handlePlayerRequisition,
  handlePlayerUtility,
  launchSpecialWeapon,
  reconcileClientState,
  resetMatch,
  returnToLobby,
  setAutoProduction,
  setPlayerLobbyChoice,
  startMatch,
  stepSimulation,
  swapPlayerAircraft,
  syncBotPlayers,
  updateGroundConfig,
  updateHeliConfig,
  updateP47Config
} from "../../shared/simulation.mjs";
import { BattlefieldAudio } from "./audio.mjs";
import { TacticalHud } from "./hud.mjs";
import { KeyboardInput } from "./input.mjs";
import { SpriteBattlefieldRenderer } from "./renderer.mjs";

const canvas = document.getElementById("battlefield");
const renderer = new SpriteBattlefieldRenderer(canvas);
const hud = new TacticalHud();
const audio = new BattlefieldAudio();

try {
  const saved = localStorage.getItem("glory_days_p47_config_v2");
  if (saved) updateP47Config(JSON.parse(saved));
  const savedHeli = localStorage.getItem("glory_days_heli_config_v1");
  if (savedHeli) updateHeliConfig(JSON.parse(savedHeli));
  const savedGround = localStorage.getItem("glory_days_ground_config_v1");
  if (savedGround) updateGroundConfig(JSON.parse(savedGround));
} catch {
  // Ignore invalid or inaccessible storage
}

let state = createInitialState({ phase: "lobby", matchMode: "1v1", botsEnabled: true, includePracticeTargets: false });
let localPlayerId = "local_p1";
addPlayer(state, localPlayerId, "allied", "heli", { isBot: false, callsign: "YOU" });
syncBotPlayers(state);

let ws = null;
let wsConnected = false;
let roomsList = [];
let prevPhase = state.phase;
let lastSentInputJson = "";
let inputHeartbeat = 0;
const b52Aiming = { active: false, targetX: 1800 };
const seenEventKeys = new Set();

function releaseUiFocus() {
  if (document.activeElement && typeof document.activeElement.blur === "function" && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  window.focus?.();
}

function applyLobbyChoice(choice) {
  audio.unlock();
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "lobbySelect", ...choice }));
  } else {
    setPlayerLobbyChoice(state, localPlayerId, choice);
    dispatchEvents(state.events);
  }
}

function setMatchConfig(cfg) {
  audio.unlock();
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "configureMatch", ...cfg }));
  } else {
    configureMatch(state, cfg);
    dispatchEvents(state.events);
  }
}

function toggleAutoProduction() {
  audio.unlock();
  const lp = state.players[localPlayerId];
  const team = lp?.team || "allied";
  const nextEnabled = !Boolean(state.autoProduction?.[team]);
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setAutoProduction", team, enabled: nextEnabled }));
  } else {
    setAutoProduction(state, team, nextEnabled);
    dispatchEvents(state.events);
  }
  hud.showToast(`AUTO TROOPS: ${nextEnabled ? "ON (INF, TANKS & AA)" : "OFF"}`, "info", 1800);
}

function launchSortie() {
  audio.unlock();
  releaseUiFocus();
  const localP = state.players[localPlayerId];
  const callsignInput = document.getElementById("lobby-callsign");
  const typedCallsign = callsignInput?.value?.trim();
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "startMatch",
      team: localP?.team,
      aircraftType: localP?.aircraftType,
      callsign: typedCallsign || localP?.callsign,
      matchMode: state.matchMode,
      botsEnabled: state.botsEnabled,
      autoProduction: Boolean(state.autoProduction?.[localP?.team || "allied"])
    }));
  } else {
    if (typedCallsign) setPlayerLobbyChoice(state, localPlayerId, { callsign: typedCallsign });
    startMatch(state);
    dispatchEvents(state.events);
  }
}

function joinRoom(roomId) {
  audio.unlock();
  releaseUiFocus();
  const localP = state.players[localPlayerId];
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "joinRoom",
      roomId,
      team: localP?.team,
      aircraftType: localP?.aircraftType,
      callsign: localP?.callsign
    }));
  } else {
    state.roomId = String(roomId || "ALPHA").trim().toUpperCase().slice(0, 12) || "ALPHA";
    hud.showToast(`ROOM: ${state.roomId}`, "info", 1500);
  }
}

function goBackToLobby() {
  audio.unlock();
  releaseUiFocus();
  b52Aiming.active = false;
  input.b52Aiming = false;
  input.menuOpen = false;
  hud.setMenuOpen(false);
  seenEventKeys.clear();
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "returnToLobby" }));
  } else {
    returnToLobby(state);
    dispatchEvents(state.events);
  }
}

function triggerRematch() {
  if (!state.winner) return;
  audio.unlock();
  releaseUiFocus();
  b52Aiming.active = false;
  input.b52Aiming = false;
  input.menuOpen = false;
  hud.setMenuOpen(false);
  seenEventKeys.clear();
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "restartMatch" }));
  } else {
    resetMatch(state);
  }
}

hud.bindLobbyHandlers({
  onJoinRoom: joinRoom,
  onSelectMode: (matchMode) => setMatchConfig({ matchMode }),
  onToggleBots: () => setMatchConfig({ botsEnabled: !state.botsEnabled }),
  onToggleAutoProduction: toggleAutoProduction,
  onCallsignChange: (callsign) => applyLobbyChoice({ callsign }),
  onSelectTeam: (team) => applyLobbyChoice({ team }),
  onSelectAircraft: (aircraftType) => applyLobbyChoice({ aircraftType }),
  onToggleReady: () => {
    const cur = Boolean(state.players[localPlayerId]?.ready);
    applyLobbyChoice({ ready: !cur });
  },
  onStartMatch: launchSortie,
  onRematch: triggerRematch,
  onReturnToLobby: goBackToLobby
});

function dispatchEvents(events) {
  if (!events?.length) return;
  const fresh = [];
  for (const ev of events) {
    const key = `${ev.type}:${ev.tick}:${Math.round(ev.x || 0)}:${ev.playerId || ev.bunkerId || ev.unitId || ""}`;
    if (seenEventKeys.has(key)) continue;
    seenEventKeys.add(key);
    fresh.push(ev);
  }
  if (seenEventKeys.size > 400) {
    const keep = Array.from(seenEventKeys).slice(-150);
    seenEventKeys.clear();
    for (const k of keep) seenEventKeys.add(k);
  }
  if (fresh.length) {
    renderer.ingestEvents(fresh);
    hud.ingestEvents(fresh);
    audio.ingestEvents(fresh, state.players[localPlayerId]);
  }
}

const input = new KeyboardInput((action) => {
  audio.unlock();

  if (action.type === "lobbyLaunch") {
    launchSortie();
    return;
  }
  if (action.type === "lobbyTeam") {
    applyLobbyChoice({ team: action.team });
    return;
  }
  if (action.type === "lobbyAircraft") {
    applyLobbyChoice({ aircraftType: action.aircraftType });
    return;
  }
  if (action.type === "returnToLobby") {
    goBackToLobby();
    return;
  }
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
  if (action.type === "cycleMatchMode") {
    const order = ["1v1", "2v2", "3v3"];
    const nextMode = order[(order.indexOf(state.matchMode || "1v1") + 1) % order.length];
    setMatchConfig({ matchMode: nextMode });
    hud.showToast(`MODE: ${nextMode.toUpperCase()}`, "info", 1800);
    return;
  }
  if (action.type === "toggleBots") {
    const nextBots = !state.botsEnabled;
    setMatchConfig({ botsEnabled: nextBots });
    hud.showToast(`AI BOTS: ${nextBots ? "ON" : "OFF"}`, "info", 1800);
    return;
  }
  if (action.type === "toggleAutoProduction") {
    toggleAutoProduction();
    return;
  }
  if (action.type === "toggleAudio") {
    const on = audio.toggle();
    hud.showToast(on ? "AUDIO: ON" : "AUDIO: MUTED", "info", 1600);
    return;
  }
  if (action.type === "specialB52") {
    const p = state.players[localPlayerId];
    if (p && !state.winner && (state.specialWeapons?.[p.team]?.available || 0) > 0) {
      b52Aiming.active = true;
      b52Aiming.targetX = p.team === "allied" ? 1800 : -1800;
      input.menuOpen = false;
      input.b52Aiming = true;
      hud.setMenuOpen(false);
    } else {
      hud.showToast("SPECIAL WEAPON LOCKED (RESCUE CIVILIANS OR 100% RAID)", "info", 2200);
    }
    return;
  }
  if (action.type === "specialV2") {
    const p = state.players[localPlayerId];
    if (p && !state.winner && (state.specialWeapons?.[p.team]?.available || 0) > 0) {
      b52Aiming.active = false;
      input.b52Aiming = false;
      input.menuOpen = false;
      hud.setMenuOpen(false);
      if (wsConnected && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "specialWeapon", weapon: "v2" }));
      } else {
        const res = launchSpecialWeapon(state, localPlayerId, "v2");
        if (!res) hud.showToast("V2 LAUNCH UNAVAILABLE", "info", 1800);
        else dispatchEvents(state.events);
      }
    } else {
      hud.showToast("SPECIAL WEAPON LOCKED (RESCUE CIVILIANS OR 100% RAID)", "info", 2200);
    }
    return;
  }
  if (action.type === "confirmB52") {
    if (!b52Aiming.active) return;
    if (wsConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "specialWeapon", weapon: "b52", targetX: b52Aiming.targetX }));
    } else {
      const res = launchSpecialWeapon(state, localPlayerId, "b52", { targetX: b52Aiming.targetX });
      if (!res) hud.showToast("SPECIAL WEAPON UNAVAILABLE", "info", 1800);
      else dispatchEvents(state.events);
    }
    b52Aiming.active = false;
    input.b52Aiming = false;
    return;
  }
  if (action.type === "restartMatch") {
    triggerRematch();
    return;
  }
  if (action.type === "utility") {
    if (wsConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "utility" }));
    } else {
      handlePlayerUtility(state, localPlayerId);
      dispatchEvents(state.events);
    }
    return;
  }
  if (action.type === "menuKey") {
    if (action.key === "0") {
      if (wsConnected && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "swapAircraft" }));
      } else {
        swapPlayerAircraft(state, localPlayerId);
        dispatchEvents(state.events);
      }
      return;
    }
    if (/^[1-6]$/.test(action.key)) {
      if (wsConnected && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "requisition", key: action.key }));
      } else {
        const res = handlePlayerRequisition(state, localPlayerId, action.key);
        if (!res) hud.showToast("REQUISITION UNAVAILABLE", "info");
        else dispatchEvents(state.events);
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
        if (Array.isArray(data.rooms)) roomsList = data.rooms;
        seenEventKeys.clear();
        lastSentInputJson = "";
        inputHeartbeat = 0;
        b52Aiming.active = false;
        input.b52Aiming = false;
        input.menuOpen = false;
        hud.setMenuOpen(false);
        if (data.p47Config) {
          updateP47Config(data.p47Config);
        }
        if (data.heliConfig) {
          updateHeliConfig(data.heliConfig);
        }
        if (data.groundConfig) {
          updateGroundConfig(data.groundConfig);
        }
        hud.setNetStatus(`ONLINE (${data.roomId || "ALPHA"} • ${data.team.toUpperCase()})`, "#22c55e");
      } else if (data.type === "p47Config") {
        updateP47Config(data.config);
      } else if (data.type === "heliConfig") {
        updateHeliConfig(data.config);
      } else if (data.type === "groundConfig") {
        updateGroundConfig(data.config);
      } else if (data.type === "snapshot") {
        if (Array.isArray(data.rooms)) roomsList = data.rooms;
        state = reconcileClientState(state, data.state, localPlayerId);
        const lp = state.players[localPlayerId];
        if (lp) {
          hud.setNetStatus(`ONLINE (${state.roomId || "ALPHA"} • ${lp.team.toUpperCase()})`, "#22c55e");
        }
        if (state.events?.length) {
          dispatchEvents(state.events);
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
  try {
    const frameDt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    input.lobbyOpen = state.phase === "lobby";
    if (state.phase === "lobby" || state.winner) {
      b52Aiming.active = false;
      input.b52Aiming = false;
      input.menuOpen = false;
      hud.setMenuOpen(false);
    }

    if (prevPhase === "lobby" && state.phase === "playing") {
      releaseUiFocus();
      lastSentInputJson = "";
      inputHeartbeat = 0;
      const lp = state.players[localPlayerId];
      if (lp) {
        renderer.camX = lp.x + lp.dir * 130;
        renderer.camY = Math.max(150, lp.y + 90);
      }
    }
    prevPhase = state.phase;

    if (b52Aiming.active) {
      const aimDir = (input.isRawKeyDown("ArrowRight") ? 1 : 0) - (input.isRawKeyDown("ArrowLeft") ? 1 : 0);
      b52Aiming.targetX = Math.max(MIN_X + 800, Math.min(MAX_X - 800, b52Aiming.targetX + aimDir * 1800 * frameDt));
    }

    if (state.phase === "playing") {
      const snap = input.getSnapshot();
      if (wsConnected && ws?.readyState === WebSocket.OPEN) {
        const snapJson = JSON.stringify({ type: "input", input: snap });
        if (snapJson !== lastSentInputJson || ++inputHeartbeat >= 6) {
          lastSentInputJson = snapJson;
          inputHeartbeat = 0;
          ws.send(snapJson);
        }
      }

      // Run fixed-timestep 60 Hz simulation locally (authoritative in offline mode, predictive between 20 Hz snapshots online)
      accumulator += frameDt;
      while (accumulator >= DT) {
        stepSimulation(state, { [localPlayerId]: snap });
        if (state.events.length) {
          dispatchEvents(state.events);
        }
        accumulator -= DT;
      }
    } else {
      accumulator = 0;
    }

    renderer.render(state, localPlayerId, frameDt, b52Aiming);
    hud.update(state, localPlayerId, renderer.camX, b52Aiming, audio.enabled, roomsList);
  } catch (err) {
    console.error("Glory Days loop error:", err);
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
