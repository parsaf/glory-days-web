import {
  AIRCRAFT_CONFIG,
  BURST_MAX_TICKS,
  DEFAULT_HELI_CONFIG,
  DEFAULT_P47_CONFIG,
  DEFENSE_CONFIG,
  DT,
  HELI_TUNING_SCHEMA,
  P47_TUNING_SCHEMA
} from "../../shared/constants.mjs";
import {
  addPlayer,
  createInitialState,
  handlePlayerUtility,
  isOnFriendlyPad,
  spawnPlayerHeliTest,
  spawnPlayerP47Test,
  stepSimulation,
  updateCrashSlide,
  updateHeli,
  updateHeliConfig,
  updateP47,
  updateP47Config
} from "../../shared/simulation.mjs";
import { KeyboardInput } from "./input.mjs";
import { SpriteBattlefieldRenderer } from "./renderer.mjs";

const P47_STORAGE_KEY = "glory_days_p47_config_v2";
const HELI_STORAGE_KEY = "glory_days_heli_config_v1";
const PLAYER_ID = "lab_pilot";

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const canvas = document.getElementById("battlefield");
const renderer = new SpriteBattlefieldRenderer(canvas);
renderer.showHealthBars = true;
renderer.showUnitHealthBars = true;
renderer.showHealthText = true;
renderer.colorHealthBarsByHp = true;

// Restore saved lab parameters for both aircraft if present
try {
  const savedP47 = localStorage.getItem(P47_STORAGE_KEY);
  if (savedP47) updateP47Config(JSON.parse(savedP47));
  const savedHeli = localStorage.getItem(HELI_STORAGE_KEY);
  if (savedHeli) updateHeliConfig(JSON.parse(savedHeli));
} catch {
  // Ignore invalid local storage
}

const urlParams = new URLSearchParams(window.location.search);
let activeAircraft = urlParams.get("aircraft") === "heli" ? "heli" : "p47";
let activeScenario = activeAircraft === "heli" ? "hover" : "stall";

const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
addPlayer(state, PLAYER_ID, "allied", activeAircraft);

let loopCooldown = 0;
let ws = null;
let wsConnected = false;
let simSpeedBeforePause = 1;

// DOM references
const elNetStatus = document.getElementById("lab-net-status");
const elParamCount = document.getElementById("dock-param-count");
const elGroups = document.getElementById("lab-groups");
const elAutoThrottle = document.getElementById("opt-auto-throttle");
const elLblAutoThrottle = document.getElementById("lbl-auto-throttle");
const elWrapAutoThrottle = document.getElementById("wrap-auto-throttle");
const elAutoLoop = document.getElementById("opt-auto-loop");
const elShowOverlay = document.getElementById("opt-show-overlay");
const elSimSpeed = document.getElementById("opt-sim-speed");
const elRespawnBtn = document.getElementById("lab-respawn-btn");

const craftButtons = Array.from(document.querySelectorAll(".craft-btn"));
const scenButtons = Array.from(document.querySelectorAll(".scen-btn"));
const elScenariosP47 = document.getElementById("scenarios-p47");
const elScenariosHeli = document.getElementById("scenarios-heli");
const elLegendP47 = document.getElementById("legend-p47");
const elLegendHeli = document.getElementById("legend-heli");
const elTelemetryP47 = document.getElementById("telemetry-p47");
const elTelemetryHeli = document.getElementById("telemetry-heli");

// P-47 Telemetry elements
const elSpecReadout = document.getElementById("spec-readout");
const elSpecFill = document.getElementById("spec-fill");
const elSpecNeedle = document.getElementById("spec-needle");
const elPinMinGlide = document.getElementById("pin-min-glide");
const elPinTakeoff = document.getElementById("pin-takeoff");
const elPinCruise = document.getElementById("pin-cruise");
const elLiftPct = document.getElementById("lift-pct");
const elLiftFill = document.getElementById("lift-fill");
const elPhase = document.getElementById("tel-phase");
const elCoastReadout = document.getElementById("coast-readout");
const elCoastFill = document.getElementById("coast-fill");
const elStallReadout = document.getElementById("stall-readout");
const elStallFill = document.getElementById("stall-fill");
const elPitch = document.getElementById("tel-pitch");
const elEffPitch = document.getElementById("tel-eff-pitch");
const elVxVy = document.getElementById("tel-vxvy");
const elAlt = document.getElementById("tel-alt");

// Chopper Telemetry elements
const elHeliVxReadout = document.getElementById("heli-vx-readout");
const elHeliVxBoardZone = document.getElementById("heli-vx-board-zone");
const elHeliPinTurn = document.getElementById("heli-pin-turn");
const elHeliVxFill = document.getElementById("heli-vx-fill");
const elHeliVxNeedle = document.getElementById("heli-vx-needle");
const elHeliVxMin = document.getElementById("heli-vx-min");
const elHeliVxBoardLbl = document.getElementById("heli-vx-board-lbl");
const elHeliVxMax = document.getElementById("heli-vx-max");

const elHeliVyReadout = document.getElementById("heli-vy-readout");
const elHeliVyCrashZone = document.getElementById("heli-vy-crash-zone");
const elHeliVySinkPin = document.getElementById("heli-vy-sink-pin");
const elHeliVyFill = document.getElementById("heli-vy-fill");
const elHeliVyNeedle = document.getElementById("heli-vy-needle");
const elHeliPhase = document.getElementById("heli-phase");

const elHeliBurstReadout = document.getElementById("heli-burst-readout");
const elHeliBurstFill = document.getElementById("heli-burst-fill");
const elHeliAmmoReadout = document.getElementById("heli-ammo-readout");
const elHeliBoardStatus = document.getElementById("heli-board-status");
const elHeliCabinReadout = document.getElementById("heli-cabin-readout");

const elHeliTelPitch = document.getElementById("heli-tel-pitch");
const elHeliTelGunAim = document.getElementById("heli-tel-gun-aim");
const elHeliTelVxVy = document.getElementById("heli-tel-vxvy");
const elHeliTelAlt = document.getElementById("heli-tel-alt");

const controls = new Map();

function getActiveSchema(aircraft = activeAircraft) {
  return aircraft === "heli" ? HELI_TUNING_SCHEMA : P47_TUNING_SCHEMA;
}

function getActiveDefaults(aircraft = activeAircraft) {
  return aircraft === "heli" ? DEFAULT_HELI_CONFIG : DEFAULT_P47_CONFIG;
}

