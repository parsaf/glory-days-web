import {
  AIRCRAFT_CONFIG,
  BUNKER_TUNING_SCHEMA,
  DEFAULT_BUNKER_CONFIG,
  DEFAULT_GROUND_BEHAVIOR_CONFIG,
  DEFAULT_UNIT_CONFIG,
  DEFENSE_CONFIG,
  DT,
  GROUND_BEHAVIOR_CONFIG,
  GROUND_BEHAVIOR_TUNING_SCHEMA,
  GROUND_UNIT_ORDER,
  GROUND_UNIT_TUNING_SCHEMA,
  RENDER_HEIGHTS,
  STRATEGIC_CONFIG,
  TICK_RATE,
  UNIT_CONFIG
} from "../../shared/constants.mjs";
import {
  addPlayer,
  createInitialState,
  getGroundConfigSnapshot,
  getGroundUnitFireCooldown,
  getGroundUnitHitbox,
  getGroundUnitSpeedMultiplier,
  spawnCivilian,
  spawnGroundUnit,
  stepSimulation,
  updateGroundConfig
} from "../../shared/simulation.mjs";
import { SpriteBattlefieldRenderer } from "./renderer.mjs";

const STORAGE_KEY = "glory_days_ground_config_v1";
const ENEMY_AIR_ID = "lab_enemy_air";

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function getNestedValue(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function buildNestedPatch(path, val) {
  const parts = path.split(".");
  const root = {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
  return root;
}

const canvas = document.getElementById("battlefield");
const renderer = new SpriteBattlefieldRenderer(canvas);
renderer.showHealthBars = true;
renderer.showHealthText = true;
renderer.colorHealthBarsByHp = true;

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) updateGroundConfig(JSON.parse(saved));
} catch {
  // Ignore invalid or inaccessible storage
}

let state = createInitialState({ includePracticeTargets: false, includeCivilians: false, botsEnabled: false });
let selectedUnitId = "infantry";
let activePreset = "vs_troop";
let scenePinned = false;
let activeTab = "all";
let simSpeedBeforePause = 1;
let customZoom = 0.95;
let autoLoopTimer = 0;
let ws = null;
let wsConnected = false;

let focalUnitIds = [];
let primaryFocalId = null;
let enemyAirPatrolDir = -1;
let lastFocalX = -400;
let prevUnitsSnapshot = new Map();
let combatMetrics = {
  shotsFired: 0,
  hits: 0,
  damageDealt: 0,
  hpHealed: 0,
  civiliansRescued: 0,
  fundsEarned: 0,
  outcome: "ACTIVE"
};
const trackedProjectiles = new Map();
const eventLog = [];

const scene = {
  arenaLen: 2000,
  profileLabel: "",
  troopCount: 1,
  troopStartHpPct: 100,
  troopStartX: -580,
  enemyTroop: true,
  enemyType: "infantry",
  enemyCount: 1,
  enemyHpPct: 100,
  enemyBehavior: "advance",
  enemyX: 450,
  enemyBunker: false,
  enemyBunkerX: 300,
  enemyBunkerHpPct: 100,
  enemyBunkerPassive: false,
  neutralBunker: false,
  neutralBunkerX: 140,
  enemyAircraft: false,
  aircraftType: "heli",
  aircraftMode: "flyby",
  aircraftAltitude: 250,
  aircraftArmed: false,
  alliedEscort: false,
  escortType: "supply_truck",
  escortHpPct: 100,
  civilians: false,
  civCount: 2,
  alliedHq: false,
  enemyHq: false
};

// DOM References
const elNetStatus = document.getElementById("lab-net-status");
const elArenaLen = document.getElementById("opt-arena-len");
const elCameraMode = document.getElementById("opt-camera-mode");
const elAutoLoop = document.getElementById("opt-auto-loop");
const elSimSpeed = document.getElementById("opt-sim-speed");
const unitButtons = Array.from(document.querySelectorAll(".unit-btn"));
const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));
const dockTabs = Array.from(document.querySelectorAll(".dock-tab"));
const dockSections = Array.from(document.querySelectorAll("#lab-groups > details[data-section]"));

// Scene Checklist DOM
const elPrimaryBadge = document.getElementById("sc-primary-badge");
const elProfileLabel = document.getElementById("sc-profile-label");
const elTroopCount = document.getElementById("sc-troop-count");
const elTroopX = document.getElementById("sc-troop-x");
const elTroopHpRange = document.getElementById("sc-troop-hp-range");
const elTroopHpNum = document.getElementById("sc-troop-hp-num");
const elTroopHpLbl = document.getElementById("sc-troop-hp-lbl");

const elChkEnemyTroop = document.getElementById("chk-enemy-troop");
const elCardEnemyTroop = document.getElementById("card-enemy-troop");
const elEnemyType = document.getElementById("sc-enemy-type");
const elEnemyBehavior = document.getElementById("sc-enemy-behavior");
const elEnemyCount = document.getElementById("sc-enemy-count");
const elEnemyX = document.getElementById("sc-enemy-x");
const elEnemyHpRange = document.getElementById("sc-enemy-hp-range");
const elEnemyHpNum = document.getElementById("sc-enemy-hp-num");

const elChkEnemyBunker = document.getElementById("chk-enemy-bunker");
const elCardEnemyBunker = document.getElementById("card-enemy-bunker");
const elEnemyBunkerX = document.getElementById("sc-enemy-bunker-x");
const elEnemyBunkerHpRange = document.getElementById("sc-enemy-bunker-hp-range");
const elEnemyBunkerHpNum = document.getElementById("sc-enemy-bunker-hp-num");
const elEnemyBunkerPassive = document.getElementById("sc-enemy-bunker-passive");

const elChkNeutralBunker = document.getElementById("chk-neutral-bunker");
const elCardNeutralBunker = document.getElementById("card-neutral-bunker");
const elNeutralBunkerX = document.getElementById("sc-neutral-bunker-x");

const elChkEnemyAircraft = document.getElementById("chk-enemy-aircraft");
const elCardEnemyAircraft = document.getElementById("card-enemy-aircraft");
const elAircraftType = document.getElementById("sc-aircraft-type");
const elAircraftMode = document.getElementById("sc-aircraft-mode");
const elAircraftAltRange = document.getElementById("sc-aircraft-alt-range");
const elAircraftAltNum = document.getElementById("sc-aircraft-alt-num");
const elAircraftArmed = document.getElementById("sc-aircraft-armed");

const elChkAlliedEscort = document.getElementById("chk-allied-escort");
const elCardAlliedEscort = document.getElementById("card-allied-escort");
const elEscortType = document.getElementById("sc-escort-type");
const elEscortHpRange = document.getElementById("sc-escort-hp-range");
const elEscortHpNum = document.getElementById("sc-escort-hp-num");

const elChkCivilians = document.getElementById("chk-civilians");
const elCardCivilians = document.getElementById("card-civilians");
const elCivCount = document.getElementById("sc-civ-count");

const elChkAlliedHq = document.getElementById("chk-allied-hq");
const elChkEnemyHq = document.getElementById("chk-enemy-hq");

// Visual overlay checkboxes
const elVisHealthBars = document.getElementById("vis-health-bars");
const elVisHealthText = document.getElementById("vis-health-text");
const elVisHpColor = document.getElementById("vis-hp-color");
const elVisRanges = document.getElementById("vis-ranges");
const elVisSamIntercept = document.getElementById("vis-sam-intercept");
const elVisHitboxes = document.getElementById("vis-hitboxes");

// Schema containers
const elTroopSchemaSummary = document.getElementById("troop-schema-summary");
const elTroopSchemaContainer = document.getElementById("troop-schema-container");
const elRulesSchemaContainer = document.getElementById("rules-schema-container");

// Telemetry DOM
const elTelUnitName = document.getElementById("tel-unit-name");
const elTelUnitStatus = document.getElementById("tel-unit-status");
const elTelHpReadout = document.getElementById("tel-hp-readout");
const elTelHpFill = document.getElementById("tel-hp-fill");
const elTelSpeed = document.getElementById("tel-speed");
const elTelDegrade = document.getElementById("tel-degrade");
const elTelDpsReadout = document.getElementById("tel-dps-readout");
const elTelRofDetail = document.getElementById("tel-rof-detail");
const elTelReloadText = document.getElementById("tel-reload-text");
const elTelReloadFill = document.getElementById("tel-reload-fill");
const elTelSamRow = document.getElementById("tel-sam-row");
const elTelSamText = document.getElementById("tel-sam-text");
const elTelSamFill = document.getElementById("tel-sam-fill");
const elTelCombatTotals = document.getElementById("tel-combat-totals");
const elTelTargetDist = document.getElementById("tel-target-dist");
const elTelTargetReadout = document.getElementById("tel-target-readout");
const elTelRoleLabel = document.getElementById("tel-role-label");
const elTelRoleDetail = document.getElementById("tel-role-detail");
const elTelRoleExtra = document.getElementById("tel-role-extra");
const elTelClock = document.getElementById("tel-clock");
const elTelOutcome = document.getElementById("tel-outcome");
const elTelEventFeed = document.getElementById("tel-event-feed");

const unitControls = new Map();
const rulesControls = new Map();

function saveConfigLocally() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getGroundConfigSnapshot()));
  } catch {
    // Ignore storage quota errors
  }
}

function syncWsConfig(patch, persist = false) {
  if (wsConnected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "updateGroundConfig", patch, persist }));
  }
}

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
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "groundConfig" && data.config) {
          applyExternalConfig(data.config);
        }
      } catch {
        // Ignore malformed messages
      }
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
    // Offline standalone mode works seamlessly
  }
}

function pushEventLog(text, color = "#cbd5e1") {
  const t = (state.time || 0).toFixed(1);
  eventLog.unshift({ time: t, text, color });
  if (eventLog.length > 14) eventLog.length = 14;
}

function formatSchemaValue(item, rawVal) {
  if (item.kind === "rate") {
    const ticks = Math.max(1, Number(rawVal) || 1);
    return Number((TICK_RATE / ticks).toFixed(2));
  }
  return rawVal;
}

