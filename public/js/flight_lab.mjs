import {
  AIRCRAFT_CONFIG,
  DEFAULT_P47_CONFIG,
  DT,
  P47_TUNING_SCHEMA
} from "../../shared/constants.mjs";
import {
  addPlayer,
  createInitialState,
  spawnPlayerP47Test,
  stepSimulation,
  updateCrashSlide,
  updateP47,
  updateP47Config
} from "../../shared/simulation.mjs";
import { KeyboardInput } from "./input.mjs";
import { SpriteBattlefieldRenderer } from "./renderer.mjs";

const STORAGE_KEY = "glory_days_p47_config";
const PLAYER_ID = "lab_pilot";

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const canvas = document.getElementById("battlefield");
const renderer = new SpriteBattlefieldRenderer(canvas);

// Restore saved lab parameters if present
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) updateP47Config(JSON.parse(saved));
} catch {
  // Ignore invalid local storage
}

const state = createInitialState({ includePracticeTargets: true });
addPlayer(state, PLAYER_ID, "allied", "p47");

let activeScenario = "cruise";
let loopCooldown = 0;
let ws = null;
let wsConnected = false;
let simSpeedBeforePause = 1;

// DOM references
const elNetStatus = document.getElementById("lab-net-status");
const elGroups = document.getElementById("lab-groups");
const elAutoThrottle = document.getElementById("opt-auto-throttle");
const elAutoLoop = document.getElementById("opt-auto-loop");
const elShowOverlay = document.getElementById("opt-show-overlay");
const elSimSpeed = document.getElementById("opt-sim-speed");
const scenButtons = Array.from(document.querySelectorAll(".scen-btn"));

// Telemetry elements
const elSpecReadout = document.getElementById("spec-readout");
const elSpecFill = document.getElementById("spec-fill");
const elSpecNeedle = document.getElementById("spec-needle");
const elPinMinGlide = document.getElementById("pin-min-glide");
const elPinTakeoff = document.getElementById("pin-takeoff");
const elPinStall = document.getElementById("pin-stall");
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

const controls = new Map();

function saveConfigLocally() {
  try {
    const clean = {};
    for (const group of P47_TUNING_SCHEMA) {
      for (const item of group.items) {
        clean[item.key] = AIRCRAFT_CONFIG.p47[item.key];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage quota errors
  }
}

function syncWsConfig(patch) {
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "updateP47Config", patch }));
  }
}

function startScenario(mode, snapCamera = true) {
  activeScenario = mode;
  loopCooldown = 0;

  for (const btn of scenButtons) {
    btn.classList.toggle("active", btn.dataset.scenario === mode);
    btn.blur();
  }

  // Cruise runs hands-free at cruiseSpeed; other scenarios release throttle naturally unless user holds arrows
  elAutoThrottle.checked = mode === "cruise";
  const simMode = mode === "cruise" ? "air" : mode;
  spawnPlayerP47Test(state, PLAYER_ID, simMode);
  state.paratroopers = state.paratroopers.slice(-4);

  if (snapCamera) {
    const p = state.players[PLAYER_ID];
    renderer.camX = p.x + p.dir * 130;
    renderer.camY = Math.max(150, p.y + 90);
  }
}