function getActiveConfig(aircraft = activeAircraft) {
  return aircraft === "heli" ? AIRCRAFT_CONFIG.heli : AIRCRAFT_CONFIG.p47;
}

function updateActiveConfig(patch, aircraft = activeAircraft) {
  return aircraft === "heli" ? updateHeliConfig(patch) : updateP47Config(patch);
}

function collectCleanConfig(aircraft = activeAircraft) {
  const schema = getActiveSchema(aircraft);
  const cfg = getActiveConfig(aircraft);
  const out = {};
  for (const group of schema) {
    for (const item of group.items) {
      out[item.key] = cfg[item.key];
    }
  }
  return out;
}

function saveConfigLocally(aircraft = activeAircraft) {
  try {
    const key = aircraft === "heli" ? HELI_STORAGE_KEY : P47_STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(collectCleanConfig(aircraft)));
  } catch {
    // Ignore storage quota errors
  }
}

function syncWsConfig(patch, persist = false, aircraft = activeAircraft) {
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    const type = aircraft === "heli" ? "updateHeliConfig" : "updateP47Config";
    ws.send(JSON.stringify({ type, patch, persist }));
  }
}

function clearTransientWorld() {
  state.units = [];
  state.targets = [];
  state.civilians = [];
  state.paratroopers = [];
  state.projectiles = [];
  state.flares = [];
  state.b52s = [];
  state.v2s = [];
  state.events = [];
  for (const b of state.bunkers) {
    b.owner = "neutral";
    b.hp = DEFENSE_CONFIG.bunker.maxHp;
    b.maxHp = DEFENSE_CONFIG.bunker.maxHp;
    b.captureProgress = 0;
    b.fireCooldown = 0;
    b.passiveDummy = false;
  }
  renderer.clearEffects();
}

function startScenario(mode, snapCamera = true) {
  activeScenario = mode;
  loopCooldown = 0;

  for (const btn of scenButtons) {
    const match = btn.dataset.aircraft === activeAircraft && btn.dataset.scenario === mode;
    btn.classList.toggle("active", match);
    btn.blur();
  }

  clearTransientWorld();

  if (activeAircraft === "heli") {
    elAutoThrottle.checked = mode === "weapons";
    spawnPlayerHeliTest(state, PLAYER_ID, mode);
  } else {
    // Only "cruise" locks Auto-Throttle ON for hands-free Stage 1 wave tuning; other modes let user see off-throttle behavior immediately
    elAutoThrottle.checked = mode === "cruise";
    const simMode = mode === "cruise" ? "air" : mode;
    spawnPlayerP47Test(state, PLAYER_ID, simMode);
  }

  if (snapCamera) {
    const p = state.players[PLAYER_ID];
    renderer.camX = p.x + p.dir * 130;
    renderer.camY = Math.max(150, p.y + 90);
  }
}

function selectAircraft(aircraftType) {
  activeAircraft = aircraftType === "heli" ? "heli" : "p47";
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("aircraft", activeAircraft);
    window.history.replaceState({}, "", u.toString());
  } catch {
    // Ignore history API restrictions
  }

  const isHeli = activeAircraft === "heli";
  for (const btn of craftButtons) {
    btn.classList.toggle("active", btn.dataset.aircraft === activeAircraft);
    btn.blur();
  }

  elScenariosP47.style.display = isHeli ? "none" : "flex";
  elScenariosHeli.style.display = isHeli ? "flex" : "none";
  elLegendP47.style.display = isHeli ? "none" : "flex";
  elLegendHeli.style.display = isHeli ? "flex" : "none";
  elTelemetryP47.style.display = isHeli ? "none" : "grid";
  elTelemetryHeli.style.display = isHeli ? "grid" : "none";

  elLblAutoThrottle.textContent = isHeli ? "Auto-Hover" : "Auto-Throttle";
  elWrapAutoThrottle.title = isHeli
    ? "Hold steady altitude hands-free using collective thrust"
    : "Maintain full Stage 1 throttle hands-free at cruise/max speed";

  buildControls();
  startScenario(isHeli ? "hover" : "stall", true);
}

function computeStageLift(p, cfg = AIRCRAFT_CONFIG.p47) {
  const stage = p.flightStage || 1;
  if (stage === 1) return 1;
  if (stage === 2) {
    const graceDur = Math.max(0.05, cfg.throttleReleaseDelay);
    const ratio = clamp((p.throttleOffTime || 0) / graceDur, 0, 1);
    return 1 - ratio * 0.65;
  }
  return 0;
}

function adaptLiveHeliToParam(key, val) {
  const p = state.players[PLAYER_ID];
  if (!p || !p.alive || p.crashing) return;
  const cfg = AIRCRAFT_CONFIG.heli;

  if (key === "maxHp") {
    const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    p.maxHp = val;
    p.hp = Math.max(1, Math.round(val * ratio));
  } else if (key === "maxSecondary") {
    const wasFull = p.secondaryAmmo >= p.maxSecondary;
    p.maxSecondary = val;
    p.secondaryAmmo = wasFull ? val : Math.min(val, p.secondaryAmmo);
  } else if (key === "cabinCapacity") {
    p.cabinCapacity = val;
    if (p.passengers.length > val) {
      p.passengers.length = Math.max(0, Math.floor(val));
    }
  } else if (key === "maxSpeedX") {
    p.vx = clamp(p.vx, -val, val);
  } else if (key === "maxSpeedY") {
    p.vy = clamp(p.vy, -val, val);
  } else if (key === "turnDuration") {
    p.turnDuration = Math.max(0.05, val);
  }

  if (p.y > 2 && p.turnTimer === 0 && (key === "maxTiltPitch" || key === "maxSpeedX")) {
    const maxVx = Math.max(1, cfg.maxSpeedX);
    const maxTilt = cfg.maxTiltPitch ?? 0.24;
    p.pitch = clamp((-p.vx * p.dir) / maxVx, -1, 1) * maxTilt;
    p.effectivePitch = p.pitch;
  }
  p.speed = Math.hypot(p.vx, p.vy);
}