function renderSchemaControls(container, controlsMap, schemaGroups, sourceObj, defaultObj, onParamChange) {
  container.innerHTML = "";
  controlsMap.clear();

  for (const group of schemaGroups) {
    const header = document.createElement("div");
    header.style.cssText = "font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#93c5fd;margin-top:4px;";
    header.textContent = group.group;
    container.appendChild(header);

    for (const item of group.items) {
      const row = document.createElement("div");
      row.className = "tuner-row";
      const curRaw = getNestedValue(sourceObj, item.key);
      const defRaw = getNestedValue(defaultObj, item.key);

      if (item.kind === "checkbox") {
        const checkWrap = document.createElement("label");
        checkWrap.className = "tuner-check-row";
        const left = document.createElement("span");
        left.textContent = item.label;
        const right = document.createElement("span");
        right.style.cssText = "display:flex;align-items:center;gap:6px;";
        const defBadge = document.createElement("span");
        defBadge.className = "tuner-def";
        defBadge.style.fontFamily = "ui-monospace, monospace";
        defBadge.style.fontSize = "10px";
        defBadge.textContent = `def:${defRaw ? "ON" : "OFF"}`;
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = Boolean(curRaw);

        cb.addEventListener("change", () => {
          onParamChange(item, cb.checked);
          cb.blur();
        });

        right.appendChild(defBadge);
        right.appendChild(cb);
        checkWrap.appendChild(left);
        checkWrap.appendChild(right);
        row.appendChild(checkWrap);

        const desc = document.createElement("div");
        desc.className = "tuner-desc";
        desc.textContent = item.desc;
        row.appendChild(desc);

        container.appendChild(row);
        controlsMap.set(item.key, { kind: "checkbox", cb, item });
        continue;
      }

      const displayVal = formatSchemaValue(item, curRaw);
      const defDisplay = formatSchemaValue(item, defRaw);

      const labelWrap = document.createElement("div");
      labelWrap.className = "tuner-label-wrap";

      const label = document.createElement("span");
      label.className = "tuner-label";
      label.textContent = item.label;

      const badges = document.createElement("div");
      badges.className = "tuner-badges";
      badges.innerHTML = `<span class="tuner-def">def:${defDisplay}</span><span class="tuner-unit">${item.unit || ""}</span>`;

      labelWrap.appendChild(label);
      labelWrap.appendChild(badges);

      const inputsWrap = document.createElement("div");
      inputsWrap.className = "tuner-inputs";

      const range = document.createElement("input");
      range.type = "range";
      range.min = String(item.min);
      range.max = String(item.max);
      range.step = String(item.step);
      range.value = String(clamp(Number(displayVal), item.min, item.max));
      range.tabIndex = -1;

      const num = document.createElement("input");
      num.type = "number";
      num.min = String(item.min);
      num.max = String(item.max);
      num.step = String(item.step);
      num.value = String(displayVal);
      num.className = "tuner-num";

      const commit = (rawInput, fromNumInput = false) => {
        const parsed = Number(rawInput);
        if (!Number.isFinite(parsed) || (item.kind === "rate" && parsed <= 0)) return;
        const storedVal = item.kind === "rate"
          ? Math.max(1, Math.round(TICK_RATE / Math.max(0.05, parsed)))
          : parsed;
        range.value = String(clamp(parsed, item.min, item.max));
        if (!fromNumInput || document.activeElement !== num) {
          num.value = String(item.kind === "rate" ? formatSchemaValue(item, storedVal) : storedVal);
        }
        onParamChange(item, storedVal);
      };

      range.addEventListener("input", () => commit(range.value, false));
      range.addEventListener("change", () => range.blur());

      num.addEventListener("input", () => {
        const parsed = Number(num.value);
        if (!Number.isFinite(parsed) || (item.kind === "rate" && parsed <= 0)) return;
        const storedVal = item.kind === "rate"
          ? Math.max(1, Math.round(TICK_RATE / Math.max(0.05, parsed)))
          : parsed;
        range.value = String(clamp(parsed, item.min, item.max));
        onParamChange(item, storedVal);
      });
      num.addEventListener("change", () => {
        commit(num.value, false);
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
      container.appendChild(row);

      controlsMap.set(item.key, { kind: item.kind || "range", range, num, item });
    }
  }
}

function buildUnitControls() {
  const cfg = UNIT_CONFIG[selectedUnitId];
  const defCfg = DEFAULT_UNIT_CONFIG[selectedUnitId];
  const schema = GROUND_UNIT_TUNING_SCHEMA[selectedUnitId] || [];
  elTroopSchemaSummary.textContent = `${cfg.name} Parameters`;

  renderSchemaControls(elTroopSchemaContainer, unitControls, schema, cfg, defCfg, (item, storedVal) => {
    const patch = { units: { [selectedUnitId]: buildNestedPatch(item.key, storedVal) } };
    updateGroundConfig(patch);
    adaptLiveEntities("unit", selectedUnitId);
    saveConfigLocally();
    syncWsConfig(patch);
  });
}

function buildRulesControls() {
  const sourceProxy = { ...GROUND_BEHAVIOR_CONFIG };
  const defProxy = { ...DEFAULT_GROUND_BEHAVIOR_CONFIG };

  elRulesSchemaContainer.innerHTML = "";
  rulesControls.clear();

  renderSchemaControls(
    elRulesSchemaContainer,
    rulesControls,
    [
      {
        group: GROUND_BEHAVIOR_TUNING_SCHEMA[0].group,
        items: GROUND_BEHAVIOR_TUNING_SCHEMA[0].items.map((it) => ({ ...it, _scope: "behavior", _storeKey: it.key }))
      },
      {
        group: BUNKER_TUNING_SCHEMA[0].group,
        items: BUNKER_TUNING_SCHEMA[0].items.map((it) => ({ ...it, key: `bunker.${it.key}`, _scope: "bunker", _storeKey: it.key }))
      }
    ],
    { ...sourceProxy, bunker: { ...DEFENSE_CONFIG.bunker } },
    { ...defProxy, bunker: { ...DEFAULT_BUNKER_CONFIG } },
    (item, storedVal) => {
      const patch = item._scope === "bunker"
        ? { bunker: { [item._storeKey]: storedVal } }
        : { behavior: { [item._storeKey]: storedVal } };
      updateGroundConfig(patch);
      adaptLiveEntities(item._scope);
      saveConfigLocally();
      syncWsConfig(patch);
    }
  );
}

function syncControlMapValues(controlsMap, sourceObj) {
  for (const [key, entry] of controlsMap.entries()) {
    const raw = getNestedValue(sourceObj, key);
    if (raw === undefined) continue;
    if (entry.kind === "checkbox") {
      entry.cb.checked = Boolean(raw);
    } else {
      const displayVal = formatSchemaValue(entry.item, raw);
      entry.range.value = String(clamp(Number(displayVal), entry.item.min, entry.item.max));
      if (document.activeElement !== entry.num) {
        entry.num.value = String(displayVal);
      }
    }
  }
}

function applyExternalConfig(cfgObj) {
  updateGroundConfig(cfgObj);
  syncControlMapValues(unitControls, UNIT_CONFIG[selectedUnitId]);
  syncControlMapValues(rulesControls, { ...GROUND_BEHAVIOR_CONFIG, bunker: { ...DEFENSE_CONFIG.bunker } });
  adaptLiveEntities("all");
  saveConfigLocally();
}

function adaptLiveEntities(scope, targetUnitId = null) {
  if (scope === "unit" || scope === "all") {
    for (const u of state.units || []) {
      if (targetUnitId && u.unitId !== targetUnitId) continue;
      const cfg = UNIT_CONFIG[u.unitId];
      if (!cfg) continue;
      const prevMax = Math.max(1, u.maxHp || cfg.maxHp);
      const ratio = clamp(u.hp / prevMax, 0, 1);
      u.maxHp = cfg.maxHp;
      u.hp = u.hp <= 0 ? 0 : clamp(Math.round(cfg.maxHp * ratio * 10) / 10, 1, cfg.maxHp);
      u.speed = cfg.speed;
      u.cabinCapacity = cfg.cabinCapacity || 0;
      if (u.kind === "armored_apc" && !u.deployedTroops) {
        u.troopsCarried = cfg.deployTroopCount || 0;
      }
      const maxCd = u.kind === "aa_flak_truck" ? cfg.groundFireCooldownTicks : cfg.fireCooldownTicks;
      if (maxCd && u.fireCooldown > maxCd) u.fireCooldown = maxCd;
      if (u.kind === "aa_flak_truck" && cfg.samCooldownTicks && u.samCooldown > cfg.samCooldownTicks) {
        u.samCooldown = cfg.samCooldownTicks;
      }
    }
  }
  if (scope === "bunker" || scope === "all") {
    const bCfg = DEFENSE_CONFIG.bunker;
    for (const b of state.bunkers || []) {
      const prevMax = Math.max(1, b.maxHp || bCfg.maxHp);
      const ratio = clamp(b.hp / prevMax, 0, 1);
      b.maxHp = bCfg.maxHp;
      b.hp = b.hp <= 0 ? 0 : clamp(Math.round(bCfg.maxHp * ratio * 10) / 10, 1, bCfg.maxHp);
      if (b.fireCooldown > bCfg.fireCooldownTicks) b.fireCooldown = bCfg.fireCooldownTicks;
    }
  }
}

function applyPreset(presetId, shouldRebuild = true) {
  activePreset = presetId;
  for (const btn of presetButtons) {
    btn.classList.toggle("active", btn.dataset.preset === presetId);
  }

  const halfLen = scene.arenaLen * 0.5;
  const isSupport = selectedUnitId === "ambulance" || selectedUnitId === "supply_truck";
  scene.troopStartHpPct = 100;
  scene.troopStartX = clamp(-Math.round(halfLen * 0.58), -halfLen + 140, halfLen - 200);
  scene.enemyTroop = false;
  scene.enemyBunker = false;
  scene.neutralBunker = false;
  scene.enemyAircraft = false;
  scene.alliedEscort = false;
  scene.civilians = false;
  scene.alliedHq = false;
  scene.enemyHq = false;

  if (presetId === "solo") {
    scene.troopStartX = -halfLen + 220;
  } else if (presetId === "vs_troop") {
    scene.enemyTroop = true;
    scene.enemyType = isSupport ? "infantry" : "mirror";
    scene.enemyCount = 1;
    scene.enemyHpPct = 100;
    scene.enemyBehavior = "advance";
    scene.enemyX = Math.round(halfLen * 0.45);
  } else if (presetId === "vs_bunker") {
    scene.enemyBunker = true;
    scene.enemyBunkerX = Math.round(halfLen * 0.30);
    scene.enemyBunkerHpPct = 100;
    scene.enemyBunkerPassive = false;
  } else if (presetId === "vs_neutral_bunker") {
    scene.neutralBunker = true;
    scene.neutralBunkerX = Math.round(halfLen * 0.16);
  } else if (presetId === "vs_aircraft") {
    scene.enemyAircraft = true;
    scene.aircraftType = "heli";
    scene.aircraftMode = "flyby";
    scene.aircraftAltitude = 240;
    scene.aircraftArmed = true;
    scene.troopStartX = -Math.round(halfLen * 0.55);
  } else if (presetId === "combined") {
    scene.enemyTroop = true;
    scene.enemyType = "infantry";
    scene.enemyCount = 2;
    scene.enemyHpPct = 100;
    scene.enemyBehavior = "advance";
    scene.enemyX = Math.round(halfLen * 0.48);
    scene.enemyBunker = true;
    scene.enemyBunkerX = Math.round(halfLen * 0.28);
    scene.enemyBunkerHpPct = 100;
    scene.enemyBunkerPassive = false;
    scene.enemyAircraft = true;
    scene.aircraftType = "p47";
    scene.aircraftMode = "patrol";
    scene.aircraftAltitude = 260;
    scene.aircraftArmed = true;
    scene.alliedEscort = true;
    scene.escortType = selectedUnitId === "supply_truck" ? "mbt" : "supply_truck";
    scene.escortHpPct = selectedUnitId === "supply_truck" ? 55 : 100;
  } else if (presetId === "support_rescue") {
    if (selectedUnitId === "ambulance") {
      scene.civilians = true;
      scene.civCount = 2;
      scene.alliedHq = true;
      scene.troopStartX = -halfLen + 260;
    } else if (selectedUnitId === "supply_truck") {
      scene.alliedEscort = true;
      scene.escortType = "mbt";
      scene.escortHpPct = 45;
      scene.enemyTroop = true;
      scene.enemyType = "mbt";
      scene.enemyCount = 1;
      scene.enemyHpPct = 100;
      scene.enemyBehavior = "hold";
      scene.enemyX = Math.round(halfLen * 0.48);
    } else {
      scene.alliedEscort = true;
      scene.escortType = "supply_truck";
      scene.escortHpPct = 100;
      scene.civilians = true;
      scene.civCount = 2;
      scene.enemyTroop = true;
      scene.enemyType = "infantry";
      scene.enemyCount = 1;
      scene.enemyBehavior = "advance";
      scene.enemyX = Math.round(halfLen * 0.45);
      scene.troopStartHpPct = 60;
    }
  }

  syncSceneUiFromModel();
  if (shouldRebuild) rebuildScene();
}

function syncSceneUiFromModel() {
  const halfLen = scene.arenaLen * 0.5;
  elPrimaryBadge.textContent = UNIT_CONFIG[selectedUnitId].name.toUpperCase();
  elArenaLen.value = String(scene.arenaLen);

  if (document.activeElement !== elProfileLabel) elProfileLabel.value = scene.profileLabel;
  if (document.activeElement !== elTroopCount) elTroopCount.value = String(scene.troopCount);
  if (document.activeElement !== elTroopX) elTroopX.value = String(scene.troopStartX);
  elTroopX.min = String(-halfLen + 80);
  elTroopX.max = String(halfLen - 80);
  elTroopHpRange.value = String(scene.troopStartHpPct);
  if (document.activeElement !== elTroopHpNum) elTroopHpNum.value = String(scene.troopStartHpPct);
  elTroopHpLbl.textContent = `${scene.troopStartHpPct}%`;

  elChkEnemyTroop.checked = scene.enemyTroop;
  elCardEnemyTroop.classList.toggle("enabled", scene.enemyTroop);
  elEnemyType.value = scene.enemyType;
  elEnemyBehavior.value = scene.enemyBehavior;
  if (document.activeElement !== elEnemyCount) elEnemyCount.value = String(scene.enemyCount);
  if (document.activeElement !== elEnemyX) elEnemyX.value = String(scene.enemyX);
  elEnemyX.min = String(-halfLen + 80);
  elEnemyX.max = String(halfLen - 80);
  elEnemyHpRange.value = String(scene.enemyHpPct);
  if (document.activeElement !== elEnemyHpNum) elEnemyHpNum.value = String(scene.enemyHpPct);

  elChkEnemyBunker.checked = scene.enemyBunker;
  elCardEnemyBunker.classList.toggle("enabled", scene.enemyBunker);
  if (document.activeElement !== elEnemyBunkerX) elEnemyBunkerX.value = String(scene.enemyBunkerX);
  elEnemyBunkerX.min = String(-halfLen + 80);
  elEnemyBunkerX.max = String(halfLen - 80);
  elEnemyBunkerHpRange.value = String(scene.enemyBunkerHpPct);
  if (document.activeElement !== elEnemyBunkerHpNum) elEnemyBunkerHpNum.value = String(scene.enemyBunkerHpPct);
  elEnemyBunkerPassive.checked = scene.enemyBunkerPassive;

  elChkNeutralBunker.checked = scene.neutralBunker;
  elCardNeutralBunker.classList.toggle("enabled", scene.neutralBunker);
  if (document.activeElement !== elNeutralBunkerX) elNeutralBunkerX.value = String(scene.neutralBunkerX);
  elNeutralBunkerX.min = String(-halfLen + 80);
  elNeutralBunkerX.max = String(halfLen - 80);

  elChkEnemyAircraft.checked = scene.enemyAircraft;
  elCardEnemyAircraft.classList.toggle("enabled", scene.enemyAircraft);
  elAircraftType.value = scene.aircraftType;
  elAircraftMode.value = scene.aircraftMode;
  elAircraftAltRange.value = String(scene.aircraftAltitude);
  if (document.activeElement !== elAircraftAltNum) elAircraftAltNum.value = String(scene.aircraftAltitude);
  elAircraftArmed.checked = scene.aircraftArmed;

  elChkAlliedEscort.checked = scene.alliedEscort;
  elCardAlliedEscort.classList.toggle("enabled", scene.alliedEscort);
  elEscortType.value = scene.escortType;
  elEscortHpRange.value = String(scene.escortHpPct);
  if (document.activeElement !== elEscortHpNum) elEscortHpNum.value = String(scene.escortHpPct);

  elChkCivilians.checked = scene.civilians;
  elCardCivilians.classList.toggle("enabled", scene.civilians);
  if (document.activeElement !== elCivCount) elCivCount.value = String(scene.civCount);

  elChkAlliedHq.checked = scene.alliedHq;
  elChkEnemyHq.checked = scene.enemyHq;
}

function rebuildScene() {
  autoLoopTimer = 0;
  renderer.clearEffects();
  trackedProjectiles.clear();
  prevUnitsSnapshot.clear();
  eventLog.length = 0;
  combatMetrics = {
    shotsFired: 0,
    hits: 0,
    damageDealt: 0,
    hpHealed: 0,
    civiliansRescued: 0,
    fundsEarned: 0,
    outcome: "ACTIVE"
  };

  const halfLen = scene.arenaLen * 0.5;
  state = createInitialState({ includePracticeTargets: false, includeCivilians: false, botsEnabled: false });
  state.worldBounds = { minX: -halfLen, maxX: halfLen };
  state.bunkers = [];
  state.teamFunds = { allied: 2000, enemy: 2000 };

  const alliedHqX = -halfLen + 140;
  const enemyHqX = halfLen - 140;
  state.hqs.allied = {
    team: "allied",
    x: alliedHqX,
    hp: scene.alliedHq ? state.hqs.allied.maxHp : 0,
    maxHp: state.hqs.allied.maxHp,
    compactBase: true,
    hidden: !scene.alliedHq
  };
  state.hqs.enemy = {
    team: "enemy",
    x: enemyHqX,
    hp: scene.enemyHq ? state.hqs.enemy.maxHp : 0,
    maxHp: state.hqs.enemy.maxHp,
    compactBase: true,
    hidden: !scene.enemyHq
  };

  // Bunkers
  if (scene.neutralBunker) {
    state.bunkers.push({
      id: "lab_bunker_neutral",
      x: clamp(scene.neutralBunkerX, -halfLen + 90, halfLen - 90),
      y: 0,
      owner: "neutral",
      hp: DEFENSE_CONFIG.bunker.maxHp,
      maxHp: DEFENSE_CONFIG.bunker.maxHp,
      captureProgress: 0,
      fireCooldown: 0
    });
  }
  if (scene.enemyBunker) {
    const bHp = Math.max(1, Math.round(DEFENSE_CONFIG.bunker.maxHp * (scene.enemyBunkerHpPct / 100)));
    state.bunkers.push({
      id: "lab_bunker_enemy",
      x: clamp(scene.enemyBunkerX, -halfLen + 90, halfLen - 90),
      y: 0,
      owner: "enemy",
      hp: bHp,
      maxHp: DEFENSE_CONFIG.bunker.maxHp,
      captureProgress: 0,
      fireCooldown: 0,
      passiveDummy: scene.enemyBunkerPassive
    });
  }

  // Primary Tested Troop(s)
  focalUnitIds = [];
  primaryFocalId = null;
  const count = clamp(Math.round(scene.troopCount), 1, 5);
  const baseStartX = clamp(scene.troopStartX, -halfLen + 80, halfLen - 80);
  for (let i = 0; i < count; i++) {
    const ux = clamp(baseStartX - i * 56, -halfLen + 70, halfLen - 70);
    const u = spawnGroundUnit(state, "allied", selectedUnitId, ux);
    if (!u) continue;
    u.hp = Math.max(1, Math.round(u.maxHp * (scene.troopStartHpPct / 100)));
    u.isLabPrimary = true;
    focalUnitIds.push(u.id);
    if (!primaryFocalId) {
      primaryFocalId = u.id;
      lastFocalX = u.x;
    }
  }

  // Allied Support Escort
  if (scene.alliedEscort) {
    const escortX = selectedUnitId === "supply_truck"
      ? clamp(baseStartX + 140, -halfLen + 70, halfLen - 70)
      : clamp(baseStartX - 115, -halfLen + 70, halfLen - 70);
    const escort = spawnGroundUnit(state, "allied", scene.escortType, escortX);
    if (escort) {
      escort.hp = Math.max(1, Math.round(escort.maxHp * (scene.escortHpPct / 100)));
    }
  }

  // Enemy Ground Troop(s)
  if (scene.enemyTroop) {
    const resolvedEnemyType = scene.enemyType === "mirror" ? selectedUnitId : scene.enemyType;
    const eCount = clamp(Math.round(scene.enemyCount), 1, 4);
    const baseEnemyX = clamp(scene.enemyX, -halfLen + 80, halfLen - 80);
    for (let i = 0; i < eCount; i++) {
      const ex = clamp(baseEnemyX + i * 56, -halfLen + 70, halfLen - 70);
      const eu = spawnGroundUnit(state, "enemy", resolvedEnemyType, ex);
      if (!eu) continue;
      eu.hp = Math.max(1, Math.round(eu.maxHp * (scene.enemyHpPct / 100)));
      if (scene.enemyBehavior === "hold") eu.holdPosition = true;
      if (scene.enemyBehavior === "passive") {
        eu.holdPosition = true;
        eu.passiveDummy = true;
      }
    }
  }

  // Stranded Civilians
  if (scene.civilians) {
    const cCount = clamp(Math.round(scene.civCount), 1, 3);
    const offsets = cCount === 1 ? [0] : cCount === 2 ? [-60, 60] : [-100, 0, 100];
    for (const ox of offsets) {
      spawnCivilian(state, ox, ox);
    }
  }

  // Enemy Aircraft
  enemyAirPatrolDir = -1;
  if (scene.enemyAircraft) {
    if (scene.aircraftType === "b52") {
      const cfg = STRATEGIC_CONFIG.b52_raid;
      state.b52s.push({
        id: `lab_b52_${state.nextEntityId++}`,
        team: "enemy",
        ownerId: "lab",
        x: halfLen - 120,
        y: scene.aircraftAltitude,
        vx: -cfg.speed,
        dir: -1,
        hp: cfg.hp,
        maxHp: cfg.maxHp,
        targetX: 0,
        stripWidth: Math.min(900, scene.arenaLen * 0.55),
        bombsTotal: scene.aircraftArmed ? 14 : 0,
        bombsDropped: 0,
        alive: true
      });
    } else {
      const air = addPlayer(state, ENEMY_AIR_ID, "enemy", scene.aircraftType, {
        isBot: false,
        callsign: scene.aircraftType === "p47" ? "ENEMY P-47" : "ENEMY HELI"
      });
      air.dir = -1;
      air.turnStartDir = -1;
      air.y = scene.aircraftAltitude;
      air.landedAtBase = false;
      if (scene.aircraftType === "p47") {
        air.x = halfLen - 120;
        air.speed = AIRCRAFT_CONFIG.p47.cruiseSpeed;
        air.vx = -air.speed;
      } else {
        air.x = scene.aircraftMode === "hover" ? Math.min(180, halfLen - 140) : halfLen - 160;
        air.vx = scene.aircraftMode === "hover" ? 0 : -160;
      }
    }
  }

  // Fit initial camera smoothly
  snapCameraToMode();
  pushEventLog(`Scene ready: ${UNIT_CONFIG[selectedUnitId].name} (${scene.arenaLen}m)`, "#4ade80");
}

function getFitZoom() {
  const w = canvas.clientWidth || 860;
  return clamp(w / (scene.arenaLen + 200), 0.34, 1.15);
}

function snapCameraToMode() {
  const mode = elCameraMode.value;
  if (mode === "fit") {
    renderer.camX = 0;
    renderer.camY = scene.enemyAircraft ? Math.max(180, scene.aircraftAltitude * 0.52) : 150;
    renderer.camZoom = getFitZoom();
  } else if (mode === "follow") {
    const focal = getPrimaryUnit();
    renderer.camX = (focal?.x ?? lastFocalX) + 120;
    renderer.camY = 150;
    renderer.camZoom = customZoom;
  }
}

function getPrimaryUnit() {
  const units = state.units || [];
  if (primaryFocalId) {
    const found = units.find((u) => u.id === primaryFocalId && u.hp > 0);
    if (found) return found;
  }
  for (const id of focalUnitIds) {
    const found = units.find((u) => u.id === id && u.hp > 0);
    if (found) {
      primaryFocalId = found.id;
      return found;
    }
  }
  return null;
}

function computeLabAircraftInput(player) {
  if (!player || !player.alive || player.crashing) return {};
  const halfLen = scene.arenaLen * 0.5;
  const targetY = scene.aircraftAltitude;
  const inp = {
    left: false,
    right: false,
    up: false,
    down: false,
    firePrimary: false,
    fireSecondary: false,
    fireFlare: false
  };

  if (player.aircraftType === "heli") {
    if (scene.aircraftMode === "hover") {
      const hoverX = Math.min(160, halfLen - 140);
      if (player.x > hoverX + 45) inp.left = true;
      else if (player.x < hoverX - 45) inp.right = true;
      else if (player.dir > 0) player.dir = -1;
    } else if (scene.aircraftMode === "patrol") {
      if (player.x <= -halfLen + 200) enemyAirPatrolDir = 1;
      else if (player.x >= halfLen - 200) enemyAirPatrolDir = -1;
      if (enemyAirPatrolDir < 0) inp.left = true;
      else inp.right = true;
    } else {
      inp.left = true;
    }

    if (player.y < targetY - 8 || (player.vy < -18 && player.y < targetY + 4)) inp.up = true;
    else if (player.y > targetY + 10) inp.down = true;

    if (scene.aircraftArmed) {
      const alliedGround = (state.units || []).filter((u) => u.team === "allied" && u.hp > 0);
      let nearest = null;
      let bestDist = Infinity;
      for (const u of alliedGround) {
        const d = Math.abs(u.x - player.x);
        if (d < bestDist) {
          bestDist = d;
          nearest = u;
        }
      }
      if (nearest) {
        if ((nearest.x - player.x) * player.dir > 0 && bestDist <= 380 && player.y <= 260) {
          inp.firePrimary = true;
        }
        if (bestDist <= 55 && player.secondaryAmmo > 0) {
          inp.fireSecondary = true;
        }
      }
    }
    return inp;
  }

  // P-47 Fighter
  const margin = Math.min(280, halfLen * 0.42);
  if (scene.aircraftMode === "patrol" || scene.aircraftMode === "hover") {
    const needTurnLeft = player.dir === 1 && player.x >= halfLen - margin;
    const needTurnRight = player.dir === -1 && player.x <= -halfLen + margin;
    if (player.turnTimer === 0) {
      if (needTurnLeft) inp.left = true;
      else if (needTurnRight) inp.right = true;
      else if (player.dir === 1) inp.right = true;
      else inp.left = true;
    }
  } else {
    if (player.turnTimer === 0) {
      if (player.dir === 1) inp.right = true;
      else inp.left = true;
    }
  }

  if (player.y < targetY - 14) inp.up = true;
  else if (player.y > targetY + 14) inp.down = true;

  if (scene.aircraftArmed) {
    const alliedGround = (state.units || []).filter((u) => u.team === "allied" && u.hp > 0);
    for (const u of alliedGround) {
      const dx = (u.x - player.x) * player.dir;
      if (dx > 60 && dx <= 520 && player.y < 360) {
        if (player.y > 140) inp.down = true;
        inp.firePrimary = true;
        if (dx >= 170 && player.secondaryAmmo > 0) inp.fireSecondary = true;
        break;
      }
    }
  }

  return inp;
}

function handlePostStepLabBounds() {
  const halfLen = scene.arenaLen * 0.5;
  const air = state.players[ENEMY_AIR_ID];
  if (air) {
    if (!air.alive) {
      air.respawnTicks = 9999; // Keep aircraft dead until scenario reset/loop
    } else if (!air.crashing && scene.aircraftMode === "flyby") {
      if (air.x < -halfLen - 160) {
        air.x = halfLen + 140;
        air.y = scene.aircraftAltitude;
        air.dir = -1;
        air.turnTimer = 0;
        if (air.aircraftType === "p47") {
          air.speed = AIRCRAFT_CONFIG.p47.cruiseSpeed;
          air.vx = -air.speed;
          air.vy = 0;
          air.pitch = 0;
          air.flightStage = 1;
          air.throttleOffTime = 0;
          air.stallTime = 0;
        } else {
          air.vx = -160;
          air.vy = 0;
        }
      }
    }
  }

  for (const b52 of state.b52s || []) {
    if (!b52.alive) continue;
    if (b52.dir === -1 && b52.x < -halfLen - 220) {
      if (scene.aircraftMode === "patrol") {
        b52.dir = 1;
        b52.vx = STRATEGIC_CONFIG.b52_raid.speed;
        b52.x = -halfLen - 200;
      } else {
        b52.x = halfLen + 180;
      }
      b52.bombsDropped = 0;
    } else if (b52.dir === 1 && b52.x > halfLen + 220) {
      b52.dir = -1;
      b52.vx = -STRATEGIC_CONFIG.b52_raid.speed;
      b52.x = halfLen + 200;
      b52.bombsDropped = 0;
    }
  }
}

function checkPointHitsEnemy(x, y, splashRadius = 0) {
  for (const u of state.units || []) {
    if (u.team !== "enemy" || u.hp <= 0) continue;
    if (!GROUND_BEHAVIOR_CONFIG.ambulanceTargetable && u.kind === "ambulance") continue;
    const { hitW, hitH } = getGroundUnitHitbox(u.kind);
    if (splashRadius > 0) {
      if (Math.hypot(u.x - x, Math.max(0, y - 24)) <= splashRadius + hitW * 0.5) return true;
    } else if (Math.abs(x - u.x) <= hitW + 10 && y >= -5 && y <= hitH + 10) {
      return true;
    }
  }
  for (const b of state.bunkers || []) {
    if (b.owner !== "enemy" || b.hp <= 0) continue;
    if (Math.abs(x - b.x) <= 64 + splashRadius && y >= -5 && y <= 90) return true;
  }
  const enemyHq = state.hqs?.enemy;
  if (enemyHq && enemyHq.hp > 0 && Math.abs(x - enemyHq.x) <= 98 + splashRadius && y >= -5 && y <= 145) {
    return true;
  }
  const air = state.players[ENEMY_AIR_ID];
  if (air && air.alive && !air.crashing && Math.hypot(x - air.x, y - (air.y + 22)) <= 42) {
    return true;
  }
  for (const b52 of state.b52s || []) {
    if (b52.alive && b52.hp > 0 && Math.abs(x - b52.x) <= 100 && Math.abs(y - b52.y) <= 48) {
      return true;
    }
  }
  return false;
}

function stepLabSimulation() {
  if (state.baseAa?.enemy) {
    state.baseAa.enemy.flakCooldown = 999;
    state.baseAa.enemy.samCooldown = 999;
  }
  if (state.baseAa?.allied) {
    state.baseAa.allied.flakCooldown = 999;
    state.baseAa.allied.samCooldown = 999;
  }

  // Snapshot pre-step friendly unit HP for heal delta & enemy HP for damage tracking
  const prevAllyHp = new Map();
  let enemyHpBefore = 0;
  for (const u of state.units || []) {
    if (u.hp <= 0) continue;
    if (u.team === "allied") prevAllyHp.set(u.id, u.hp);
    else enemyHpBefore += u.hp;
  }
  for (const b of state.bunkers || []) {
    if (b.owner === "enemy" && b.hp > 0) enemyHpBefore += b.hp;
  }
  if (state.hqs?.enemy?.hp > 0) enemyHpBefore += state.hqs.enemy.hp;
  const airBefore = state.players[ENEMY_AIR_ID];
  if (airBefore && airBefore.alive) enemyHpBefore += airBefore.hp;
  for (const b52 of state.b52s || []) {
    if (b52.alive && b52.hp > 0) enemyHpBefore += b52.hp;
  }

  // Update last positions of tracked projectiles
  for (const pr of state.projectiles || []) {
    const rec = trackedProjectiles.get(pr.id);
    if (rec) {
      rec.x = pr.x;
      rec.y = pr.y;
      rec.vx = pr.vx;
      rec.vy = pr.vy;
      rec.lifeTicks = pr.lifeTicks;
    }
  }

  const inputs = {};
  const air = state.players[ENEMY_AIR_ID];
  if (air && air.alive && !air.crashing) {
    inputs[ENEMY_AIR_ID] = computeLabAircraftInput(air);
  }

  stepSimulation(state, inputs);
  handlePostStepLabBounds();

  if (state.events.length) {
    renderer.ingestEvents(state.events);
  }

  // Track newly spawned focal projectiles
  const focalSet = new Set(focalUnitIds);
  const activeProjIds = new Set();
  for (const pr of state.projectiles || []) {
    activeProjIds.add(pr.id);
    if (focalSet.has(pr.ownerId) && !trackedProjectiles.has(pr.id)) {
      combatMetrics.shotsFired += 1;
      trackedProjectiles.set(pr.id, {
        ownerId: pr.ownerId,
        kind: pr.kind,
        damage: pr.damage,
        splashRadius: pr.splashRadius || 0,
        x: pr.x,
        y: pr.y,
        vx: pr.vx,
        vy: pr.vy,
        lifeTicks: pr.lifeTicks
      });
    } else if (
      pr.kind === "sam_missile" &&
      pr.team === "allied" &&
      selectedUnitId === "aa_truck" &&
      !trackedProjectiles.has(pr.id) &&
      state.events.some((e) => e.type === "sam_launched" && e.team === "allied")
    ) {
      // AA truck SAMs don't populate ownerId, attribute when allied AA truck is focal
      combatMetrics.shotsFired += 1;
      trackedProjectiles.set(pr.id, {
        ownerId: primaryFocalId,
        kind: pr.kind,
        damage: pr.damage,
        splashRadius: 0,
        x: pr.x,
        y: pr.y,
        vx: pr.vx,
        vy: pr.vy,
        lifeTicks: pr.lifeTicks
      });
    }
  }

  // Check disappeared tracked projectiles for hits
  let enemyHpAfter = 0;
  for (const u of state.units || []) {
    if (u.hp > 0 && u.team === "enemy") enemyHpAfter += u.hp;
  }
  for (const b of state.bunkers || []) {
    if (b.owner === "enemy" && b.hp > 0) enemyHpAfter += b.hp;
  }
  if (state.hqs?.enemy?.hp > 0) enemyHpAfter += state.hqs.enemy.hp;
  const airAfter = state.players[ENEMY_AIR_ID];
  if (airAfter && airAfter.alive) enemyHpAfter += airAfter.hp;
  for (const b52 of state.b52s || []) {
    if (b52.alive && b52.hp > 0) enemyHpAfter += b52.hp;
  }

  const enemyHpDelta = Math.max(0, enemyHpBefore - enemyHpAfter);
  let attributedHitThisTick = false;
  for (const [pid, rec] of trackedProjectiles.entries()) {
    if (!activeProjIds.has(pid)) {
      const exX = rec.x + rec.vx * DT;
      const exY = rec.y + rec.vy * DT;
      if (rec.lifeTicks > 1 && (checkPointHitsEnemy(exX, exY, rec.splashRadius) || enemyHpDelta > 0)) {
        combatMetrics.hits += 1;
        attributedHitThisTick = true;
      }
      trackedProjectiles.delete(pid);
    }
  }
  if (attributedHitThisTick || (enemyHpDelta > 0 && focalUnitIds.length > 0)) {
    combatMetrics.damageDealt += Math.round(enemyHpDelta);
  }

  // Track Supply Truck healing
  for (const u of state.units || []) {
    if (u.team === "allied" && u.repairedThisTick && prevAllyHp.has(u.id)) {
      const gained = u.hp - prevAllyHp.get(u.id);
      if (gained > 0) combatMetrics.hpHealed += gained;
    }
  }

  // Log notable simulation events
  for (const ev of state.events) {
    if (ev.type === "sam_launched") {
      pushEventLog(`SAM [${(ev.profile || "guided").toUpperCase()}] @ ${Math.round(ev.speed || 0)} px/s`, "#38bdf8");
    } else if (ev.type === "bunker_captured") {
      pushEventLog(`${ev.team.toUpperCase()} captured bunker!`, "#4ade80");
    } else if (ev.type === "bunker_neutralized") {
      pushEventLog("Bunker neutralized (0 HP)!", "#fbbf24");
    } else if (ev.type === "apc_troops_deployed") {
      pushEventLog(`APC deployed ${ev.count} infantry (${ev.reason})`, "#86efac");
    } else if (ev.type === "unit_destroyed") {
      pushEventLog(`${ev.team.toUpperCase()} ${ev.kind.replace(/_/g, " ")} destroyed`, ev.team === "enemy" ? "#4ade80" : "#f87171");
    } else if (ev.type === "ambulance_crossfire") {
      pushEventLog(`Ambulance crossfire -${ev.damage} HP`, "#f59e0b");
    } else if (ev.type === "civilians_rescued") {
      combatMetrics.civiliansRescued += ev.count || 0;
      combatMetrics.fundsEarned += ev.payout || 0;
      pushEventLog(`Rescued ${ev.count} civs (+$${ev.payout})`, "#86efac");
    } else if (ev.type === "player_crashed") {
      pushEventLog("Enemy aircraft destroyed!", "#4ade80");
    } else if (ev.type === "b52_destroyed") {
      pushEventLog("Enemy B-52 shot down!", "#4ade80");
    } else if (ev.type === "match_won") {
      pushEventLog(`${ev.winner.toUpperCase()} HQ VICTORY!`, "#fde047");
    }
  }

  // Track focal position & evaluate scenario completion for Auto-Loop
  const focal = getPrimaryUnit();
  if (focal) lastFocalX = focal.x;

  const alliedFocalAlive = focalUnitIds.some((id) => (state.units || []).some((u) => u.id === id && u.hp > 0));
  const anyEnemyUnits = (state.units || []).some((u) => u.team === "enemy" && u.hp > 0);
  const anyEnemyBunker = (state.bunkers || []).some((b) => b.owner === "enemy" && b.hp > 0);
  const anyNeutralBunker = (state.bunkers || []).some((b) => b.owner === "neutral");
  const anyEnemyAir = (state.players[ENEMY_AIR_ID]?.alive) || (state.b52s || []).some((b) => b.alive && b.hp > 0);
  const anyEnemyHq = state.hqs?.enemy && !state.hqs.enemy.hidden && state.hqs.enemy.hp > 0;
  const hadThreats = scene.enemyTroop || scene.enemyBunker || scene.enemyAircraft || scene.enemyHq;

  let done = false;
  if (state.winner) {
    combatMetrics.outcome = `${state.winner.toUpperCase()} VICTORY`;
    done = true;
  } else if (!alliedFocalAlive) {
    if (selectedUnitId === "infantry" && scene.neutralBunker && !anyNeutralBunker && combatMetrics.outcome === "ACTIVE") {
      combatMetrics.outcome = "BUNKER CAPTURED";
    } else if (selectedUnitId !== "infantry" || !scene.neutralBunker || anyNeutralBunker) {
      combatMetrics.outcome = "UNIT LOST";
    }
    done = true;
  } else if (hadThreats && !anyEnemyUnits && !anyEnemyBunker && !anyEnemyAir && !anyEnemyHq) {
    combatMetrics.outcome = "THREATS CLEARED";
    done = true;
  } else if (selectedUnitId === "ambulance" && scene.civilians && (state.civilians || []).length === 0 && focal && focal.passengers.length === 0 && combatMetrics.civiliansRescued > 0) {
    combatMetrics.outcome = `RESCUED (+$${combatMetrics.fundsEarned})`;
    done = true;
  } else if (scene.neutralBunker && !anyNeutralBunker && !hadThreats) {
    combatMetrics.outcome = "BUNKER CAPTURED";
    done = true;
  } else if (focal && focal.x >= scene.arenaLen * 0.5 - 65 && !hadThreats && !scene.civilians && !scene.neutralBunker) {
    combatMetrics.outcome = "REACHED END";
    done = true;
  }

  if (done && elAutoLoop.checked) {
    autoLoopTimer += DT;
    if (autoLoopTimer >= 1.8) {
      rebuildScene();
    }
  } else {
    autoLoopTimer = 0;
  }
}

function renderGroundOverlay() {
  const w = renderer.lastViewW || canvas.clientWidth;
  const groundScreenY = renderer.lastGroundScreenY;
  if (!w || !groundScreenY) return;

  const ctx = renderer.ctx;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const focalUnits = (state.units || []).filter((u) => focalUnitIds.includes(u.id) && u.hp > 0);
  const primary = getPrimaryUnit();

  const unitHeightMap = {
    infantry: RENDER_HEIGHTS.infantry,
    aa_flak_truck: RENDER_HEIGHTS.aaTruck,
    armored_apc: RENDER_HEIGHTS.apc,
    main_battle_tank: RENDER_HEIGHTS.mbt,
    self_propelled_howitzer: RENDER_HEIGHTS.howitzer,
    ambulance: RENDER_HEIGHTS.ambulance,
    supply_truck: RENDER_HEIGHTS.supplyTruck
  };

  // Custom Profile Label above focal unit(s) (offset in screen pixels so it never touches HP text when zoomed out)
  const customTag = scene.profileLabel.trim();
  const hasHpText = elVisHealthBars.checked && elVisHealthText.checked;
  for (const u of focalUnits) {
    const tag = customTag || (u.id === primary?.id ? "TESTED" : "");
    if (!tag) continue;
    const uh = unitHeightMap[u.kind] || 48;
    const pt = renderer.worldToScreen(u.x, uh + 10, w, groundScreenY);
    const labelSy = pt.sy - (hasHpText ? 16 : 6);
    ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#4ade80";
    ctx.fillText(tag, pt.sx, labelSy);
    ctx.textAlign = "left";
  }

  // Weapon & Aura Ranges
  if (elVisRanges.checked) {
    for (const u of focalUnits) {
      const cfg = UNIT_CONFIG[u.unitId];
      if (!cfg) continue;

      if (u.kind === "supply_truck") {
        const left = renderer.worldToScreen(u.x - cfg.auraRadius, 0, w, groundScreenY);
        const right = renderer.worldToScreen(u.x + cfg.auraRadius, 0, w, groundScreenY);
        ctx.save();
        ctx.strokeStyle = "#34d399";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(left.sx, left.sy - 20);
        ctx.lineTo(left.sx, left.sy + 4);
        ctx.moveTo(right.sx, right.sy - 20);
        ctx.lineTo(right.sx, right.sy + 4);
        ctx.stroke();
        ctx.fillStyle = "#6ee7b7";
        ctx.font = "700 10px ui-monospace, monospace";
        ctx.textAlign = "center";
        const top = renderer.worldToScreen(u.x, RENDER_HEIGHTS.supplyTruck + 10, w, groundScreenY);
        ctx.fillText(`AURA ±${cfg.auraRadius}m (+${cfg.healRate} HP/s)`, top.sx, top.sy - (hasHpText ? 29 : 19));
        ctx.restore();

        // Repair beams to allies inside aura
        for (const ally of state.units || []) {
          if (ally.id === u.id || ally.team !== u.team || ally.hp <= 0 || !ally.repairedThisTick) continue;
          const a = renderer.worldToScreen(u.x, 30, w, groundScreenY);
          const b = renderer.worldToScreen(ally.x, 26, w, groundScreenY);
          ctx.save();
          ctx.strokeStyle = "rgba(52, 211, 153, 0.7)";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
          ctx.restore();
        }
      } else {
        const range = u.kind === "aa_flak_truck" ? cfg.groundRange : cfg.range;
        if (range) {
          const p0 = renderer.worldToScreen(u.x, 4, w, groundScreenY);
          const p1 = renderer.worldToScreen(u.x + u.dir * range, 4, w, groundScreenY);
          ctx.save();
          ctx.strokeStyle = "rgba(34, 197, 94, 0.75)";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.lineTo(p1.sx, p1.sy - 22);
          ctx.stroke();
          ctx.fillStyle = "#86efac";
          ctx.font = "700 9.5px ui-monospace, monospace";
          ctx.fillText(`${range}m`, p1.sx + (u.dir > 0 ? 4 : -28), p1.sy - 14);
          ctx.restore();
        }

        if (u.kind === "aa_flak_truck") {
          const center = renderer.worldToScreen(u.x, 34, w, groundScreenY);
          const rPx = cfg.visualRange * renderer.camZoom;
          ctx.save();
          ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(center.sx, center.sy, rPx, Math.PI, 0, false);
          ctx.stroke();
          ctx.fillStyle = "#7dd3fc";
          ctx.font = "700 9.5px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`SAM DOME ${cfg.visualRange}m`, center.sx, center.sy - rPx - 5);
          ctx.restore();
        }

        if (u.kind === "self_propelled_howitzer" && cfg.splashRadius > 0) {
          for (const pr of state.projectiles || []) {
            if (pr.ownerId === u.id && pr.kind === "howitzer_shell") {
              const pPt = renderer.worldToScreen(pr.x, 2, w, groundScreenY);
              const srPx = cfg.splashRadius * renderer.camZoom;
              ctx.save();
              ctx.strokeStyle = "rgba(249, 115, 22, 0.6)";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([3, 3]);
              ctx.beginPath();
              ctx.arc(pPt.sx, pPt.sy, srPx, Math.PI, 0, false);
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }
    }

    // Bunker defensive range & maxAirY ceiling
    for (const b of state.bunkers || []) {
      if (b.owner !== "enemy" || b.hp <= 0) continue;
      const bCfg = DEFENSE_CONFIG.bunker;
      const left = renderer.worldToScreen(b.x - bCfg.range, 6, w, groundScreenY);
      const right = renderer.worldToScreen(b.x + bCfg.range, 6, w, groundScreenY);
      const ceilL = renderer.worldToScreen(b.x - bCfg.range, bCfg.maxAirY, w, groundScreenY);
      const ceilR = renderer.worldToScreen(b.x + bCfg.range, bCfg.maxAirY, w, groundScreenY);
      ctx.save();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.48)";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(left.sx, left.sy);
      ctx.lineTo(left.sx, ceilL.sy);
      ctx.lineTo(ceilR.sx, ceilR.sy);
      ctx.lineTo(right.sx, right.sy);
      ctx.stroke();
      ctx.restore();
    }
  }

  // SAM Predictive Intercept Crosshairs
  if (elVisSamIntercept.checked) {
    for (const pr of state.projectiles || []) {
      if (pr.kind !== "sam_missile" || pr.predictedX === undefined) continue;
      const cur = renderer.worldToScreen(pr.x, pr.y, w, groundScreenY);
      const pred = renderer.worldToScreen(pr.predictedX, pr.predictedY, w, groundScreenY);
      ctx.save();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cur.sx, cur.sy);
      ctx.lineTo(pred.sx, pred.sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(pred.sx, pred.sy, 6, 0, Math.PI * 2);
      ctx.moveTo(pred.sx - 9, pred.sy);
      ctx.lineTo(pred.sx + 9, pred.sy);
      ctx.moveTo(pred.sx, pred.sy - 9);
      ctx.lineTo(pred.sx, pred.sy + 9);
      ctx.stroke();
      ctx.fillStyle = "#bae6fd";
      ctx.font = "800 9.5px ui-monospace, monospace";
      ctx.fillText((pr.samProfile || "sam").toUpperCase(), pred.sx + 8, pred.sy - 6);
      ctx.restore();
    }
  }

  // Hitboxes & Crossfire Zones
  if (elVisHitboxes.checked) {
    ctx.save();
    for (const u of state.units || []) {
      if (u.hp <= 0) continue;
      const { hitW, hitH } = getGroundUnitHitbox(u.kind);
      const tl = renderer.worldToScreen(u.x - hitW, hitH, w, groundScreenY);
      const br = renderer.worldToScreen(u.x + hitW, 0, w, groundScreenY);
      ctx.strokeStyle = u.kind === "ambulance"
        ? "#f59e0b"
        : u.team === "allied"
          ? "rgba(59, 130, 246, 0.8)"
          : "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 1.3;
      ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
    }
    for (const b of state.bunkers || []) {
      if (b.hp <= 0) continue;
      const tl = renderer.worldToScreen(b.x - 62, 84, w, groundScreenY);
      const br = renderer.worldToScreen(b.x + 62, 0, w, groundScreenY);
      ctx.strokeStyle = "rgba(248, 113, 113, 0.65)";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
    }
    const air = state.players[ENEMY_AIR_ID];
    if (air && air.alive && !air.crashing) {
      const c = renderer.worldToScreen(air.x, air.y + 22, w, groundScreenY);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, 34 * renderer.camZoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

function updateTelemetry() {
  const cfg = UNIT_CONFIG[selectedUnitId];
  const u = getPrimaryUnit();

  elTelUnitName.textContent = cfg.name.toUpperCase();
  if (!u) {
    elTelUnitStatus.textContent = combatMetrics.outcome === "BUNKER CAPTURED" ? "CAPTURED BUNKER" : "DESTROYED";
    elTelUnitStatus.style.color = combatMetrics.outcome === "BUNKER CAPTURED" ? "#4ade80" : "#ef4444";
    elTelHpReadout.textContent = `0 / ${cfg.maxHp} (0%)`;
    elTelHpFill.style.width = "0%";
    elTelSpeed.textContent = `0 / ${cfg.speed} px/s`;
    elTelDegrade.textContent = GROUND_BEHAVIOR_CONFIG.damageDegradationEnabled ? "OFFLINE" : "DISABLED";
  } else {
    const ratio = u.maxHp > 0 ? clamp(u.hp / u.maxHp, 0, 1) : 0;
    const pct = Math.round(ratio * 100);
    elTelHpReadout.textContent = `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)} (${pct}%)`;
    elTelHpFill.style.width = `${pct}%`;
    elTelHpFill.style.background = pct > 60 ? "#22c55e" : pct > 30 ? "#f59e0b" : "#ef4444";

    const spdMult = getGroundUnitSpeedMultiplier(u);
    const curSpd = Math.abs(u.vx || 0);
    elTelSpeed.textContent = `${Math.round(curSpd)} / ${Math.round(cfg.speed * spdMult)} px/s`;
    elTelDegrade.textContent = GROUND_BEHAVIOR_CONFIG.damageDegradationEnabled
      ? `${Math.round(spdMult * 100)}% spd`
      : "No penalty";

    let status = Math.abs(u.vx) > 1 ? "ADVANCING" : "ENGAGED / HOLD";
    let statusColor = Math.abs(u.vx) > 1 ? "#22c55e" : "#38bdf8";
    if (u.kind === "ambulance" && u.returningToBase) {
      status = "RETURNING TO HQ";
      statusColor = "#fde047";
    } else if (u.repairedThisTick) {
      status = "REPAIRING";
      statusColor = "#34d399";
    }
    elTelUnitStatus.textContent = status;
    elTelUnitStatus.style.color = statusColor;
  }

  // Card 2: Rate of Fire & DPS
  if (selectedUnitId === "ambulance") {
    elTelDpsReadout.textContent = "NON-COMBAT";
    elTelRofDetail.textContent = `Cabin: ${cfg.cabinCapacity} civs`;
    elTelReloadText.textContent = u ? `${u.passengers.length}/${u.cabinCapacity} onboard` : "0";
    elTelReloadFill.style.width = u ? `${(u.passengers.length / Math.max(1, u.cabinCapacity)) * 100}%` : "0%";
    elTelSamRow.style.display = "none";
    elTelCombatTotals.textContent = `${combatMetrics.civiliansRescued} rescued • +$${combatMetrics.fundsEarned}`;
  } else if (selectedUnitId === "supply_truck") {
    elTelDpsReadout.textContent = `+${cfg.healRate} HP/s`;
    elTelRofDetail.textContent = `Aura: ±${cfg.auraRadius}m`;
    const auraCount = u
      ? (state.units || []).filter((o) => o.id !== u.id && o.team === "allied" && o.hp > 0 && Math.abs(o.x - u.x) <= cfg.auraRadius).length
      : 0;
    elTelReloadText.textContent = `${auraCount} allies in aura`;
    elTelReloadFill.style.width = auraCount > 0 ? "100%" : "0%";
    elTelSamRow.style.display = "none";
    elTelCombatTotals.textContent = `${Math.round(combatMetrics.hpHealed)} HP repaired total`;
  } else {
    const baseCd = selectedUnitId === "aa_truck" ? cfg.groundFireCooldownTicks : cfg.fireCooldownTicks;
    const dmg = selectedUnitId === "aa_truck" ? cfg.groundDamage : cfg.damage;
    const effCd = u ? getGroundUnitFireCooldown(baseCd, u) : baseCd;
    const rof = TICK_RATE / Math.max(1, effCd);
    const dps = rof * dmg;
    elTelDpsReadout.textContent = `${rof.toFixed(2)}/s • ${dps.toFixed(1)} DPS`;
    elTelRofDetail.textContent = `CD: ${effCd}t • ${dmg} dmg`;

    const cdLeft = u ? u.fireCooldown : 0;
    const readyPct = clamp(1 - cdLeft / Math.max(1, effCd), 0, 1) * 100;
    elTelReloadFill.style.width = `${readyPct}%`;
    elTelReloadText.textContent = cdLeft > 0 ? `${cdLeft}t` : "READY";

    if (selectedUnitId === "aa_truck") {
      elTelSamRow.style.display = "flex";
      const samEffCd = u ? getGroundUnitFireCooldown(cfg.samCooldownTicks, u) : cfg.samCooldownTicks;
      const samCd = u ? u.samCooldown : 0;
      elTelSamFill.style.width = `${clamp(1 - samCd / Math.max(1, samEffCd), 0, 1) * 100}%`;
      elTelSamText.textContent = samCd > 0 ? `${samCd}t` : `READY (${(TICK_RATE / samEffCd).toFixed(2)}/s)`;
    } else {
      elTelSamRow.style.display = "none";
    }
    elTelCombatTotals.textContent = `${combatMetrics.shotsFired} shots • ${combatMetrics.hits} hits • ${combatMetrics.damageDealt} dmg`;
  }

  // Card 3: Target & Role Telemetry
  let nearestEnemy = null;
  let nearestDist = Infinity;
  const refX = u ? u.x : lastFocalX;
  for (const eu of state.units || []) {
    if (eu.team !== "enemy" || eu.hp <= 0) continue;
    const d = Math.abs(eu.x - refX);
    if (d < nearestDist) {
      nearestDist = d;
      nearestEnemy = `${eu.kind.replace(/_/g, " ")} (${Math.ceil(eu.hp)} HP)`;
    }
  }
  for (const b of state.bunkers || []) {
    if (b.owner !== "enemy" || b.hp <= 0) continue;
    const d = Math.abs(b.x - refX);
    if (d < nearestDist) {
      nearestDist = d;
      nearestEnemy = `Enemy Bunker (${Math.ceil(b.hp)} HP)`;
    }
  }
  const air = state.players[ENEMY_AIR_ID];
  if (air && air.alive) {
    const d = Math.hypot(air.x - refX, air.y - 24);
    if (d < nearestDist) {
      nearestDist = d;
      nearestEnemy = `${air.aircraftType.toUpperCase()} (${Math.ceil(air.hp)} HP)`;
    }
  }
  for (const b52 of state.b52s || []) {
    if (!b52.alive || b52.hp <= 0) continue;
    const d = Math.hypot(b52.x - refX, b52.y - 24);
    if (d < nearestDist) {
      nearestDist = d;
      nearestEnemy = `B-52 (${Math.ceil(b52.hp)} HP)`;
    }
  }

  elTelTargetDist.textContent = Number.isFinite(nearestDist) ? `${Math.round(nearestDist)}m` : "NO TARGET";
  elTelTargetReadout.textContent = nearestEnemy ? `Target: ${nearestEnemy}` : "Target: None";

  if (selectedUnitId === "infantry") {
    elTelRoleLabel.textContent = cfg.canCaptureBunker ? "CAPTURE ON" : "CAPTURE OFF";
    elTelRoleDetail.textContent = `X: ${Math.round(refX)}m`;
    elTelRoleExtra.textContent = `Range: ${cfg.range}m`;
  } else if (selectedUnitId === "aa_truck") {
    const modeTag = u && u.hp < u.maxHp && GROUND_BEHAVIOR_CONFIG.damageDegradationEnabled && GROUND_BEHAVIOR_CONFIG.damagedAaSlowOnly
      ? "SLOW ONLY"
      : "3-PROFILE";
    elTelRoleLabel.textContent = `SAM: ${modeTag}`;
    elTelRoleDetail.textContent = `Dome: ${cfg.visualRange}m • ${cfg.samDamage} dmg`;
    elTelRoleExtra.textContent = `Ground: ${cfg.groundRange}m`;
  } else if (selectedUnitId === "apc") {
    elTelRoleLabel.textContent = `CARGO: ${u ? u.troopsCarried : cfg.deployTroopCount}`;
    elTelRoleDetail.textContent = u?.deployedTroops ? "Troops deployed" : "Ready to deploy";
    elTelRoleExtra.textContent = `Range: ${cfg.range}m`;
  } else if (selectedUnitId === "mbt") {
    elTelRoleLabel.textContent = cfg.heavyArmor ? "HEAVY ARMOR" : "LIGHT";
    elTelRoleDetail.textContent = `Rear Mult: ${GROUND_BEHAVIOR_CONFIG.rearHitMultiplier}x`;
    elTelRoleExtra.textContent = `Range: ${cfg.range}m`;
  } else if (selectedUnitId === "howitzer") {
    elTelRoleLabel.textContent = `SPLASH ${cfg.splashRadius}m`;
    elTelRoleDetail.textContent = `Standoff Artillery`;
    elTelRoleExtra.textContent = `Range: ${cfg.range}m`;
  } else if (selectedUnitId === "ambulance") {
    elTelRoleLabel.textContent = GROUND_BEHAVIOR_CONFIG.ambulanceTargetable ? "TARGETABLE" : "IMMUNE DIRECT";
    elTelRoleDetail.textContent = `Crossfire: ${Math.round(GROUND_BEHAVIOR_CONFIG.ambulanceCrossfireRatio * 100)}%`;
    elTelRoleExtra.textContent = `Civs left: ${(state.civilians || []).length}`;
  } else {
    elTelRoleLabel.textContent = GROUND_BEHAVIOR_CONFIG.supplyReloadBoost ? "RELOAD BOOST" : "HEAL ONLY";
    elTelRoleDetail.textContent = `Heal: +${cfg.healRate} HP/s`;
    elTelRoleExtra.textContent = `Aura: ±${cfg.auraRadius}m`;
  }

  // Card 4: Clock & Event Feed
  elTelClock.textContent = `T+${(state.time || 0).toFixed(1)}s • ${state.tick}t`;
  elTelOutcome.textContent = combatMetrics.outcome;
  elTelOutcome.style.color = combatMetrics.outcome === "ACTIVE"
    ? "#38bdf8"
    : combatMetrics.outcome === "UNIT LOST"
      ? "#ef4444"
      : "#4ade80";

  elTelEventFeed.innerHTML = eventLog
    .slice(0, 4)
    .map((ev) => `<div style="color:${ev.color};">[${ev.time}s] ${ev.text}</div>`)
    .join("");
}

function selectUnit(unitId) {
  if (!UNIT_CONFIG[unitId]) return;
  selectedUnitId = unitId;
  for (const btn of unitButtons) {
    btn.classList.toggle("active", btn.dataset.unit === unitId);
    btn.blur();
  }
  buildUnitControls();
  if (!scenePinned) {
    const autoPreset = unitId === "aa_truck"
      ? "vs_aircraft"
      : (unitId === "ambulance" || unitId === "supply_truck")
        ? "support_rescue"
        : "vs_troop";
    applyPreset(autoPreset, true);
  } else {
    syncSceneUiFromModel();
    rebuildScene();
  }
}

// Bind Unit Selector Buttons
for (const btn of unitButtons) {
  btn.addEventListener("click", () => selectUnit(btn.dataset.unit));
}

// Bind Scenario Presets
for (const btn of presetButtons) {
  btn.addEventListener("click", () => {
    scenePinned = true;
    applyPreset(btn.dataset.preset, true);
    btn.blur();
  });
}

// Bind Dock Filter Tabs
function applyDockTabFilter() {
  for (const tab of dockTabs) {
    tab.classList.toggle("active", tab.dataset.tab === activeTab);
  }
  for (const sec of dockSections) {
    const kind = sec.dataset.section;
    const show = activeTab === "all" || activeTab === kind;
    sec.style.display = show ? "block" : "none";
    if (show && activeTab !== "all") sec.open = true;
  }
}

for (const tab of dockTabs) {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    applyDockTabFilter();
    tab.blur();
  });
}

// Bind Scene Checklist Controls
function bindChecklistControl(el, eventName, handler, markPinned = true) {
  el.addEventListener(eventName, () => {
    if (markPinned) scenePinned = true;
    handler();
    if (el.type === "checkbox" || el.tagName === "SELECT") el.blur();
  });
}

bindChecklistControl(elArenaLen, "change", () => {
  scene.arenaLen = Number(elArenaLen.value) || 2000;
  const halfLen = scene.arenaLen * 0.5;
  scene.troopStartX = clamp(scene.troopStartX, -halfLen + 110, halfLen - 110);
  scene.enemyX = clamp(scene.enemyX, -halfLen + 110, halfLen - 110);
  scene.enemyBunkerX = clamp(scene.enemyBunkerX, -halfLen + 110, halfLen - 110);
  scene.neutralBunkerX = clamp(scene.neutralBunkerX, -halfLen + 110, halfLen - 110);
  syncSceneUiFromModel();
  rebuildScene();
}, false);

elProfileLabel.addEventListener("input", () => {
  scene.profileLabel = elProfileLabel.value;
});
elProfileLabel.addEventListener("change", () => elProfileLabel.blur());

bindChecklistControl(elTroopCount, "change", () => {
  scene.troopCount = clamp(Math.round(Number(elTroopCount.value) || 1), 1, 5);
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elTroopX, "change", () => {
  const halfLen = scene.arenaLen * 0.5;
  scene.troopStartX = clamp(Math.round(Number(elTroopX.value) || 0), -halfLen + 80, halfLen - 80);
  syncSceneUiFromModel();
  rebuildScene();
});
elTroopHpRange.addEventListener("input", () => {
  scene.troopStartHpPct = clamp(Number(elTroopHpRange.value) || 100, 5, 100);
  elTroopHpNum.value = String(scene.troopStartHpPct);
  elTroopHpLbl.textContent = `${scene.troopStartHpPct}%`;
});
bindChecklistControl(elTroopHpRange, "change", () => rebuildScene());
bindChecklistControl(elTroopHpNum, "change", () => {
  scene.troopStartHpPct = clamp(Number(elTroopHpNum.value) || 100, 5, 100);
  syncSceneUiFromModel();
  rebuildScene();
});

bindChecklistControl(elChkEnemyTroop, "change", () => {
  scene.enemyTroop = elChkEnemyTroop.checked;
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elEnemyType, "change", () => {
  scene.enemyType = elEnemyType.value;
  rebuildScene();
});
bindChecklistControl(elEnemyBehavior, "change", () => {
  scene.enemyBehavior = elEnemyBehavior.value;
  rebuildScene();
});
bindChecklistControl(elEnemyCount, "change", () => {
  scene.enemyCount = clamp(Math.round(Number(elEnemyCount.value) || 1), 1, 4);
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elEnemyX, "change", () => {
  const halfLen = scene.arenaLen * 0.5;
  scene.enemyX = clamp(Math.round(Number(elEnemyX.value) || 0), -halfLen + 80, halfLen - 80);
  syncSceneUiFromModel();
  rebuildScene();
});
elEnemyHpRange.addEventListener("input", () => {
  scene.enemyHpPct = clamp(Number(elEnemyHpRange.value) || 100, 10, 100);
  elEnemyHpNum.value = String(scene.enemyHpPct);
});
bindChecklistControl(elEnemyHpRange, "change", () => rebuildScene());
bindChecklistControl(elEnemyHpNum, "change", () => {
  scene.enemyHpPct = clamp(Number(elEnemyHpNum.value) || 100, 10, 100);
  syncSceneUiFromModel();
  rebuildScene();
});

bindChecklistControl(elChkEnemyBunker, "change", () => {
  scene.enemyBunker = elChkEnemyBunker.checked;
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elEnemyBunkerX, "change", () => {
  const halfLen = scene.arenaLen * 0.5;
  scene.enemyBunkerX = clamp(Math.round(Number(elEnemyBunkerX.value) || 0), -halfLen + 80, halfLen - 80);
  syncSceneUiFromModel();
  rebuildScene();
});
elEnemyBunkerHpRange.addEventListener("input", () => {
  scene.enemyBunkerHpPct = clamp(Number(elEnemyBunkerHpRange.value) || 100, 10, 100);
  elEnemyBunkerHpNum.value = String(scene.enemyBunkerHpPct);
});
bindChecklistControl(elEnemyBunkerHpRange, "change", () => rebuildScene());
bindChecklistControl(elEnemyBunkerHpNum, "change", () => {
  scene.enemyBunkerHpPct = clamp(Number(elEnemyBunkerHpNum.value) || 100, 10, 100);
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elEnemyBunkerPassive, "change", () => {
  scene.enemyBunkerPassive = elEnemyBunkerPassive.checked;
  rebuildScene();
});

bindChecklistControl(elChkNeutralBunker, "change", () => {
  scene.neutralBunker = elChkNeutralBunker.checked;
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elNeutralBunkerX, "change", () => {
  const halfLen = scene.arenaLen * 0.5;
  scene.neutralBunkerX = clamp(Math.round(Number(elNeutralBunkerX.value) || 0), -halfLen + 80, halfLen - 80);
  syncSceneUiFromModel();
  rebuildScene();
});

bindChecklistControl(elChkEnemyAircraft, "change", () => {
  scene.enemyAircraft = elChkEnemyAircraft.checked;
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elAircraftType, "change", () => {
  scene.aircraftType = elAircraftType.value;
  rebuildScene();
});
bindChecklistControl(elAircraftMode, "change", () => {
  scene.aircraftMode = elAircraftMode.value;
  rebuildScene();
});
elAircraftAltRange.addEventListener("input", () => {
  scene.aircraftAltitude = clamp(Number(elAircraftAltRange.value) || 260, 90, 700);
  elAircraftAltNum.value = String(scene.aircraftAltitude);
});
bindChecklistControl(elAircraftAltRange, "change", () => rebuildScene());
bindChecklistControl(elAircraftAltNum, "change", () => {
  scene.aircraftAltitude = clamp(Number(elAircraftAltNum.value) || 260, 90, 700);
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elAircraftArmed, "change", () => {
  scene.aircraftArmed = elAircraftArmed.checked;
  rebuildScene();
});

bindChecklistControl(elChkAlliedEscort, "change", () => {
  scene.alliedEscort = elChkAlliedEscort.checked;
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elEscortType, "change", () => {
  scene.escortType = elEscortType.value;
  rebuildScene();
});
elEscortHpRange.addEventListener("input", () => {
  scene.escortHpPct = clamp(Number(elEscortHpRange.value) || 100, 10, 100);
  elEscortHpNum.value = String(scene.escortHpPct);
});
bindChecklistControl(elEscortHpRange, "change", () => rebuildScene());
bindChecklistControl(elEscortHpNum, "change", () => {
  scene.escortHpPct = clamp(Number(elEscortHpNum.value) || 100, 10, 100);
  syncSceneUiFromModel();
  rebuildScene();
});

bindChecklistControl(elChkCivilians, "change", () => {
  scene.civilians = elChkCivilians.checked;
  syncSceneUiFromModel();
  rebuildScene();
});
bindChecklistControl(elCivCount, "change", () => {
  scene.civCount = clamp(Math.round(Number(elCivCount.value) || 2), 1, 3);
  syncSceneUiFromModel();
  rebuildScene();
});

bindChecklistControl(elChkAlliedHq, "change", () => {
  scene.alliedHq = elChkAlliedHq.checked;
  rebuildScene();
});
bindChecklistControl(elChkEnemyHq, "change", () => {
  scene.enemyHq = elChkEnemyHq.checked;
  rebuildScene();
});

// Visual Overlay Checkboxes
elVisHealthBars.addEventListener("change", () => {
  renderer.showHealthBars = elVisHealthBars.checked;
  elVisHealthBars.blur();
});
elVisHealthText.addEventListener("change", () => {
  renderer.showHealthText = elVisHealthText.checked;
  elVisHealthText.blur();
});
elVisHpColor.addEventListener("change", () => {
  renderer.colorHealthBarsByHp = elVisHpColor.checked;
  elVisHpColor.blur();
});
for (const cb of [elVisRanges, elVisSamIntercept, elVisHitboxes, elAutoLoop]) {
  cb.addEventListener("change", () => cb.blur());
}

// Topbar & Quick Actions
elSimSpeed.addEventListener("change", () => {
  const val = Number(elSimSpeed.value);
  if (val > 0) simSpeedBeforePause = val;
  elSimSpeed.blur();
});

elCameraMode.addEventListener("change", () => {
  if (elCameraMode.value !== "free") snapCameraToMode();
  elCameraMode.blur();
});

document.getElementById("btn-step-tick").addEventListener("click", (e) => {
  elSimSpeed.value = "0";
  stepLabSimulation();
  e.currentTarget.blur();
});

document.getElementById("btn-reset-scene").addEventListener("click", (e) => {
  rebuildScene();
  e.currentTarget.blur();
});

document.getElementById("btn-dmg-troop").addEventListener("click", (e) => {
  for (const id of focalUnitIds) {
    const u = (state.units || []).find((x) => x.id === id && x.hp > 0);
    if (u) u.hp = Math.max(1, Math.round(u.hp - u.maxHp * 0.25));
  }
  pushEventLog("Applied -25% max HP damage to focal troop", "#f59e0b");
  e.currentTarget.blur();
});

document.getElementById("btn-heal-troop").addEventListener("click", (e) => {
  for (const id of focalUnitIds) {
    const u = (state.units || []).find((x) => x.id === id && x.hp > 0);
    if (u) u.hp = u.maxHp;
  }
  pushEventLog("Restored focal troop to 100% HP", "#4ade80");
  e.currentTarget.blur();
});

document.getElementById("btn-spawn-extra").addEventListener("click", (e) => {
  const halfLen = scene.arenaLen * 0.5;
  const x = clamp(scene.troopStartX - focalUnitIds.length * 46, -halfLen + 70, halfLen - 70);
  const extra = spawnGroundUnit(state, "allied", selectedUnitId, x);
  if (extra) {
    extra.isLabPrimary = true;
    focalUnitIds.push(extra.id);
    pushEventLog(`Spawned extra ${UNIT_CONFIG[selectedUnitId].name}`, "#4ade80");
  }
  e.currentTarget.blur();
});

document.getElementById("btn-zoom-in").addEventListener("click", (e) => {
  if (elCameraMode.value === "fit") {
    customZoom = renderer.camZoom;
    elCameraMode.value = "follow";
  }
  customZoom = clamp(customZoom * 1.18, 0.25, 2.2);
  renderer.camZoom = customZoom;
  e.currentTarget.blur();
});

document.getElementById("btn-zoom-out").addEventListener("click", (e) => {
  if (elCameraMode.value === "fit") {
    customZoom = renderer.camZoom;
    elCameraMode.value = "follow";
  }
  customZoom = clamp(customZoom / 1.18, 0.25, 2.2);
  renderer.camZoom = customZoom;
  e.currentTarget.blur();
});

// Dock Reset / Save / Copy Actions
document.getElementById("lab-reset-unit-btn").addEventListener("click", (e) => {
  const patch = { resetUnit: selectedUnitId };
  const cfg = updateGroundConfig(patch);
  applyExternalConfig(cfg);
  syncWsConfig(patch);
  rebuildScene();
  e.currentTarget.blur();
});

document.getElementById("lab-reset-all-btn").addEventListener("click", (e) => {
  const patch = { reset: true };
  const cfg = updateGroundConfig(patch);
  applyExternalConfig(cfg);
  syncWsConfig(patch);
  rebuildScene();
  e.currentTarget.blur();
});

const elSaveBtn = document.getElementById("lab-save-btn");
elSaveBtn.addEventListener("click", () => {
  saveConfigLocally();
  syncWsConfig(getGroundConfigSnapshot(), true);
  elSaveBtn.textContent = "Saved!";
  setTimeout(() => { elSaveBtn.textContent = "Save Config"; }, 1200);
  elSaveBtn.blur();
});

const elCopyBtn = document.getElementById("lab-copy-btn");
elCopyBtn.addEventListener("click", async () => {
  const json = JSON.stringify({
    profileLabel: scene.profileLabel || UNIT_CONFIG[selectedUnitId].name,
    selectedUnit: selectedUnitId,
    scene: { ...scene },
    config: getGroundConfigSnapshot()
  }, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    elCopyBtn.textContent = "Copied!";
  } catch {
    window.prompt("Copy Ground Lab JSON:", json);
  }
  setTimeout(() => { elCopyBtn.textContent = "Copy JSON"; }, 1200);
  elCopyBtn.blur();
});

// Canvas Mouse Drag-to-Pan & Wheel-to-Zoom
let dragging = false;
let dragStartX = 0;
let dragStartCamX = 0;
let dragMoved = false;

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartCamX = renderer.camX;
  canvas.classList.add("dragging");
  canvas.setPointerCapture?.(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragStartX;
  if (Math.abs(dx) > 3) {
    dragMoved = true;
    if (elCameraMode.value !== "free") {
      customZoom = renderer.camZoom;
      elCameraMode.value = "free";
    }
  }
  if (dragMoved) {
    const halfLen = scene.arenaLen * 0.5;
    renderer.camX = clamp(dragStartCamX - dx / Math.max(0.2, renderer.camZoom), -halfLen - 200, halfLen + 200);
  }
});

const endDrag = () => {
  dragging = false;
  canvas.classList.remove("dragging");
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (elCameraMode.value === "fit") {
    customZoom = renderer.camZoom;
    elCameraMode.value = "free";
  }
  customZoom = clamp(customZoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.25, 2.2);
  renderer.camZoom = customZoom;
}, { passive: false });

// Keyboard Hotkeys
const heldArrows = new Set();
window.addEventListener("keydown", (e) => {
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (/^Digit[1-7]$/.test(e.code)) {
    const idx = Number(e.code.slice(5)) - 1;
    if (GROUND_UNIT_ORDER[idx]) selectUnit(GROUND_UNIT_ORDER[idx]);
    return;
  }
  if (e.code === "KeyR" && !e.repeat) {
    rebuildScene();
    return;
  }
  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    const cur = Number(elSimSpeed.value);
    if (cur === 0) elSimSpeed.value = String(simSpeedBeforePause || 1);
    else {
      simSpeedBeforePause = cur;
      elSimSpeed.value = "0";
    }
    return;
  }
  if (e.code === "Period") {
    e.preventDefault();
    elSimSpeed.value = "0";
    stepLabSimulation();
    return;
  }
  if (e.code.startsWith("Arrow")) {
    e.preventDefault();
    heldArrows.add(e.code);
    if (elCameraMode.value !== "free") {
      customZoom = renderer.camZoom;
      elCameraMode.value = "free";
    }
  }
});

window.addEventListener("keyup", (e) => {
  heldArrows.delete(e.code);
});

// Initialize
buildUnitControls();
buildRulesControls();
applyDockTabFilter();
await renderer.loadAll();
applyPreset("vs_troop", true);
connectConfigBridge();

let accumulator = 0;
let lastTime = performance.now();

function loop(now) {
  const realDt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const simScale = Number(elSimSpeed.value);
  const scaledDt = realDt * simScale;

  if (heldArrows.size > 0 && elCameraMode.value === "free") {
    const halfLen = scene.arenaLen * 0.5;
    const h = (heldArrows.has("ArrowRight") ? 1 : 0) - (heldArrows.has("ArrowLeft") ? 1 : 0);
    const v = (heldArrows.has("ArrowUp") ? 1 : 0) - (heldArrows.has("ArrowDown") ? 1 : 0);
    renderer.camX = clamp(renderer.camX + h * 750 * realDt, -halfLen - 200, halfLen + 200);
    renderer.camY = clamp(renderer.camY + v * 420 * realDt, 90, 620);
  }

  if (simScale > 0) {
    accumulator += scaledDt;
    let steps = 0;
    while (accumulator >= DT && steps < 10) {
      stepLabSimulation();
      accumulator -= DT;
      steps += 1;
    }
    if (steps >= 10) accumulator = 0;
  }

  let cameraOverride = null;
  const camMode = elCameraMode.value;
  if (camMode === "fit") {
    cameraOverride = {
      x: 0,
      y: scene.enemyAircraft ? Math.max(180, scene.aircraftAltitude * 0.52) : 150,
      zoom: getFitZoom()
    };
  } else if (camMode === "follow") {
    const focal = getPrimaryUnit();
    cameraOverride = {
      x: (focal?.x ?? lastFocalX) + 120,
      y: 150,
      zoom: customZoom
    };
  } else {
    cameraOverride = { manual: true };
  }

  renderer.render(state, null, simScale > 0 ? scaledDt : 0, null, cameraOverride);
  renderGroundOverlay();
  updateTelemetry();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