function adaptLiveAircraftToParam(key, val) {
  const p = state.players[PLAYER_ID];
  if (!p || !p.alive || p.crashing) return;
  const cfg = AIRCRAFT_CONFIG.p47;
  const stallRange = Math.max(1, cfg.stallSpeed - cfg.minGlideSpeed);

  if (key === "cruiseSpeed" && (elAutoThrottle.checked || activeScenario === "cruise")) {
    p.speed = clamp(val, 0, cfg.maxSpeed);
    const ep = p.effectivePitch ?? p.pitch ?? 0;
    p.vx = p.dir * p.speed * Math.cos(ep);
    p.vy = p.speed * Math.sin(ep);
  } else if (key === "maxSpeed" && p.speed > val) {
    p.speed = val;
    const ep = p.effectivePitch ?? p.pitch ?? 0;
    p.vx = p.dir * p.speed * Math.cos(ep);
  }

  const lift = clamp((p.speed - cfg.minGlideSpeed) / stallRange, 0, 1);

  if ((key === "glidePitch" || key === "maxDivePitch") && lift < 1) {
    const afterDelay = Math.max(0, (p.stallTime || 0) - cfg.stallGlideDelay);
    const diveBlend = (p.stallTime || 0) < cfg.stallGlideDelay
      ? 0
      : clamp(afterDelay / 0.45, 0, 1) * (1 - lift);
    const targetDivePitch = cfg.glidePitch + (cfg.maxDivePitch - cfg.glidePitch) * diveBlend;
    p.pitch = targetDivePitch;
  } else if (key === "maxPitch") {
    p.pitch = clamp(p.pitch, -val, val);
  }

  // Recompute wave / pitch kinematics immediately so canvas updates even when paused
  const waveVelY = Math.cos(p.wavePhase || 0) * cfg.sineAmpVel * lift;
  const wavePitch = Math.cos(p.wavePhase || 0) * cfg.sinePitchAmp * lift;
  const minClampPitch = Math.min(-cfg.maxPitch, cfg.maxDivePitch);
  p.stallVy = (1 - lift) * cfg.stallSinkGravity;
  p.effectivePitch = clamp(p.pitch + wavePitch, minClampPitch, cfg.maxPitch);
  if (p.y > 0.5 && p.turnTimer === 0) {
    p.vx = p.dir * p.speed * Math.cos(p.effectivePitch);
    p.vy = p.speed * Math.sin(p.effectivePitch) + waveVelY - p.stallVy;
  }
}

function applyExternalConfig(cfgObj) {
  updateP47Config(cfgObj);
  for (const [key, entry] of controls.entries()) {
    const val = AIRCRAFT_CONFIG.p47[key];
    if (typeof val !== "number") continue;
    entry.range.value = String(clamp(val, entry.item.min, entry.item.max));
    if (document.activeElement !== entry.num) {
      entry.num.value = String(val);
    }
  }
  saveConfigLocally();
}