function adaptLiveP47ToParam(key, val) {
  const p = state.players[PLAYER_ID];
  if (!p || !p.alive || p.crashing) return;
  const cfg = AIRCRAFT_CONFIG.p47;

  if (key === "cruiseSpeed" && (elAutoThrottle.checked || activeScenario === "cruise" || activeScenario === "brake")) {
    p.speed = clamp(val, 0, cfg.maxSpeed);
  } else if (key === "maxSpeed" && p.speed > val) {
    p.speed = val;
  } else if (key === "minGlideSpeed" && p.speed < val && p.y > 1) {
    p.speed = val;
  }

  const stage = p.flightStage || 1;
  const baseSnap = input.getSnapshot();

  if (stage === 3) {
    if (baseSnap.up) p.pitch = cfg.stage3UpPitch;
    else if (!baseSnap.down) p.pitch = cfg.glidePitch;
    p.effectivePitch = clamp(p.pitch, -cfg.maxPitch, cfg.maxPitch);
    const extraDown = p.pitch < cfg.glidePitch ? (cfg.glidePitch - p.pitch) * p.speed * 0.6 : 0;
    p.stallVy = cfg.stallSinkGravity + extraDown;
    if (p.y > 0.5 && p.turnTimer === 0) {
      p.vx = p.dir * p.speed * Math.cos(p.effectivePitch);
      p.vy = -p.stallVy;
    }
    return;
  }

  if (stage === 4) {
    const targetDown = cfg.maxDivePitch;
    if (baseSnap.up) p.pitch = cfg.stage4UpPitch;
    else p.pitch = targetDown;
    p.effectivePitch = clamp(p.pitch, Math.min(-cfg.maxPitch, targetDown), cfg.maxPitch);
    p.stallVy = cfg.stage4SinkRate;
    if (p.y > 0.5 && p.turnTimer === 0) {
      p.vx = p.dir * p.speed * Math.cos(p.effectivePitch);
      p.vy = -p.stallVy;
    }
    return;
  }

  if (key === "maxPitch") {
    p.pitch = clamp(p.pitch, -val, val);
  }

  // Stage 1 / Stage 2 immediate kinematics update even when paused
  const graceLift = stage === 2 ? 1 - clamp((p.throttleOffTime || 0) / Math.max(0.05, cfg.throttleReleaseDelay), 0, 1) * 0.35 : 1;
  const waveVelY = Math.cos(p.wavePhase || 0) * cfg.sineAmpVel * graceLift;
  const wavePitch = Math.cos(p.wavePhase || 0) * cfg.sinePitchAmp * graceLift;
  p.stallVy = stage === 2 ? Math.pow(clamp((p.throttleOffTime || 0) / Math.max(0.05, cfg.throttleReleaseDelay), 0, 1), 2) * cfg.stallSinkGravity * 0.45 : 0;
  p.effectivePitch = clamp(p.pitch + wavePitch, -cfg.maxPitch, cfg.maxPitch);
  if (p.y > 0.5 && p.turnTimer === 0) {
    p.vx = p.dir * p.speed * Math.cos(p.effectivePitch);
    p.vy = p.speed * Math.sin(p.effectivePitch) + waveVelY - p.stallVy;
  }
}

function adaptLiveAircraftToParam(key, val) {
  if (activeAircraft === "heli") adaptLiveHeliToParam(key, val);
  else adaptLiveP47ToParam(key, val);
}

function applyExternalConfig(cfgObj, aircraft = activeAircraft) {
  updateActiveConfig(cfgObj, aircraft);
  const cfg = getActiveConfig(aircraft);
  for (const [key, entry] of controls.entries()) {
    const val = cfg[key];
    if (typeof val !== "number") continue;
    entry.range.value = String(clamp(val, entry.item.min, entry.item.max));
    if (document.activeElement !== entry.num) {
      entry.num.value = String(val);
    }
  }
  saveConfigLocally(aircraft);
}

function buildControls() {
  elGroups.innerHTML = "";
  controls.clear();

  const schema = getActiveSchema();
  const defaults = getActiveDefaults();
  const cfg = getActiveConfig();
  const craftLabel = activeAircraft === "heli" ? "CHOPPER" : "P-47";

  for (const group of schema) {
    const section = document.createElement("details");
    section.className = "tuner-group";
    section.open = true;

    const summary = document.createElement("summary");
    summary.textContent = group.group;
    section.appendChild(summary);

    const list = document.createElement("div");
    list.className = "tuner-list";

    for (const item of group.items) {
      const row = document.createElement("div");
      row.className = "tuner-row";

      const labelWrap = document.createElement("div");
      labelWrap.className = "tuner-label-wrap";

      const label = document.createElement("span");
      label.className = "tuner-label";
      label.textContent = item.label;

      const badges = document.createElement("div");
      badges.className = "tuner-badges";
      badges.innerHTML = `<span class="tuner-def">def:${defaults[item.key]}</span><span class="tuner-unit">${item.unit}</span>`;

      labelWrap.appendChild(label);
      labelWrap.appendChild(badges);

      const inputsWrap = document.createElement("div");
      inputsWrap.className = "tuner-inputs";

      const range = document.createElement("input");
      range.type = "range";
      range.min = String(item.min);
      range.max = String(item.max);
      range.step = String(item.step);
      range.value = String(cfg[item.key]);
      range.tabIndex = -1;

      const num = document.createElement("input");
      num.type = "number";
      num.min = String(item.min);
      num.max = String(item.max);
      num.step = String(item.step);
      num.value = String(cfg[item.key]);
      num.className = "tuner-num";

      const handleUpdate = (raw) => {
        const val = Number(raw);
        if (!Number.isFinite(val)) return;
        updateActiveConfig({ [item.key]: val });
        range.value = String(clamp(val, item.min, item.max));
        if (document.activeElement !== num) num.value = String(val);
        adaptLiveAircraftToParam(item.key, val);
        saveConfigLocally();
        syncWsConfig({ [item.key]: val });
      };

      range.addEventListener("input", () => handleUpdate(range.value));
      range.addEventListener("change", () => range.blur());

      num.addEventListener("input", () => {
        const val = Number(num.value);
        if (!Number.isFinite(val)) return;
        range.value = String(clamp(val, item.min, item.max));
        updateActiveConfig({ [item.key]: val });
        adaptLiveAircraftToParam(item.key, val);
        saveConfigLocally();
        syncWsConfig({ [item.key]: val });
      });
      num.addEventListener("change", () => {
        handleUpdate(num.value);
        num.blur();
      });

      inputsWrap.appendChild(range);
      inputsWrap.appendChild(num);

      const desc = document.createElement("div");
      desc.className = "tuner-desc";
      desc.textContent = item.desc;

      row.appendChild(labelWrap);
      row.appendChild(inputsWrap);
      row.appendChild(desc);
      list.appendChild(row);

      controls.set(item.key, { range, num, item });
    }

    section.appendChild(list);
    elGroups.appendChild(section);
  }
  if (elParamCount) {
    elParamCount.textContent = `${craftLabel} • ${controls.size} PARAMETERS`;
  }
}

