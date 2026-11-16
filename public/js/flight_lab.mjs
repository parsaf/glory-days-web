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

const STORAGE_KEY = "glory_days_p47_config_v2";
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

const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
addPlayer(state, PLAYER_ID, "allied", "p47");

let activeScenario = "stall";
let loopCooldown = 0;
let ws = null;
let wsConnected = false;
let simSpeedBeforePause = 1;

// DOM references
const elNetStatus = document.getElementById("lab-net-status");
const elParamCount = document.getElementById("dock-param-count");
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

function syncWsConfig(patch, persist = false) {
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "updateP47Config", patch, persist }));
  }
}

function startScenario(mode, snapCamera = true) {
  activeScenario = mode;
  loopCooldown = 0;

  for (const btn of scenButtons) {
    btn.classList.toggle("active", btn.dataset.scenario === mode);
    btn.blur();
  }

  // Only "cruise" locks Auto-Throttle ON for hands-free Stage 1 wave tuning; other modes let user see off-throttle behavior immediately
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

function adaptLiveAircraftToParam(key, val) {
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
  if (elParamCount) {
    elParamCount.textContent = `${controls.size} TUNABLE PARAMETERS`;
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
  syncWsConfig(fullPatch, true);
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
  if (elAutoThrottle.checked && !effective.left && !effective.right && player.alive && !player.crashing && player.turnTimer === 0) {
    if (player.dir > 0) effective.right = true;
    else effective.left = true;
  }
  return effective;
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

function updateTelemetry(player) {
  if (!player) return;
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
  if (!elAutoLoop.checked || activeScenario === "cruise" || activeScenario === "runway") return;
  if (!player) return;

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

buildControls();
await renderer.loadAll();
startScenario("stall", true);
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