function buildControls() {
  elGroups.innerHTML = "";
  controls.clear();

  for (const group of P47_TUNING_SCHEMA) {
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
      badges.innerHTML = `<span class="tuner-def">def:${DEFAULT_P47_CONFIG[item.key]}</span><span class="tuner-unit">${item.unit}</span>`;

      labelWrap.appendChild(label);
      labelWrap.appendChild(badges);

      const inputsWrap = document.createElement("div");
      inputsWrap.className = "tuner-inputs";

      const range = document.createElement("input");
      range.type = "range";
      range.min = String(item.min);
      range.max = String(item.max);
      range.step = String(item.step);
      range.value = String(AIRCRAFT_CONFIG.p47[item.key]);
      range.tabIndex = -1;

      const num = document.createElement("input");
      num.type = "number";
      num.min = String(item.min);
      num.max = String(item.max);
      num.step = String(item.step);
      num.value = String(AIRCRAFT_CONFIG.p47[item.key]);
      num.className = "tuner-num";

      const handleUpdate = (raw) => {
        const val = Number(raw);
        if (!Number.isFinite(val)) return;
        updateP47Config({ [item.key]: val });
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
        updateP47Config({ [item.key]: val });
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
}

// Scenario buttons & dock actions
for (const btn of scenButtons) {
  btn.addEventListener("click", () => startScenario(btn.dataset.scenario, true));
}

document.getElementById("lab-reset-btn").addEventListener("click", (e) => {
  const cfg = updateP47Config({ reset: true });
  applyExternalConfig(cfg);
  syncWsConfig({ reset: true });
  startScenario(activeScenario, false);
  e.currentTarget.blur();
});

const elSaveBtn = document.getElementById("lab-save-btn");
elSaveBtn.addEventListener("click", () => {
  saveConfigLocally();
  const fullPatch = {};
  for (const group of P47_TUNING_SCHEMA) {
    for (const item of group.items) {
      fullPatch[item.key] = AIRCRAFT_CONFIG.p47[item.key];
    }
  }
  syncWsConfig(fullPatch);
  elSaveBtn.textContent = "Saved!";
  setTimeout(() => { elSaveBtn.textContent = "Save Config"; }, 1200);
  elSaveBtn.blur();
});

const elCopyBtn = document.getElementById("lab-copy-btn");
elCopyBtn.addEventListener("click", async () => {
  const out = {};
  for (const group of P47_TUNING_SCHEMA) {
    for (const item of group.items) {
      out[item.key] = AIRCRAFT_CONFIG.p47[item.key];
    }
  }
  const json = JSON.stringify(out, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    elCopyBtn.textContent = "Copied!";
  } catch {
    window.prompt("Copy P-47 config JSON:", json);
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

const input = new KeyboardInput(() => {});

// Optional WS connection strictly for pushing tuned config updates to server (simulation itself stays 100% local)
function connectConfigBridge() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    ws = new WebSocket(`${proto}//${location.host}/ws`);
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
  const cfg = AIRCRAFT_CONFIG.p47;
  if (elAutoThrottle.checked && !effective.left && !effective.right && player.alive && !player.crashing && player.turnTimer === 0 && player.speed <= cfg.cruiseSpeed + 0.5) {
    if (player.dir > 0) effective.right = true;
    else effective.left = true;
  }
  return effective;
}

function stabilizeAutoThrottle(player, baseSnap, startedAtOrBelowCruise) {
  const cfg = AIRCRAFT_CONFIG.p47;
  if (elAutoThrottle.checked && !baseSnap.left && !baseSnap.right && player.alive && !player.crashing && player.turnTimer === 0 && startedAtOrBelowCruise && player.speed > cfg.cruiseSpeed) {
    player.speed = cfg.cruiseSpeed;
    const ep = player.effectivePitch ?? player.pitch ?? 0;
    player.vx = player.dir * player.speed * Math.cos(ep);
  }
}

function renderPhysicsOverlay(ctx, player, baseSnap) {
  if (!elShowOverlay.checked || !player || !player.alive) return;
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

  drawRay(0, "rgba(148, 163, 184, 0.45)", true, 1, "0°");
  drawRay(cfg.maxPitch, "rgba(56, 189, 248, 0.45)", true, 1, `+${Math.round((cfg.maxPitch * 180) / Math.PI)}°`);
  drawRay(cfg.glidePitch, "rgba(245, 158, 11, 0.7)", true, 1.2, "GLD");
  drawRay(cfg.maxDivePitch, "rgba(239, 68, 68, 0.7)", true, 1.2, "DIVE");

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
    teamFunds: { ...state.teamFunds },
    players: { [simPlayer.id]: simPlayer }
  };

  const points = [{ x: simPlayer.x, y: simPlayer.y, cat: simPlayer.crashing ? "crash" : "cruise", marker: null }];
  let bouncedFlag = false;

  for (let i = 1; i <= 150; i++) {
    simState.events = [];
    simState.tick += 1;
    simState.time = simState.tick * DT;

    if (!simPlayer.alive) break;
    if (simPlayer.crashing) {
      updateCrashSlide(simState, simPlayer, DT);
    } else {
      const belowOrAtCruise = simPlayer.speed <= cfg.cruiseSpeed + 0.5;
      const predInput = buildEffectiveInput(simPlayer, baseSnap);
      updateP47(simState, simPlayer, predInput, DT);
      stabilizeAutoThrottle(simPlayer, baseSnap, belowOrAtCruise);
    }

    const bouncedNow = simState.events.some((ev) => ev.type === "hard_landing" && ev.bounced);
    const crashNow = simState.events.some((ev) => ev.type === "crash_slide_start");
    if (bouncedNow) bouncedFlag = true;
    else if (simPlayer.y <= 0.1 || simPlayer.vy < -15) {
      if (simPlayer.vy < -15) bouncedFlag = false;
    }

    const stallRange = Math.max(1, cfg.stallSpeed - cfg.minGlideSpeed);
    const lift = clamp((simPlayer.speed - cfg.minGlideSpeed) / stallRange, 0, 1);

    let cat = "cruise";
    if (simPlayer.crashing || crashNow) cat = "crash";
    else if (bouncedFlag && simPlayer.vy > -10) cat = "bounce";
    else if (lift < 0.99) cat = (simPlayer.stallTime || 0) < cfg.stallGlideDelay ? "glide" : "dive";

    points.push({
      x: simPlayer.x,
      y: simPlayer.y,
      cat,
      marker: crashNow ? "crash" : bouncedNow ? "bounce" : i % 15 === 0 ? "tick" : null
    });
  }

  const colorMap = {
    cruise: "#22c55e",
    glide: "#f59e0b",
    dive: "#ef4444",
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
      ctx.fillStyle = colorMap[points[i].cat];
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

function updateTelemetry(player) {
  if (!player) return;
  const cfg = AIRCRAFT_CONFIG.p47;
  const topScale = Math.max(cfg.maxSpeed, cfg.cruiseSpeed, cfg.stallSpeed, 100);
  const pct = (v) => `${clamp((v / topScale) * 100, 0, 100).toFixed(2)}%`;

  elSpecReadout.textContent = `${Math.round(player.speed)} / ${Math.round(cfg.maxSpeed)} px/s`;
  elSpecFill.style.width = pct(player.speed);
  elSpecNeedle.style.left = pct(player.speed);
  elPinMinGlide.style.left = pct(cfg.minGlideSpeed);
  elPinTakeoff.style.left = pct(cfg.takeoffSpeed);
  elPinStall.style.left = pct(cfg.stallSpeed);
  elPinCruise.style.left = pct(cfg.cruiseSpeed);

  const stallRange = Math.max(1, cfg.stallSpeed - cfg.minGlideSpeed);
  const lift = clamp((player.speed - cfg.minGlideSpeed) / stallRange, 0, 1);
  const liftColor = lift >= 0.99 ? "#22c55e" : lift > 0.25 ? "#f59e0b" : "#ef4444";
  elLiftPct.textContent = `${Math.round(lift * 100)}%`;
  elLiftPct.style.color = liftColor;
  elLiftFill.style.width = `${lift * 100}%`;
  elLiftFill.style.background = liftColor;

  let phase = "CRUISE";
  let phaseColor = "#22c55e";
  if (!player.alive) {
    phase = `DESTROYED (RESPAWN)`;
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
  } else if (lift < 1) {
    phase = (player.stallTime || 0) < cfg.stallGlideDelay ? "STALL GLIDE" : "STALL NOSE-DIVE";
    phaseColor = (player.stallTime || 0) < cfg.stallGlideDelay ? "#f59e0b" : "#ef4444";
  }
  elPhase.textContent = phase;
  elPhase.style.color = phaseColor;

  const coastDenom = Math.max(0.001, cfg.throttleReleaseDelay);
  const coastVal = Math.min(cfg.throttleReleaseDelay, player.throttleOffTime || 0);
  elCoastReadout.textContent = `${(player.throttleOffTime || 0).toFixed(2)} / ${cfg.throttleReleaseDelay.toFixed(2)}s`;
  elCoastFill.style.width = `${clamp((coastVal / coastDenom) * 100, 0, 100)}%`;

  const stallDenom = Math.max(0.001, cfg.stallGlideDelay);
  const stallVal = Math.min(cfg.stallGlideDelay, player.stallTime || 0);
  elStallReadout.textContent = `${(player.stallTime || 0).toFixed(2)} / ${cfg.stallGlideDelay.toFixed(2)}s`;
  elStallFill.style.width = `${clamp((stallVal / stallDenom) * 100, 0, 100)}%`;

  const pitchDeg = ((player.pitch || 0) * 180) / Math.PI;
  const effPitchDeg = ((player.effectivePitch ?? player.pitch ?? 0) * 180) / Math.PI;
  elPitch.textContent = `${pitchDeg >= 0 ? "+" : ""}${pitchDeg.toFixed(1)}°`;
  elEffPitch.textContent = `${effPitchDeg >= 0 ? "+" : ""}${effPitchDeg.toFixed(1)}°`;
  elVxVy.textContent = `${Math.round(player.vx)} / ${Math.round(player.vy)}`;
  elAlt.textContent = `${Math.round(player.y)}m • ${Math.ceil(player.hp)}/${player.maxHp}`;
}

function handleAutoLoop(player, dt) {
  if (!elAutoLoop.checked || activeScenario === "cruise" || activeScenario === "runway") return;
  if (!player) return;

  const settledStall = activeScenario === "stall" && !player.alive;
  const settledCrash = activeScenario === "crash" && !player.alive;
  const settledBounce = activeScenario === "bounce" && (!player.alive || (player.x > 650 && !player.crashing));

  if (settledStall || settledCrash || settledBounce) {
    loopCooldown += dt;
    if (loopCooldown >= 0.75) {
      startScenario(activeScenario, true);
    }
  }
}

buildControls();
await renderer.loadAll();
startScenario("cruise", true);
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
      const belowOrAtCruise = player.speed <= AIRCRAFT_CONFIG.p47.cruiseSpeed + 0.5;
      const effectiveInput = buildEffectiveInput(player, baseSnap);
      stepSimulation(state, { [PLAYER_ID]: effectiveInput });
      stabilizeAutoThrottle(player, baseSnap, belowOrAtCruise);
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