// Aircraft switcher, scenario buttons & dock actions
for (const btn of craftButtons) {
  btn.addEventListener("click", () => selectAircraft(btn.dataset.aircraft));
}

for (const btn of scenButtons) {
  btn.addEventListener("click", () => {
    if (btn.dataset.aircraft && btn.dataset.aircraft !== activeAircraft) {
      selectAircraft(btn.dataset.aircraft);
    }
    startScenario(btn.dataset.scenario, true);
  });
}

elRespawnBtn.addEventListener("click", (e) => {
  startScenario(activeScenario, true);
  e.currentTarget.blur();
});

document.getElementById("lab-reset-btn").addEventListener("click", (e) => {
  const cfg = updateActiveConfig({ reset: true });
  applyExternalConfig(cfg);
  syncWsConfig({ reset: true });
  startScenario(activeScenario, false);
  e.currentTarget.blur();
});

const elSaveBtn = document.getElementById("lab-save-btn");
elSaveBtn.addEventListener("click", () => {
  saveConfigLocally();
  syncWsConfig(collectCleanConfig(), true);
  elSaveBtn.textContent = "Saved!";
  setTimeout(() => { elSaveBtn.textContent = "Save Config"; }, 1200);
  elSaveBtn.blur();
});

const elCopyBtn = document.getElementById("lab-copy-btn");
elCopyBtn.addEventListener("click", async () => {
  const json = JSON.stringify(collectCleanConfig(), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    elCopyBtn.textContent = "Copied!";
  } catch {
    window.prompt(`Copy ${activeAircraft === "heli" ? "Chopper" : "P-47"} config JSON:`, json);
  }
  setTimeout(() => { elCopyBtn.textContent = "Copy JSON"; }, 1200);
  elCopyBtn.blur();
});

elSimSpeed.addEventListener("change", () => {
  const val = Number(elSimSpeed.value);
  if (val > 0) simSpeedBeforePause = val;
  elSimSpeed.blur();
});

for (const cb of [elAutoThrottle, elAutoLoop, elShowOverlay]) {
  cb.addEventListener("change", () => cb.blur());
}

// Spacebar pauses / resumes simulation outside numeric inputs
window.addEventListener("keydown", (e) => {
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    const cur = Number(elSimSpeed.value);
    if (cur === 0) {
      elSimSpeed.value = String(simSpeedBeforePause || 1);
    } else {
      simSpeedBeforePause = cur;
      elSimSpeed.value = "0";
    }
  }
});

const input = new KeyboardInput((action) => {
  if (action.type === "utility") {
    if (activeAircraft === "heli" && Number(elSimSpeed.value) > 0) {
      handlePlayerUtility(state, PLAYER_ID);
      if (state.events.length) {
        renderer.ingestEvents(state.events);
        state.events = [];
      }
    }
    return;
  }
  if (action.type === "restartMatch") {
    startScenario(activeScenario, true);
  }
});

// Optional WS connection strictly for pushing tuned config updates to server (simulation itself stays 100% local)
function connectConfigBridge() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    ws = new WebSocket(`${proto}//${location.host}/ws?tuner=1`);
    ws.onopen = () => {
      wsConnected = true;
      elNetStatus.textContent = "WS CONFIG BRIDGE";
      elNetStatus.style.color = "#22c55e";
      elNetStatus.style.borderColor = "#22c55e";
    };
    ws.onclose = () => {
      wsConnected = false;
      elNetStatus.textContent = "STANDALONE LOCAL";
      elNetStatus.style.color = "#94a3b8";
      elNetStatus.style.borderColor = "#334155";
      setTimeout(connectConfigBridge, 4000);
    };
    ws.onerror = () => {
      wsConnected = false;
    };
  } catch {
    // Offline local mode works seamlessly without WS
  }
}

function buildEffectiveInput(player, baseSnap) {
  const effective = { ...baseSnap };
  if (activeAircraft === "heli") {
    if (elAutoThrottle.checked && !effective.up && !effective.down && player.alive && player.y > 2) {
      if (player.vy < -1) effective.up = true;
    } else if (activeScenario === "hard_landing" && !baseSnap.up && !baseSnap.down && player.alive && player.y > 0.5) {
      effective.down = true;
    }
    return effective;
  }

  if (elAutoThrottle.checked && !effective.left && !effective.right && player.alive && !player.crashing && player.turnTimer === 0) {
    if (player.dir > 0) effective.right = true;
    else effective.left = true;
  }
  return effective;
}

function renderHeliPhysicsOverlay(ctx, player, baseSnap) {
  const w = renderer.lastViewW || canvas.clientWidth;
  const groundScreenY = renderer.lastGroundScreenY;
  if (!w || !groundScreenY) return;

  const cfg = AIRCRAFT_CONFIG.heli;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 1. Nose / weapon aim rays & velocity vector around chopper
  const origin = renderer.worldToScreen(player.x, player.y + 18, w, groundScreenY);
  const rayLen = 88 * renderer.camZoom;
  const drawRay = (angleRad, color, dashed, width = 1.4, label = "") => {
    const dx = player.dir * Math.cos(angleRad) * rayLen;
    const dy = -Math.sin(angleRad) * rayLen;
    ctx.save();
    ctx.beginPath();
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(origin.sx, origin.sy);
    ctx.lineTo(origin.sx + dx, origin.sy + dy);
    ctx.stroke();
    if (label) {
      ctx.fillStyle = color;
      ctx.font = "700 10px ui-monospace, monospace";
      ctx.fillText(label, origin.sx + dx + (player.dir > 0 ? 4 : -28), origin.sy + dy + 3);
    }
    ctx.restore();
  };

  const maxTilt = cfg.maxTiltPitch ?? 0.24;
  drawRay(0, "rgba(148, 163, 184, 0.5)", true, 1, "0°");
  drawRay(maxTilt, "rgba(56, 189, 248, 0.35)", true, 1, "");
  drawRay(-maxTilt, "rgba(56, 189, 248, 0.35)", true, 1, "");

  const pitchAngle = player.pitch || 0;
  const gunAngle = pitchAngle + ((cfg.primaryAngleDeg || 0) * Math.PI) / 180;
  drawRay(pitchAngle, "#38bdf8", false, 2, "MSL");
  drawRay(gunAngle, "#f59e0b", true, 1.6, Math.abs(cfg.primaryAngleDeg || 0) > 0.2 ? "GUN" : "");

  // Velocity vector arrow (vx, vy)
  const velMag = Math.hypot(player.vx, player.vy);
  if (velMag > 8) {
    const velScale = 0.28 * renderer.camZoom;
    const vxEnd = origin.sx + player.vx * velScale;
    const vyEnd = origin.sy - player.vy * velScale;
    ctx.save();
    ctx.strokeStyle = "#22c55e";
    ctx.fillStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(origin.sx, origin.sy);
    ctx.lineTo(vxEnd, vyEnd);
    ctx.stroke();
    const ang = Math.atan2(vyEnd - origin.sy, vxEnd - origin.sx);
    ctx.beginPath();
    ctx.moveTo(vxEnd, vyEnd);
    ctx.lineTo(vxEnd - Math.cos(ang - 0.45) * 7, vyEnd - Math.sin(ang - 0.45) * 7);
    ctx.lineTo(vxEnd - Math.cos(ang + 0.45) * 7, vyEnd - Math.sin(ang + 0.45) * 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 2. Boarding / rescue envelopes
  const maxAlt = cfg.pickupMaxAlt ?? 15;
  const maxSpd = cfg.pickupMaxSpeed ?? 95;
  const boardOk = player.y <= maxAlt && Math.abs(player.vx) < maxSpd;

  if (player.y <= 140 || activeScenario === "rescue" || activeScenario === "paratroop") {
    const altLeft = renderer.worldToScreen(player.x - 160, maxAlt, w, groundScreenY);
    const altRight = renderer.worldToScreen(player.x + 160, maxAlt, w, groundScreenY);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = boardOk ? "rgba(34, 197, 94, 0.75)" : "rgba(245, 158, 11, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(altLeft.sx, altLeft.sy);
    ctx.lineTo(altRight.sx, altRight.sy);
    ctx.stroke();
    ctx.fillStyle = boardOk ? "#86efac" : "#fde68a";
    ctx.font = "700 10px ui-monospace, monospace";
    ctx.fillText(`BOARD ≤ ${maxAlt}m`, altRight.sx + 6, altRight.sy + 3);
    ctx.restore();
  }

  if ((state.civilians || []).length > 0) {
    const attractR = Math.max(24, cfg.civAttractRadius ?? 180);
    const bLeft = renderer.worldToScreen(player.x - attractR, 4, w, groundScreenY);
    const bRight = renderer.worldToScreen(player.x + attractR, 4, w, groundScreenY);
    const bBotL = renderer.worldToScreen(player.x - attractR, 0, w, groundScreenY);
    const bBotR = renderer.worldToScreen(player.x + attractR, 0, w, groundScreenY);
    ctx.save();
    ctx.strokeStyle = "rgba(253, 224, 71, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(bBotL.sx, bBotL.sy);
    ctx.lineTo(bLeft.sx, bLeft.sy);
    ctx.lineTo(bRight.sx, bRight.sy);
    ctx.lineTo(bBotR.sx, bBotR.sy);
    ctx.stroke();
    ctx.fillStyle = "#fde047";
    ctx.font = "700 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`CIV ATTRACT ±${attractR}m`, (bLeft.sx + bRight.sx) * 0.5, bLeft.sy - 6);
    ctx.restore();
  }

  // 3. Predicted paratrooper drop arc when airborne & carrying infantry
  if (player.y > maxAlt && (player.passengers || []).includes("infantry")) {
    let px = player.x;
    let py = player.y - 18;
    let pvx = player.vx * (cfg.paraDropVxFactor ?? 0.25);
    const pvy = -Math.max(10, cfg.paraDescentSpeed ?? 65);
    const paraPts = [{ x: px, y: py }];
    for (let step = 0; step < 900 && py > 0; step++) {
      pvx *= Math.pow(0.15, DT);
      px += pvx * DT;
      py += pvy * DT;
      if (py <= 0) {
        paraPts.push({ x: px, y: 0 });
        break;
      }
      if (step % 6 === 0) paraPts.push({ x: px, y: py });
    }
    ctx.save();
    ctx.strokeStyle = "rgba(74, 222, 128, 0.85)";
    ctx.lineWidth = 1.8;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (let i = 0; i < paraPts.length; i++) {
      const pt = renderer.worldToScreen(paraPts[i].x, paraPts[i].y, w, groundScreenY);
      if (i === 0) ctx.moveTo(pt.sx, pt.sy);
      else ctx.lineTo(pt.sx, pt.sy);
    }
    ctx.stroke();
    const landPt = renderer.worldToScreen(px, 2, w, groundScreenY);
    ctx.setLineDash([]);
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(landPt.sx, landPt.sy, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#86efac";
    ctx.font = "700 9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("PARA", landPt.sx, landPt.sy - 8);
    ctx.restore();
  }

  // 4. Forward 2.5s trajectory predictor (150 x 60 Hz steps)
  const simPlayer = { ...player, passengers: [...(player.passengers || [])] };
  const points = [{ x: simPlayer.x, y: simPlayer.y, cat: "hover", marker: null }];
  const crashVy = Math.max(10, cfg.crashLandingVy ?? 185);

  for (let i = 1; i <= 150; i++) {
    const prevY = simPlayer.y;
    const predInput = buildEffectiveInput(simPlayer, baseSnap);
    if (simPlayer.y <= 2 && (predInput.left || predInput.right) && !predInput.down) {
      predInput.up = true;
    }
    const status = updateHeli(simPlayer, predInput, DT);

    if (status === "crash") {
      points.push({ x: simPlayer.x, y: Math.max(0, simPlayer.y), cat: "crash", marker: "crash" });
      break;
    }

    let cat = "hover";
    let marker = i % 15 === 0 ? "tick" : null;
    if (simPlayer.y <= 0.05 && prevY > 0.05) {
      cat = "land";
      marker = "land";
    } else if (simPlayer.turnTimer > 0) {
      cat = "turn";
    } else if (simPlayer.vy < -crashVy) {
      cat = "crash";
    } else if (simPlayer.vy < -crashVy * 0.72) {
      cat = "fast_dive";
    } else if (simPlayer.vy > 15 || Math.abs(simPlayer.vx) > 65) {
      cat = "flight";
    }

    points.push({ x: simPlayer.x, y: simPlayer.y, cat, marker });
  }

  const colorMap = {
    flight: "#22c55e",
    hover: "#38bdf8",
    turn: "#a855f7",
    fast_dive: "#f59e0b",
    crash: "#ef4444",
    land: "#22d3ee"
  };

  ctx.lineWidth = 2.5;
  for (let i = 1; i < points.length; i++) {
    const a = renderer.worldToScreen(points[i - 1].x, points[i - 1].y + 16, w, groundScreenY);
    const b = renderer.worldToScreen(points[i].x, points[i].y + 16, w, groundScreenY);
    const col = colorMap[points[i].cat] || "#38bdf8";
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();

    if (points[i].marker === "tick") {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (points[i].marker === "land") {
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (points[i].marker === "crash") {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(b.sx - 6, b.sy - 6);
      ctx.lineTo(b.sx + 6, b.sy + 6);
      ctx.moveTo(b.sx + 6, b.sy - 6);
      ctx.lineTo(b.sx - 6, b.sy + 6);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function renderPhysicsOverlay(ctx, player, baseSnap) {
  if (!elShowOverlay.checked || !player || !player.alive) return;
  if (activeAircraft === "heli") {
    renderHeliPhysicsOverlay(ctx, player, baseSnap);
    return;
  }

  const w = renderer.lastViewW || canvas.clientWidth;
  const groundScreenY = renderer.lastGroundScreenY;
  if (!w || !groundScreenY) return;

  const cfg = AIRCRAFT_CONFIG.p47;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 1. Nose reference rays around aircraft
  const origin = renderer.worldToScreen(player.x, player.y + 18, w, groundScreenY);
  const rayLen = 84 * renderer.camZoom;
  const drawRay = (angleRad, color, dashed, width = 1.4, label = "") => {
    const dx = player.dir * Math.cos(angleRad) * rayLen;
    const dy = -Math.sin(angleRad) * rayLen;
    ctx.save();
    ctx.beginPath();
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(origin.sx, origin.sy);
    ctx.lineTo(origin.sx + dx, origin.sy + dy);
    ctx.stroke();
    if (label) {
      ctx.fillStyle = color;
      ctx.font = "700 10px ui-monospace, monospace";
      ctx.fillText(label, origin.sx + dx + (player.dir > 0 ? 4 : -34), origin.sy + dy + 3);
    }
    ctx.restore();
  };

  drawRay(0, "rgba(148, 163, 184, 0.55)", true, 1, "0° (S4↑)");
  drawRay(cfg.maxPitch, "rgba(56, 189, 248, 0.4)", true, 1, `+${Math.round((cfg.maxPitch * 180) / Math.PI)}°`);
  drawRay(cfg.stage3UpPitch, "rgba(34, 197, 94, 0.65)", true, 1.1, "S3↑");
  drawRay(cfg.glidePitch, "rgba(245, 158, 11, 0.75)", true, 1.2, "S3↓");
  drawRay(cfg.maxDivePitch, "rgba(239, 68, 68, 0.75)", true, 1.2, "S4/↓");

  const effPitch = player.effectivePitch ?? player.pitch ?? 0;
  drawRay(effPitch, "#f8fafc", false, 2);

  // 2. Forward 2.5s trajectory predictor (150 x 60 Hz steps)
  const simPlayer = { ...player };
  const simState = {
    tick: state.tick,
    time: state.time,
    events: [],
    targets: [],
    paratroopers: [],
    units: [],
    civilians: [],
    teamFunds: { ...state.teamFunds },
    players: { [simPlayer.id]: simPlayer }
  };

  const initialCat = simPlayer.crashing ? "crash" : `stage${simPlayer.flightStage || 1}`;
  const points = [{ x: simPlayer.x, y: simPlayer.y, cat: initialCat, marker: null }];
  let bouncedFlag = false;

  for (let i = 1; i <= 150; i++) {
    simState.events = [];
    simState.tick += 1;
    simState.time = simState.tick * DT;

    if (!simPlayer.alive) break;
    if (simPlayer.crashing) {
      updateCrashSlide(simState, simPlayer, DT);
    } else {
      const predInput = buildEffectiveInput(simPlayer, baseSnap);
      updateP47(simState, simPlayer, predInput, DT);
    }

    const bouncedNow = simState.events.some((ev) => ev.type === "hard_landing" && ev.bounced);
    const crashNow = simState.events.some((ev) => ev.type === "crash_slide_start");
    if (bouncedNow) bouncedFlag = true;
    else if (simPlayer.y <= 0.1 || simPlayer.vy < -15) {
      if (simPlayer.vy < -15) bouncedFlag = false;
    }

    let cat = `stage${simPlayer.flightStage || 1}`;
    if (simPlayer.crashing || crashNow) cat = "crash";
    else if (bouncedFlag && simPlayer.vy > -10) cat = "bounce";

    points.push({
      x: simPlayer.x,
      y: simPlayer.y,
      cat,
      marker: crashNow ? "crash" : bouncedNow ? "bounce" : i % 15 === 0 ? "tick" : null
    });
  }

  const colorMap = {
    stage1: "#22c55e",
    stage2: "#38bdf8",
    stage3: "#f59e0b",
    stage4: "#ef4444",
    bounce: "#22d3ee",
    crash: "#f97316"
  };

  ctx.lineWidth = 2.5;
  for (let i = 1; i < points.length; i++) {
    const a = renderer.worldToScreen(points[i - 1].x, points[i - 1].y + 16, w, groundScreenY);
    const b = renderer.worldToScreen(points[i].x, points[i].y + 16, w, groundScreenY);
    ctx.strokeStyle = colorMap[points[i].cat] || "#22c55e";
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();

    if (points[i].marker === "tick") {
      ctx.fillStyle = colorMap[points[i].cat] || "#22c55e";
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (points[i].marker === "bounce") {
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (points[i].marker === "crash") {
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(b.sx - 6, b.sy - 6);
      ctx.lineTo(b.sx + 6, b.sy + 6);
      ctx.moveTo(b.sx + 6, b.sy - 6);
      ctx.lineTo(b.sx - 6, b.sy + 6);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function updateHeliTelemetry(player) {
  const cfg = AIRCRAFT_CONFIG.heli;
  const maxVx = Math.max(10, cfg.maxSpeedX);
  const vxPct = clamp(((player.vx + maxVx) / (2 * maxVx)) * 100, 0, 100);
  const pickupSpd = cfg.pickupMaxSpeed ?? 95;
  const boardHalfPct = clamp((pickupSpd / maxVx) * 50, 0, 50);
  const turnThresh = cfg.turnSpeedThreshold ?? 35;
  const turnPct = clamp(((player.dir * turnThresh + maxVx) / (2 * maxVx)) * 100, 0, 100);

  elHeliVxReadout.textContent = `VX: ${player.vx >= 0 ? "+" : ""}${Math.round(player.vx)} / ±${Math.round(maxVx)} px/s`;
  elHeliVxBoardZone.style.left = `${(50 - boardHalfPct).toFixed(2)}%`;
  elHeliVxBoardZone.style.width = `${(boardHalfPct * 2).toFixed(2)}%`;
  elHeliPinTurn.style.left = `${turnPct.toFixed(2)}%`;
  elHeliVxNeedle.style.left = `${vxPct.toFixed(2)}%`;
  if (vxPct >= 50) {
    elHeliVxFill.style.left = "50%";
    elHeliVxFill.style.width = `${(vxPct - 50).toFixed(2)}%`;
  } else {
    elHeliVxFill.style.left = `${vxPct.toFixed(2)}%`;
    elHeliVxFill.style.width = `${(50 - vxPct).toFixed(2)}%`;
  }
  elHeliVxMin.textContent = `-${Math.round(maxVx)}`;
  elHeliVxBoardLbl.textContent = `±${Math.round(pickupSpd)} BOARD`;
  elHeliVxMax.textContent = `+${Math.round(maxVx)}`;

  const maxVy = Math.max(10, cfg.maxSpeedY);
  const vyPct = clamp(((player.vy + maxVy) / (2 * maxVy)) * 100, 0, 100);
  const crashVy = Math.max(10, cfg.crashLandingVy ?? 185);
  const crashPct = clamp(((-crashVy + maxVy) / (2 * maxVy)) * 100, 0, 50);
  const sinkPct = clamp(((-cfg.idleSinkSpeed + maxVy) / (2 * maxVy)) * 100, 0, 100);

  elHeliVyReadout.textContent = `VY: ${player.vy >= 0 ? "+" : ""}${Math.round(player.vy)} px/s`;
  elHeliVyCrashZone.style.width = `${crashPct.toFixed(2)}%`;
  elHeliVySinkPin.style.left = `${sinkPct.toFixed(2)}%`;
  elHeliVyNeedle.style.left = `${vyPct.toFixed(2)}%`;
  if (vyPct >= 50) {
    elHeliVyFill.style.left = "50%";
    elHeliVyFill.style.width = `${(vyPct - 50).toFixed(2)}%`;
  } else {
    elHeliVyFill.style.left = `${vyPct.toFixed(2)}%`;
    elHeliVyFill.style.width = `${(50 - vyPct).toFixed(2)}%`;
  }
  const vyColor = player.vy < -crashVy ? "#ef4444" : player.vy < -crashVy * 0.72 ? "#f59e0b" : player.vy >= 0 ? "#22c55e" : "#38bdf8";
  elHeliVyFill.style.background = vyColor;

  let phase = "HOVER / IDLE SINK";
  let phaseColor = "#38bdf8";
  if (!player.alive) {
    phase = "DESTROYED (RESPAWN)";
    phaseColor = "#ef4444";
  } else if (player.turnTimer > 0) {
    phase = "YAW TURNAROUND";
    phaseColor = "#a855f7";
  } else if (player.y <= 0.5 && isOnFriendlyPad(player)) {
    phase = "LANDED (BASE PAD)";
    phaseColor = "#22d3ee";
  } else if (player.y <= 0.5) {
    phase = "LANDED (FIELD)";
    phaseColor = "#38bdf8";
  } else if (player.vy < -crashVy && !isOnFriendlyPad(player)) {
    phase = "CRASH DANGER!";
    phaseColor = "#ef4444";
  } else if (player.vy < -crashVy * 0.72) {
    phase = "FAST DIVE";
    phaseColor = "#f59e0b";
  } else if (player.vy > 12) {
    phase = "CLIMBING";
    phaseColor = "#22c55e";
  }
  elHeliPhase.textContent = phase;
  elHeliPhase.style.color = phaseColor;

  const burst = player.burstReservoir ?? BURST_MAX_TICKS;
  const burstPct = clamp((burst / BURST_MAX_TICKS) * 100, 0, 100);
  elHeliBurstFill.style.width = `${burstPct.toFixed(1)}%`;
  elHeliBurstFill.style.background = burst > 0 ? "#22c55e" : "#f59e0b";
  elHeliBurstReadout.textContent = `${burst}/${BURST_MAX_TICKS} • ${burst > 0 ? "READY (12/s)" : "SLOW (2/s)"}`;

  elHeliAmmoReadout.textContent = `${player.secondaryAmmo} / ${player.maxSecondary}`;
  const infCount = (player.passengers || []).filter((t) => t === "infantry").length;
  const civCount = (player.passengers || []).filter((t) => t === "civilian").length;
  elHeliCabinReadout.textContent = `${infCount} INF • ${civCount} CIV (${(player.passengers || []).length}/${player.cabinCapacity})`;

  const pickupAlt = cfg.pickupMaxAlt ?? 15;
  if ((player.passengers || []).length >= player.cabinCapacity) {
    elHeliBoardStatus.textContent = "CABIN FULL";
    elHeliBoardStatus.style.color = "#f59e0b";
  } else if (player.y > pickupAlt) {
    elHeliBoardStatus.textContent = "TOO HIGH";
    elHeliBoardStatus.style.color = "#f59e0b";
  } else if (Math.abs(player.vx) >= pickupSpd) {
    elHeliBoardStatus.textContent = "TOO FAST";
    elHeliBoardStatus.style.color = "#ef4444";
  } else {
    elHeliBoardStatus.textContent = "BOARD READY";
    elHeliBoardStatus.style.color = "#22c55e";
  }

  const pitchDeg = ((player.pitch || 0) * 180) / Math.PI;
  const gunAimDeg = pitchDeg + (cfg.primaryAngleDeg || 0);
  elHeliTelPitch.textContent = `${pitchDeg >= 0 ? "+" : ""}${pitchDeg.toFixed(1)}°`;
  elHeliTelGunAim.textContent = `${gunAimDeg >= 0 ? "+" : ""}${gunAimDeg.toFixed(1)}°`;
  elHeliTelVxVy.textContent = `${Math.round(player.vx)} / ${Math.round(player.vy)}`;
  elHeliTelAlt.textContent = `${Math.round(player.y)}m • ${Math.ceil(player.hp)}/${player.maxHp}`;
}

function updateTelemetry(player) {
  if (!player) return;
  if (activeAircraft === "heli") {
    updateHeliTelemetry(player);
    return;
  }

  const cfg = AIRCRAFT_CONFIG.p47;
  const topScale = Math.max(cfg.maxSpeed, cfg.cruiseSpeed, cfg.minGlideSpeed, 100);
  const pct = (v) => `${clamp((v / topScale) * 100, 0, 100).toFixed(2)}%`;

  elSpecReadout.textContent = `${Math.round(player.speed)} / ${Math.round(cfg.maxSpeed)} px/s`;
  elSpecFill.style.width = pct(player.speed);
  elSpecNeedle.style.left = pct(player.speed);
  elPinMinGlide.style.left = pct(cfg.minGlideSpeed);
  elPinTakeoff.style.left = pct(cfg.takeoffSpeed);
  elPinCruise.style.left = pct(cfg.cruiseSpeed);

  const stage = player.flightStage || 1;
  const lift = computeStageLift(player, cfg);
  const liftColor = stage === 1 ? "#22c55e" : stage === 2 ? "#38bdf8" : stage === 3 ? "#f59e0b" : "#ef4444";
  elLiftPct.textContent = `${Math.round(lift * 100)}%`;
  elLiftPct.style.color = liftColor;
  elLiftFill.style.width = `${lift * 100}%`;
  elLiftFill.style.background = liftColor;

  let phase = "STAGE 1 • FULL LIFT";
  let phaseColor = "#22c55e";
  if (!player.alive) {
    phase = "DESTROYED (RESPAWN)";
    phaseColor = "#ef4444";
  } else if (player.crashing) {
    phase = `CRASH SLIDE (${player.crashSlideTicks}t)`;
    phaseColor = "#f97316";
  } else if (player.y <= 0.05 && Math.abs(player.vy) < 5) {
    phase = player.speed >= cfg.takeoffSpeed ? "ROTATE READY (↑)" : "RUNWAY ROLL";
    phaseColor = "#38bdf8";
  } else if (player.turnTimer > 0) {
    phase = "WIDE U-TURN";
    phaseColor = "#a855f7";
  } else if (stage === 2) {
    phase = "STAGE 2 • GRACE LIFT";
    phaseColor = "#38bdf8";
  } else if (stage === 3) {
    phase = "STAGE 3 • SLOW DESCENT";
    phaseColor = "#f59e0b";
  } else if (stage === 4) {
    phase = "STAGE 4 • FAST DESCENT";
    phaseColor = "#ef4444";
  }
  elPhase.textContent = phase;
  elPhase.style.color = phaseColor;

  const graceDur = Math.max(0.05, cfg.throttleReleaseDelay);
  const graceVal = Math.min(graceDur, player.throttleOffTime || 0);
  elCoastReadout.textContent = `${graceVal.toFixed(2)} / ${graceDur.toFixed(2)}s`;
  elCoastFill.style.width = `${clamp((graceVal / graceDur) * 100, 0, 100)}%`;

  const stage3Dur = Math.max(0.05, cfg.stallGlideDelay);
  const stage3Val = Math.min(stage3Dur, player.stallTime || 0);
  elStallReadout.textContent = `${stage3Val.toFixed(2)} / ${stage3Dur.toFixed(2)}s`;
  elStallFill.style.width = `${clamp((stage3Val / stage3Dur) * 100, 0, 100)}%`;

  const pitchDeg = ((player.pitch || 0) * 180) / Math.PI;
  const effPitchDeg = ((player.effectivePitch ?? player.pitch ?? 0) * 180) / Math.PI;
  elPitch.textContent = `${pitchDeg >= 0 ? "+" : ""}${pitchDeg.toFixed(1)}°`;
  elEffPitch.textContent = `${effPitchDeg >= 0 ? "+" : ""}${effPitchDeg.toFixed(1)}°`;
  elVxVy.textContent = `${Math.round(player.vx)} / ${Math.round(player.vy)}`;
  elAlt.textContent = `${Math.round(player.y)}m • ${Math.ceil(player.hp)}/${player.maxHp}`;
}

function handleAutoLoop(player, dt) {
  if (!elAutoLoop.checked || !player) return;

  if (activeAircraft === "heli") {
    const groundedStop = player.y <= 0.1 && Math.abs(player.vy) < 2 && Math.abs(player.vx) < 5;
    const shouldLoop = activeScenario === "hard_landing"
      ? (!player.alive || groundedStop)
      : !player.alive;
    if (shouldLoop) {
      loopCooldown += dt;
      if (loopCooldown >= 0.75) {
        startScenario(activeScenario, true);
      }
    }
    return;
  }

  if (activeScenario === "cruise" || activeScenario === "runway") return;
  const groundedStop = player.y <= 0.1 && player.speed < 5 && !player.crashing;
  const settledStall = activeScenario === "stall" && (!player.alive || groundedStop);
  const settledBrake = activeScenario === "brake" && (!player.alive || groundedStop);
  const settledCrash = activeScenario === "crash" && (!player.alive || groundedStop);
  const settledBounce = activeScenario === "bounce" && (!player.alive || groundedStop || (player.x > 650 && !player.crashing));

  if (settledStall || settledBrake || settledCrash || settledBounce) {
    loopCooldown += dt;
    if (loopCooldown >= 0.75) {
      startScenario(activeScenario, true);
    }
  }
}

await renderer.loadAll();
selectAircraft(activeAircraft);
connectConfigBridge();

let accumulator = 0;
let lastTime = performance.now();

function loop(now) {
  const realDt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const simScale = Number(elSimSpeed.value);
  const scaledDt = realDt * simScale;

  const baseSnap = input.getSnapshot();
  const player = state.players[PLAYER_ID];

  if (simScale > 0) {
    accumulator += scaledDt;
    while (accumulator >= DT) {
      if (state.baseAa?.enemy) {
        state.baseAa.enemy.flakCooldown = 999;
        state.baseAa.enemy.samCooldown = 999;
      }
      if (state.baseAa?.allied) {
        state.baseAa.allied.flakCooldown = 999;
        state.baseAa.allied.samCooldown = 999;
      }
      const effectiveInput = buildEffectiveInput(player, baseSnap);
      stepSimulation(state, { [PLAYER_ID]: effectiveInput });
      if (state.events.length) renderer.ingestEvents(state.events);
      handleAutoLoop(player, DT);
      accumulator -= DT;
    }
  }

  renderer.render(state, PLAYER_ID, simScale > 0 ? scaledDt : 0);
  renderPhysicsOverlay(renderer.ctx, player, baseSnap);
  updateTelemetry(player);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
