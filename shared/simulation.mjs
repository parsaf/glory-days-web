import {
  AIRCRAFT_CONFIG,
  AUTO_PRODUCTION_COLUMN_PAUSE_TICKS,
  AUTO_PRODUCTION_COLUMN_SIZE,
  AUTO_PRODUCTION_COOLDOWN_TICKS,
  AUTO_PRODUCTION_GATE_CLEARANCE,
  AUTO_PRODUCTION_PATTERN,
  BASE_INCOME_PER_SEC,
  BASES,
  BUNKER_INCOME_PER_SEC,
  BUNKER_X_POSITIONS,
  BURST_FIRE_INTERVAL,
  BURST_MAX_TICKS,
  BURST_RECHARGE_DELAY,
  BURST_RECHARGE_RATE,
  CEILING_Y,
  CIVILIAN_KILL_PENALTY,
  DEFAULT_BUNKER_CONFIG,
  DEFAULT_GROUND_BEHAVIOR_CONFIG,
  DEFAULT_HELI_CONFIG,
  DEFAULT_P47_CONFIG,
  DEFAULT_UNIT_CONFIG,
  DEFENSE_CONFIG,
  DT,
  GRAVITY,
  GROUND_BEHAVIOR_CONFIG,
  GROUND_Y,
  MATCH_MODES,
  MAX_X,
  MIN_X,
  MISSILE_FUEL_DISTANCE,
  SLOW_FIRE_INTERVAL,
  SPECIAL_WEAPON_CIV_GOAL_BASE,
  SPECIAL_WEAPON_CIV_GOAL_MULTI_HELI,
  STRATEGIC_CONFIG,
  TICK_RATE,
  UNIT_CONFIG,
  VILLAGE_X_POSITIONS
} from "./constants.mjs";

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function getWorldBounds(state) {
  return {
    minX: state?.worldBounds?.minX ?? MIN_X,
    maxX: state?.worldBounds?.maxX ?? MAX_X
  };
}

export function calculateCivilianPayout(count) {
  if (count <= 0) return 0;
  return 40 * count + 15 * count * count;
}

export function spawnCivilian(state, x, villageX = x) {
  const civ = {
    id: `civ_${state.nextEntityId++}`,
    x,
    y: GROUND_Y,
    vx: 0,
    dir: 1,
    hp: 20,
    state: "wave", // 'wave' | 'turn' | 'run'
    turnTimer: 0,
    animPhase: Math.random() * 4,
    targetExtractorId: null,
    villageX
  };
  state.civilians.push(civ);
  return civ;
}

function resolveUnitConfig(unitKeyOrId) {
  const map = {
    "1": UNIT_CONFIG.infantry,
    infantry: UNIT_CONFIG.infantry,
    "2": UNIT_CONFIG.aa_truck,
    aa_truck: UNIT_CONFIG.aa_truck,
    aa_flak_truck: UNIT_CONFIG.aa_truck,
    "3": UNIT_CONFIG.mbt,
    mbt: UNIT_CONFIG.mbt,
    main_battle_tank: UNIT_CONFIG.mbt,
    "4": UNIT_CONFIG.howitzer,
    howitzer: UNIT_CONFIG.howitzer,
    self_propelled_howitzer: UNIT_CONFIG.howitzer,
    "5": UNIT_CONFIG.ambulance,
    ambulance: UNIT_CONFIG.ambulance,
    "6": UNIT_CONFIG.supply_truck,
    supply_truck: UNIT_CONFIG.supply_truck
  };
  return map[String(unitKeyOrId)] || null;
}

export function getGroundUnitHitbox(kind) {
  if (kind === "infantry") return { hitW: 26, hitH: 30 };
  if (kind === "self_propelled_howitzer") return { hitW: 64, hitH: 54 };
  return { hitW: 52, hitH: 54 };
}

export function getGroundUnitSpeedMultiplier(unit) {
  if (!GROUND_BEHAVIOR_CONFIG.damageDegradationEnabled) return 1;
  const maxHp = Math.max(1, unit?.maxHp ?? 40);
  const hp = clamp(unit?.hp ?? maxHp, 0, maxHp);
  if (hp >= maxHp) return 1;
  const minFactor = clamp(GROUND_BEHAVIOR_CONFIG.minDamagedSpeedFactor, 0.05, 1);
  return minFactor + (1 - minFactor) * (hp / maxHp);
}

export function getGroundUnitFireCooldown(baseCooldown, unit) {
  if (!GROUND_BEHAVIOR_CONFIG.damageDegradationEnabled) return baseCooldown;
  const maxHp = Math.max(1, unit?.maxHp ?? 40);
  const hp = clamp(unit?.hp ?? maxHp, 0, maxHp);
  if (hp >= maxHp) return baseCooldown;
  const maxMult = Math.max(1, GROUND_BEHAVIOR_CONFIG.maxDamagedCooldownMult);
  if (maxMult <= 1) return baseCooldown;
  const damageRatio = 1 - hp / maxHp;
  const mult = 1 + damageRatio * (maxMult - 1);
  return Math.max(baseCooldown + 1, Math.round(baseCooldown * mult));
}

export function solveInterceptTime(rx, ry, vx, vy, speed) {
  const c = rx * rx + ry * ry;
  if (c <= 1e-6) return 0.001;
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (rx * vx + ry * vy);
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return null;
    const t = -c / b;
    return t > 0 && Number.isFinite(t) ? t : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtD = Math.sqrt(disc);
  const t1 = (-b - sqrtD) / (2 * a);
  const t2 = (-b + sqrtD) / (2 * a);
  let best = null;
  if (t1 > 0 && Number.isFinite(t1)) best = t1;
  if (t2 > 0 && Number.isFinite(t2) && (best === null || t2 < best)) best = t2;
  return best;
}

export function planSamInterception(originX, originY, target, track = null, opts = {}) {
  const aaCfg = UNIT_CONFIG.aa_truck;
  const samSpeeds = opts.samSpeeds || aaCfg.samSpeeds;
  const visualRange = opts.visualRange ?? aaCfg.visualRange;
  const maxFlightTime = opts.maxFlightTime ?? aaCfg.samMaxFlightTime;

  const rx = target.x - originX;
  const ry = target.y - originY;
  const dist = Math.hypot(rx, ry);
  if (dist > visualRange || target.y <= 15) return null;

  const tvx = target.vx ?? target.ref?.vx ?? 0;
  const tvy = target.vy ?? target.ref?.vy ?? 0;
  const targetSpeed = Math.hypot(tvx, tvy);
  const radialSpeed = dist > 1 ? (rx * tvx + ry * tvy) / dist : 0;
  const accelMag = track && track.ticks >= 4 ? Math.hypot(track.ax || 0, track.ay || 0) : 0;
  const isTurning = Boolean(target.ref?.turnTimer > 0);

  const evalProfile = (profile) => {
    const speed = samSpeeds[profile];
    if (!speed) return null;
    let t = solveInterceptTime(rx, ry, tvx, tvy, speed);
    if (t === null || t > maxFlightTime) return null;

    let predX = target.x + tvx * t;
    let predY = target.y + tvy * t;
    if (track && track.ticks >= 4 && (Math.abs(track.ax || 0) > 10 || Math.abs(track.ay || 0) > 10)) {
      const tAcc = Math.min(t, 0.8);
      predX += 0.5 * (track.ax || 0) * 0.35 * tAcc * tAcc;
      predY += 0.5 * (track.ay || 0) * 0.35 * tAcc * tAcc;
      const tRefined = Math.hypot(predX - originX, predY - originY) / speed;
      if (tRefined > maxFlightTime) return null;
      t = tRefined;
    }

    if (predY < 8 || predY > CEILING_Y + 60 || predX < MIN_X || predX > MAX_X) return null;
    const dx = predX - originX;
    const dy = predY - originY;
    const interceptDist = Math.hypot(dx, dy);
    if (interceptDist > visualRange * 1.65) return null;
    const len = Math.max(1, interceptDist);
    return {
      profile,
      speed,
      t,
      predictedX: predX,
      predictedY: predY,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      interceptDist
    };
  };

  if (opts.damaged) {
    return evalProfile("slow");
  }

  const slowSol = evalProfile("slow");
  const medSol = evalProfile("medium");
  const fastSol = evalProfile("fast");

  if (slowSol && targetSpeed <= 175 && radialSpeed <= 60 && accelMag <= 90 && !isTurning && slowSol.t <= 1.55) {
    return slowSol;
  }
  if (medSol && targetSpeed <= 400 && radialSpeed <= 160 && accelMag <= 160 && !isTurning && medSol.t <= 1.45) {
    return medSol;
  }
  return fastSol || medSol || slowSol || null;
}

export function setAutoProduction(state, team, enabled) {
  if (team !== "allied" && team !== "enemy") return false;
  if (!state.autoProduction) state.autoProduction = { allied: false, enemy: false };
  if (!state.autoProdCooldown) state.autoProdCooldown = { allied: 0, enemy: 0 };
  if (!state.autoProdCounter) state.autoProdCounter = { allied: 0, enemy: 0 };
  state.autoProduction[team] = Boolean(enabled);
  state.events.push({
    type: "auto_production_toggled",
    team,
    enabled: state.autoProduction[team],
    tick: state.tick
  });
  return state.autoProduction[team];
}

function createTeamAutoProdState() {
  return {
    lastUnitId: null,
    columnCount: 0,
    pauseTicks: 0,
    cooldownTicks: 0,
    patternIndex: 0,
    gateStallTicks: 0
  };
}

function createTeamSpecialWeaponState() {
  return {
    available: 0,
    earnedCount: 0,
    civilianEarned: false,
    accuracyEarned: false
  };
}

function ensureSpecialWeapons(state, team) {
  if (!state.specialWeapons) {
    state.specialWeapons = {
      allied: createTeamSpecialWeaponState(),
      enemy: createTeamSpecialWeaponState()
    };
  }
  if (!state.specialWeapons[team]) {
    state.specialWeapons[team] = createTeamSpecialWeaponState();
  }
  return state.specialWeapons[team];
}

export function getCivilianSpecialGoal(state, team) {
  const heliCount = Object.values(state.players || {}).filter(
    (p) => p.team === team && p.aircraftType === "heli"
  ).length;
  return heliCount > 1 ? SPECIAL_WEAPON_CIV_GOAL_MULTI_HELI : SPECIAL_WEAPON_CIV_GOAL_BASE;
}

function grantSpecialWeapon(state, team, reason, meta = {}) {
  const sw = ensureSpecialWeapons(state, team);
  if (sw.earnedCount >= 2) return false;
  if (reason === "civilians" && sw.civilianEarned) return false;
  if (reason === "accuracy" && sw.accuracyEarned) return false;

  if (reason === "civilians") sw.civilianEarned = true;
  else if (reason === "accuracy") sw.accuracyEarned = true;
  else return false;

  sw.available += 1;
  sw.earnedCount += 1;
  state.events.push({
    type: "special_weapon_unlocked",
    team,
    reason,
    available: sw.available,
    earnedCount: sw.earnedCount,
    ...meta,
    tick: state.tick
  });
  return true;
}

function checkCivilianSpecialUnlock(state, team) {
  const rescued = ensureTeamStats(state, team).civiliansRescued || 0;
  const goal = getCivilianSpecialGoal(state, team);
  if (rescued >= goal) {
    return grantSpecialWeapon(state, team, "civilians", { rescued, goal });
  }
  return false;
}

function resetPlayerRaidAccuracy(player) {
  const cfg = AIRCRAFT_CONFIG[player.aircraftType] || AIRCRAFT_CONFIG.heli;
  player.raidId = (player.raidId || 0) + 1;
  player.raidShotsFired = 0;
  player.raidHits = 0;
  player.raidRequiredShots = cfg.maxSecondary;
  player.raidFailed = false;
}

function recordSecondaryGroundUnitHit(state, pr) {
  if (!pr.isPlayerSecondary || pr.scoredGroundUnitHit) return;
  pr.scoredGroundUnitHit = true;
  const owner = state.players[pr.ownerId];
  if (!owner || owner.raidId !== pr.raidId || owner.raidFailed) return;
  owner.raidHits = (owner.raidHits || 0) + 1;
  if (owner.raidHits >= (owner.raidRequiredShots || AIRCRAFT_CONFIG[owner.aircraftType]?.maxSecondary || 8)) {
    grantSpecialWeapon(state, owner.team, "accuracy", {
      playerId: owner.id,
      hits: owner.raidHits,
      required: owner.raidRequiredShots
    });
  }
}

export function createInitialState(opts = {}) {
  const bunkers = BUNKER_X_POSITIONS.map((x, idx) => ({
    id: `bunker_${idx}`,
    x,
    y: GROUND_Y,
    owner: "neutral", // 'neutral' | 'allied' | 'enemy'
    hp: DEFENSE_CONFIG.bunker.maxHp,
    maxHp: DEFENSE_CONFIG.bunker.maxHp,
    captureProgress: 0,
    fireCooldown: 0
  }));

  // Phase 1 sandbox ground practice targets (so shooting, bombing & paratrooper capture feel alive right away)
  const targets = opts.includePracticeTargets === false ? [] : [
    { id: "tgt_mbt_1", kind: "main_battle_tank", team: "enemy", x: 1100, y: 0, vx: -28, minX: 700, maxX: 2500, hp: 650, maxHp: 650, dir: -1, respawnTimer: 0 },
    { id: "tgt_sph_1", kind: "self_propelled_howitzer", team: "enemy", x: 2400, y: 0, vx: -18, minX: 1600, maxX: 3300, hp: 1000, maxHp: 1000, dir: -1, respawnTimer: 0 },
    { id: "tgt_aa_1", kind: "aa_flak_truck", team: "enemy", x: -950, y: 0, vx: 32, minX: -2200, maxX: -450, hp: 140, maxHp: 140, dir: 1, respawnTimer: 0 }
  ];

  const matchMode = MATCH_MODES[opts.matchMode] ? opts.matchMode : "1v1";
  const botsEnabled = Boolean(opts.botsEnabled);
  const phase = opts.phase === "lobby" ? "lobby" : "playing";
  let autoProduction;
  if (opts.autoProduction && typeof opts.autoProduction === "object") {
    autoProduction = {
      allied: Boolean(opts.autoProduction.allied),
      enemy: Boolean(opts.autoProduction.enemy)
    };
  } else {
    const def = Boolean(opts.autoProduction);
    autoProduction = { allied: def, enemy: def };
  }

  const state = {
    tick: 0,
    time: 0,
    phase,
    roomId: opts.roomId || "ALPHA",
    winner: null,
    matchMode,
    botsEnabled,
    autoProduction,
    autoProdCooldown: { allied: 0, enemy: 0 },
    autoProdCounter: { allied: 0, enemy: 0 },
    autoProdState: {
      allied: createTeamAutoProdState(),
      enemy: createTeamAutoProdState()
    },
    specialWeapons: {
      allied: createTeamSpecialWeaponState(),
      enemy: createTeamSpecialWeaponState()
    },
    botThinkCooldown: { allied: 0, enemy: 0 },
    stats: {
      allied: { unitsBought: 0, civiliansRescued: 0, bunkersCaptured: 0, fundsEarned: 500 },
      enemy: { unitsBought: 0, civiliansRescued: 0, bunkersCaptured: 0, fundsEarned: 500 }
    },
    includeCivilians: opts.includeCivilians !== false,
    teamFunds: {
      allied: 500,
      enemy: 500
    },
    hqs: {
      allied: { team: "allied", x: BASES.allied.hqX, hp: BASES.allied.maxHp, maxHp: BASES.allied.maxHp },
      enemy: { team: "enemy", x: BASES.enemy.hqX, hp: BASES.enemy.maxHp, maxHp: BASES.enemy.maxHp }
    },
    baseAa: {
      allied: { flakCooldown: 0, samCooldown: 0 },
      enemy: { flakCooldown: 0, samCooldown: 0 }
    },
    players: {},
    bunkers,
    units: [],
    civilians: [],
    b52s: [],
    v2s: [],
    projectiles: [],
    paratroopers: [],
    flares: [],
    targets,
    events: [],
    nextEntityId: 1
  };

  if (state.includeCivilians) {
    for (const vx of VILLAGE_X_POSITIONS) {
      spawnCivilian(state, vx, vx);
    }
  }

  if (state.botsEnabled) {
    syncBotPlayers(state);
  }

  return state;
}

export function createPlayer(id, team = "allied", aircraftType = "heli", opts = {}) {
  const base = BASES[team];
  const cfg = AIRCRAFT_CONFIG[aircraftType];
  const dir = team === "allied" ? 1 : -1;
  return {
    id,
    team,
    aircraftType,
    isBot: Boolean(opts.isBot),
    callsign: opts.callsign || id.toUpperCase(),
    ready: Boolean(opts.ready),
    x: base.padCenterX,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    stallVy: 0,
    dir,
    pitch: 0,
    hp: cfg.maxHp,
    maxHp: cfg.maxHp,
    secondaryAmmo: cfg.maxSecondary,
    maxSecondary: cfg.maxSecondary,
    raidId: 1,
    raidShotsFired: 0,
    raidHits: 0,
    raidRequiredShots: cfg.maxSecondary,
    raidFailed: false,
    // Start Helicopter with 4 paratroopers loaded so E-drop is immediately testable
    passengers: aircraftType === "heli" ? ["infantry", "infantry", "infantry", "infantry"] : [],
    cabinCapacity: cfg.cabinCapacity,
    landedAtBase: true,
    alive: true,
    crashing: false,
    crashSlideTicks: 0,
    respawnTicks: 0,

    // Primary Burst-Fire Reservoir state (60 Hz ticks)
    burstReservoir: BURST_MAX_TICKS,
    primaryCooldown: 0,
    primaryIdleTicks: 0,
    secondaryCooldown: 0,
    resupplyTicks: 0,

    // Animation & turnaround state
    turnTimer: 0,
    turnDuration: cfg.turnDuration,
    turnStartDir: dir,
    turnStartSpeed: 0,
    airborneTime: 0,
    wavePhase: 0,
    rotorPhase: 0,
    throttleOffTime: 0,
    stallTime: 0,
    effectivePitch: 0,
    flightStage: 1,
    prevHInput: 0,
    oppHoldTime: 0,

    // Phase 2 tactical alerts & V2 control
    samWarningTicks: 0,
    aaWarningTicks: 0,
    controllingV2Id: null
  };
}

function ensureTeamStats(state, team) {
  if (!state.stats) {
    state.stats = {
      allied: { unitsBought: 0, civiliansRescued: 0, bunkersCaptured: 0, fundsEarned: 500 },
      enemy: { unitsBought: 0, civiliansRescued: 0, bunkersCaptured: 0, fundsEarned: 500 }
    };
  }
  if (!state.stats[team]) {
    state.stats[team] = { unitsBought: 0, civiliansRescued: 0, bunkersCaptured: 0, fundsEarned: 500 };
  }
  return state.stats[team];
}

export function syncBotPlayers(state) {
  const modeCfg = MATCH_MODES[state.matchMode] || MATCH_MODES["1v1"];
  const teamSize = modeCfg.teamSize;

  if (!state.botsEnabled) {
    for (const [id, p] of Object.entries(state.players)) {
      if (p.isBot) delete state.players[id];
    }
    return;
  }

  for (const team of ["allied", "enemy"]) {
    const humanCount = Object.values(state.players).filter((p) => !p.isBot && p.team === team).length;
    const desiredBots = Math.max(0, teamSize - humanCount);
    const existingBots = Object.values(state.players).filter((p) => p.isBot && p.team === team);

    while (existingBots.length > desiredBots) {
      const rem = existingBots.pop();
      delete state.players[rem.id];
    }

    let idx = 1;
    while (existingBots.length < desiredBots) {
      const botId = `bot_${team}_${idx}`;
      if (!state.players[botId]) {
        const aircraftType = humanCount === 0
          ? (idx % 2 === 1 ? "heli" : "p47")
          : (idx % 2 === 1 ? "p47" : "heli");
        const callsign = `${team === "allied" ? "ALLY" : "ENEMY"}-${idx}`;
        const bot = createPlayer(botId, team, aircraftType, { isBot: true, callsign });
        state.players[botId] = bot;
        existingBots.push(bot);
      }
      idx += 1;
    }
  }
}

export function configureMatch(state, opts = {}) {
  if (opts.matchMode && MATCH_MODES[opts.matchMode]) {
    state.matchMode = opts.matchMode;
  }
  if (typeof opts.botsEnabled === "boolean") {
    state.botsEnabled = opts.botsEnabled;
  }
  if (opts.autoProduction && typeof opts.autoProduction === "object") {
    if (!state.autoProduction) state.autoProduction = { allied: false, enemy: false };
    if (typeof opts.autoProduction.allied === "boolean") state.autoProduction.allied = opts.autoProduction.allied;
    if (typeof opts.autoProduction.enemy === "boolean") state.autoProduction.enemy = opts.autoProduction.enemy;
  }
  syncBotPlayers(state);
  state.events.push({
    type: "match_configured",
    matchMode: state.matchMode,
    botsEnabled: state.botsEnabled,
    tick: state.tick
  });
  return { matchMode: state.matchMode, botsEnabled: state.botsEnabled };
}

export function resetMatch(state, opts = {}) {
  state.tick = 0;
  state.time = 0;
  state.winner = null;
  if (opts.matchMode && MATCH_MODES[opts.matchMode]) {
    state.matchMode = opts.matchMode;
  }
  if (typeof opts.botsEnabled === "boolean") {
    state.botsEnabled = opts.botsEnabled;
  }
  if (opts.autoProduction && typeof opts.autoProduction === "object") {
    state.autoProduction = {
      allied: Boolean(opts.autoProduction.allied),
      enemy: Boolean(opts.autoProduction.enemy)
    };
  } else if (typeof opts.autoProduction === "boolean") {
    state.autoProduction = { allied: opts.autoProduction, enemy: opts.autoProduction };
  } else if (!state.autoProduction) {
    state.autoProduction = { allied: false, enemy: false };
  }
  state.autoProdCooldown = { allied: 0, enemy: 0 };
  state.autoProdCounter = { allied: 0, enemy: 0 };
  state.autoProdState = {
    allied: createTeamAutoProdState(),
    enemy: createTeamAutoProdState()
  };
  state.specialWeapons = {
    allied: createTeamSpecialWeaponState(),
    enemy: createTeamSpecialWeaponState()
  };
  state.botThinkCooldown = { allied: 0, enemy: 0 };
  state.stats = {
    allied: { unitsBought: 0, civiliansRescued: 0, bunkersCaptured: 0, fundsEarned: 500 },
    enemy: { unitsBought: 0, civiliansRescued: 0, bunkersCaptured: 0, fundsEarned: 500 }
  };
  state.teamFunds = { allied: 500, enemy: 500 };
  state.hqs = {
    allied: { team: "allied", x: BASES.allied.hqX, hp: BASES.allied.maxHp, maxHp: BASES.allied.maxHp },
    enemy: { team: "enemy", x: BASES.enemy.hqX, hp: BASES.enemy.maxHp, maxHp: BASES.enemy.maxHp }
  };
  state.baseAa = {
    allied: { flakCooldown: 0, samCooldown: 0 },
    enemy: { flakCooldown: 0, samCooldown: 0 }
  };
  state.bunkers = BUNKER_X_POSITIONS.map((x, idx) => ({
    id: `bunker_${idx}`,
    x,
    y: GROUND_Y,
    owner: "neutral",
    hp: DEFENSE_CONFIG.bunker.maxHp,
    maxHp: DEFENSE_CONFIG.bunker.maxHp,
    captureProgress: 0,
    fireCooldown: 0
  }));
  state.units = [];
  state.civilians = [];
  state.b52s = [];
  state.v2s = [];
  state.projectiles = [];
  state.paratroopers = [];
  state.flares = [];
  state.events = [];

  const includeCivilians = opts.includeCivilians !== undefined ? opts.includeCivilians : state.includeCivilians;
  state.includeCivilians = includeCivilians !== false;
  if (state.includeCivilians) {
    for (const vx of VILLAGE_X_POSITIONS) {
      spawnCivilian(state, vx, vx);
    }
  }

  for (const [id, existing] of Object.entries(state.players)) {
    if (existing.isBot) {
      delete state.players[id];
    } else {
      state.players[id] = createPlayer(id, existing.team, existing.aircraftType, {
        isBot: false,
        callsign: existing.callsign
      });
    }
  }
  syncBotPlayers(state);
  state.events.push({ type: "match_reset", tick: state.tick });
  return state;
}

export function setPlayerLobbyChoice(state, playerId, choice = {}) {
  const existing = state.players[playerId];
  if (!existing || existing.isBot) return null;

  const nextTeam = (choice.team === "allied" || choice.team === "enemy") ? choice.team : existing.team;
  const nextAircraft = AIRCRAFT_CONFIG[choice.aircraftType] ? choice.aircraftType : existing.aircraftType;
  const nextCallsign = typeof choice.callsign === "string" && choice.callsign.trim()
    ? choice.callsign.trim().slice(0, 12).toUpperCase()
    : existing.callsign;
  const nextReady = typeof choice.ready === "boolean" ? choice.ready : existing.ready;

  state.players[playerId] = createPlayer(playerId, nextTeam, nextAircraft, {
    isBot: false,
    callsign: nextCallsign,
    ready: nextReady
  });
  syncBotPlayers(state);
  state.events.push({
    type: "lobby_updated",
    playerId,
    team: nextTeam,
    aircraftType: nextAircraft,
    callsign: nextCallsign,
    ready: nextReady,
    tick: state.tick
  });
  return state.players[playerId];
}

export function startMatch(state, opts = {}) {
  resetMatch(state, opts);
  state.phase = "playing";
  state.events.push({
    type: "match_started",
    matchMode: state.matchMode,
    botsEnabled: state.botsEnabled,
    tick: state.tick
  });
  return state;
}

export function returnToLobby(state) {
  resetMatch(state);
  state.phase = "lobby";
  for (const p of Object.values(state.players)) {
    if (!p.isBot) p.ready = false;
  }
  state.events.push({ type: "returned_to_lobby", tick: state.tick });
  return state;
}

export function addPlayer(state, id, team = "allied", aircraftType = "heli", opts = {}) {
  const p = createPlayer(id, team, aircraftType, opts);
  state.players[id] = p;
  return p;
}

export function removePlayer(state, id) {
  delete state.players[id];
}

export function isOnFriendlyPad(player) {
  const base = BASES[player.team];
  return player.x >= base.padMinX && player.x <= base.padMaxX && player.y <= 3;
}

export function updateP47Config(patch = {}) {
  if (!patch || typeof patch !== "object") {
    return { ...AIRCRAFT_CONFIG.p47 };
  }
  if (patch.reset) {
    Object.assign(AIRCRAFT_CONFIG.p47, DEFAULT_P47_CONFIG);
    return { ...AIRCRAFT_CONFIG.p47 };
  }
  for (const [key, rawVal] of Object.entries(patch)) {
    if (!(key in DEFAULT_P47_CONFIG)) continue;
    if (typeof DEFAULT_P47_CONFIG[key] === "number") {
      const num = Number(rawVal);
      if (Number.isFinite(num)) {
        AIRCRAFT_CONFIG.p47[key] = num;
      }
    }
  }
  return { ...AIRCRAFT_CONFIG.p47 };
}

export function updateHeliConfig(patch = {}) {
  if (!patch || typeof patch !== "object") {
    return { ...AIRCRAFT_CONFIG.heli };
  }
  if (patch.reset) {
    Object.assign(AIRCRAFT_CONFIG.heli, DEFAULT_HELI_CONFIG);
  }
  for (const [key, rawVal] of Object.entries(patch)) {
    if (!(key in DEFAULT_HELI_CONFIG)) continue;
    if (typeof DEFAULT_HELI_CONFIG[key] === "number") {
      const num = Number(rawVal);
      if (Number.isFinite(num)) {
        AIRCRAFT_CONFIG.heli[key] = num;
      }
    }
  }
  if ("missileDamage" in patch && !("secondaryDamage" in patch)) {
    AIRCRAFT_CONFIG.heli.secondaryDamage = AIRCRAFT_CONFIG.heli.missileDamage;
  } else if ("secondaryDamage" in patch && !("missileDamage" in patch)) {
    AIRCRAFT_CONFIG.heli.missileDamage = AIRCRAFT_CONFIG.heli.secondaryDamage;
  }
  return { ...AIRCRAFT_CONFIG.heli };
}

function cloneUnitConfig(cfg) {
  return {
    ...cfg,
    ...(cfg.samSpeeds ? { samSpeeds: { ...cfg.samSpeeds } } : {})
  };
}

export function getGroundConfigSnapshot() {
  const units = {};
  for (const [id, cfg] of Object.entries(UNIT_CONFIG)) {
    units[id] = cloneUnitConfig(cfg);
  }
  return {
    units,
    behavior: { ...GROUND_BEHAVIOR_CONFIG },
    bunker: { ...DEFENSE_CONFIG.bunker }
  };
}

function applyCheckedGroundPatch(target, defaults, patch) {
  if (!patch || typeof patch !== "object") return;
  for (const [key, rawVal] of Object.entries(patch)) {
    if (!(key in defaults)) continue;
    const defVal = defaults[key];
    if (typeof defVal === "number") {
      const num = Number(rawVal);
      if (Number.isFinite(num)) target[key] = num;
    } else if (typeof defVal === "boolean") {
      if (typeof rawVal === "boolean") target[key] = rawVal;
      else if (rawVal === "true" || rawVal === "false") target[key] = rawVal === "true";
    } else if (key === "samSpeeds" && rawVal && typeof rawVal === "object" && target.samSpeeds && defVal) {
      for (const profile of ["slow", "medium", "fast"]) {
        if (profile in rawVal && typeof defVal[profile] === "number") {
          const num = Number(rawVal[profile]);
          if (Number.isFinite(num)) target.samSpeeds[profile] = num;
        }
      }
    }
  }
}

export function updateGroundConfig(patch = {}) {
  if (!patch || typeof patch !== "object") {
    return getGroundConfigSnapshot();
  }
  if (patch.reset) {
    for (const [id, defCfg] of Object.entries(DEFAULT_UNIT_CONFIG)) {
      Object.assign(UNIT_CONFIG[id], cloneUnitConfig(defCfg));
    }
    Object.assign(GROUND_BEHAVIOR_CONFIG, DEFAULT_GROUND_BEHAVIOR_CONFIG);
    Object.assign(DEFENSE_CONFIG.bunker, DEFAULT_BUNKER_CONFIG);
    return getGroundConfigSnapshot();
  }
  if (patch.resetUnit && DEFAULT_UNIT_CONFIG[patch.resetUnit] && UNIT_CONFIG[patch.resetUnit]) {
    Object.assign(UNIT_CONFIG[patch.resetUnit], cloneUnitConfig(DEFAULT_UNIT_CONFIG[patch.resetUnit]));
  }
  if (patch.resetBehavior) {
    Object.assign(GROUND_BEHAVIOR_CONFIG, DEFAULT_GROUND_BEHAVIOR_CONFIG);
  }
  if (patch.resetBunker) {
    Object.assign(DEFENSE_CONFIG.bunker, DEFAULT_BUNKER_CONFIG);
  }
  if (patch.units && typeof patch.units === "object") {
    for (const [unitId, unitPatch] of Object.entries(patch.units)) {
      if (!DEFAULT_UNIT_CONFIG[unitId] || !UNIT_CONFIG[unitId]) continue;
      const target = UNIT_CONFIG[unitId];
      const def = DEFAULT_UNIT_CONFIG[unitId];
      applyCheckedGroundPatch(target, def, unitPatch);
      if (unitPatch && typeof unitPatch === "object") {
        if ("maxHp" in unitPatch && !("hp" in unitPatch)) {
          target.hp = target.maxHp;
        } else if ("hp" in unitPatch && !("maxHp" in unitPatch)) {
          target.maxHp = target.hp;
        }
        if (unitId === "aa_truck") {
          if ("visualRange" in unitPatch && !("samRange" in unitPatch)) {
            target.samRange = target.visualRange;
          } else if ("samRange" in unitPatch && !("visualRange" in unitPatch)) {
            target.visualRange = target.samRange;
          }
        }
      }
    }
  }
  if (patch.behavior) {
    applyCheckedGroundPatch(GROUND_BEHAVIOR_CONFIG, DEFAULT_GROUND_BEHAVIOR_CONFIG, patch.behavior);
  }
  if (patch.bunker) {
    applyCheckedGroundPatch(DEFENSE_CONFIG.bunker, DEFAULT_BUNKER_CONFIG, patch.bunker);
  }
  return getGroundConfigSnapshot();
}

export function spawnPlayerP47Test(state, playerId, mode = "air") {
  const player = state.players[playerId];
  if (!player) return false;
  const base = BASES[player.team];
  const cfg = AIRCRAFT_CONFIG.p47;
  const dir = player.team === "allied" ? 1 : -1;

  player.aircraftType = "p47";
  player.maxHp = cfg.maxHp;
  player.hp = cfg.maxHp;
  player.secondaryAmmo = cfg.maxSecondary;
  player.maxSecondary = cfg.maxSecondary;
  resetPlayerRaidAccuracy(player);
  player.cabinCapacity = cfg.cabinCapacity;
  player.passengers = [];
  player.alive = true;
  player.crashing = false;
  player.crashSlideTicks = 0;
  player.respawnTicks = 0;
  player.turnTimer = 0;
  player.turnDuration = cfg.turnDuration;
  player.dir = dir;
  player.turnStartDir = dir;
  player.burstReservoir = BURST_MAX_TICKS;
  player.primaryCooldown = 0;
  player.primaryIdleTicks = 0;
  player.secondaryCooldown = 0;
  player.resupplyTicks = 0;
  player.throttleOffTime = 0;
  player.stallTime = 0;
  player.stallVy = 0;
  player.pitch = 0;
  player.effectivePitch = 0;
  player.airborneTime = 0;
  player.wavePhase = 0;
  player.flightStage = 1;
  player.prevHInput = 0;
  player.oppHoldTime = 0;
  player.samWarningTicks = 0;
  player.aaWarningTicks = 0;
  player.controllingV2Id = null;

  if (mode === "runway") {
    player.x = base.padCenterX;
    player.y = 0;
    player.speed = 0;
    player.vx = 0;
    player.vy = 0;
    player.landedAtBase = true;
  } else if (mode === "stall") {
    player.x = player.team === "allied" ? -1400 : 1400;
    player.y = 500;
    player.speed = cfg.maxSpeed;
    player.vx = dir * player.speed;
    player.vy = 0;
    player.landedAtBase = false;
  } else if (mode === "brake") {
    player.x = player.team === "allied" ? -1000 : 1000;
    player.y = 360;
    player.speed = cfg.cruiseSpeed;
    player.vx = dir * player.speed;
    player.vy = 0;
    player.landedAtBase = false;
  } else if (mode === "bounce") {
    player.x = player.team === "allied" ? -400 : 400;
    player.y = 18;
    player.speed = Math.max(cfg.minGlideSpeed + 60, 280);
    player.pitch = -0.34;
    player.effectivePitch = -0.34;
    player.vx = dir * player.speed * Math.cos(player.pitch);
    player.vy = player.speed * Math.sin(player.pitch);
    player.hp = cfg.maxHp;
    player.landedAtBase = false;
  } else if (mode === "crash") {
    player.x = player.team === "allied" ? -350 : 350;
    player.y = 48;
    player.speed = cfg.maxSpeed * 0.92;
    player.pitch = -0.52;
    player.effectivePitch = -0.52;
    player.vx = dir * player.speed * Math.cos(player.pitch);
    player.vy = player.speed * Math.sin(player.pitch);
    player.hp = 45;
    player.landedAtBase = false;

    const enemyTeam = player.team === "allied" ? "enemy" : "allied";
    const tankX = player.team === "allied" ? -110 : 110;
    const troopX = player.team === "allied" ? -35 : 35;
    if (!state.targets.some((t) => t.hp > 0 && Math.abs(t.x - tankX) < 120)) {
      state.targets.push({
        id: `crash_tank_${state.nextEntityId++}`,
        kind: "main_battle_tank",
        team: enemyTeam,
        x: tankX,
        y: 0,
        vx: 0,
        minX: tankX - 40,
        maxX: tankX + 40,
        hp: 650,
        maxHp: 650,
        dir: -dir,
        respawnTimer: 0
      });
    }
    if (!state.paratroopers.some((p) => p.y <= 10 && Math.abs(p.x - troopX) < 100)) {
      state.paratroopers.push({
        id: `crash_troop_${state.nextEntityId++}`,
        team: enemyTeam,
        kind: "infantry",
        x: troopX,
        y: 0,
        vx: 0,
        vy: 0,
        dir: -dir,
        phase: "march",
        collapseTimer: 0,
        walkPhase: 0,
        hp: 40
      });
    }
  } else {
    player.x = player.team === "allied" ? -1200 : 1200;
    player.y = 440;
    player.speed = cfg.maxSpeed;
    player.vx = dir * cfg.maxSpeed;
    player.vy = 0;
    player.landedAtBase = false;
  }

  state.events.push({ type: "p47_test_spawned", playerId, mode, tick: state.tick });
  return true;
}

export function spawnPlayerHeliTest(state, playerId, mode = "hover") {
  const player = state.players[playerId];
  if (!player) return false;
  const base = BASES[player.team];
  const cfg = AIRCRAFT_CONFIG.heli;
  const dir = player.team === "allied" ? 1 : -1;
  const enemyTeam = player.team === "allied" ? "enemy" : "allied";
  const cabinCap = Math.max(0, Math.floor(cfg.cabinCapacity));

  player.aircraftType = "heli";
  player.maxHp = cfg.maxHp;
  player.hp = cfg.maxHp;
  player.secondaryAmmo = cfg.maxSecondary;
  player.maxSecondary = cfg.maxSecondary;
  resetPlayerRaidAccuracy(player);
  player.cabinCapacity = cfg.cabinCapacity;
  player.passengers = [];
  player.alive = true;
  player.crashing = false;
  player.crashSlideTicks = 0;
  player.respawnTicks = 0;
  player.turnTimer = 0;
  player.turnDuration = Math.max(0.05, cfg.turnDuration);
  player.dir = dir;
  player.turnStartDir = dir;
  player.turnStartSpeed = 0;
  player.burstReservoir = BURST_MAX_TICKS;
  player.primaryCooldown = 0;
  player.primaryIdleTicks = 0;
  player.secondaryCooldown = 0;
  player.resupplyTicks = 0;
  player.throttleOffTime = 0;
  player.stallTime = 0;
  player.stallVy = 0;
  player.pitch = 0;
  player.effectivePitch = 0;
  player.airborneTime = 0;
  player.wavePhase = 0;
  player.flightStage = 1;
  player.prevHInput = 0;
  player.oppHoldTime = 0;
  player.samWarningTicks = 0;
  player.aaWarningTicks = 0;
  player.controllingV2Id = null;

  if (mode === "turn") {
    player.x = dir * -1000;
    player.y = 260;
    player.vx = dir * cfg.maxSpeedX;
    player.vy = 0;
    player.pitch = -(cfg.maxTiltPitch ?? 0.24);
    player.effectivePitch = player.pitch;
    player.landedAtBase = false;
    player.passengers = Array(Math.min(4, cabinCap)).fill("infantry");
  } else if (mode === "weapons") {
    player.x = dir * -700;
    player.y = 150;
    player.vx = 0;
    player.vy = 0;
    player.landedAtBase = false;
    player.passengers = [];
    const targets = [
      ["infantry", player.x + dir * 280],
      ["aa_truck", player.x + dir * 440],
      ["mbt", player.x + dir * 580],
      ["howitzer", player.x + dir * 880]
    ];
    for (const [kind, tx] of targets) {
      const u = spawnGroundUnit(state, enemyTeam, kind, tx);
      if (u) {
        u.holdPosition = true;
        u.passiveDummy = true;
      }
    }
    const centerBunker = state.bunkers.find((b) => b.id === "bunker_2") || state.bunkers[2];
    if (centerBunker) {
      centerBunker.owner = enemyTeam;
      centerBunker.hp = DEFENSE_CONFIG.bunker.maxHp;
      centerBunker.maxHp = DEFENSE_CONFIG.bunker.maxHp;
      centerBunker.passiveDummy = true;
    }
  } else if (mode === "paratroop") {
    player.x = dir * -320;
    player.y = 175;
    player.vx = 0;
    player.vy = 0;
    player.landedAtBase = false;
    player.passengers = Array(Math.min(4, cabinCap)).fill("infantry");
    const centerBunker = state.bunkers.find((b) => b.id === "bunker_2") || state.bunkers[2];
    if (centerBunker) {
      centerBunker.owner = "neutral";
      centerBunker.hp = DEFENSE_CONFIG.bunker.maxHp;
      centerBunker.maxHp = DEFENSE_CONFIG.bunker.maxHp;
      centerBunker.passiveDummy = false;
    }
    for (const offset of [240, 200, 160]) {
      spawnGroundUnit(state, player.team, "infantry", player.x - dir * offset);
    }
  } else if (mode === "rescue") {
    player.x = dir * -4620;
    player.y = 115;
    player.vx = 0;
    player.vy = 0;
    player.landedAtBase = false;
    player.passengers = [];
    for (const offset of [80, 150, 220, 290]) {
      const cx = player.x + dir * offset;
      spawnCivilian(state, cx, cx);
    }
  } else if (mode === "hard_landing") {
    player.x = dir * -400;
    player.y = 210;
    player.vx = dir * 40;
    player.vy = -90;
    player.landedAtBase = false;
    player.passengers = [];
  } else if (mode === "helipad") {
    player.x = base.padCenterX;
    player.y = 0;
    player.vx = 0;
    player.vy = 0;
    player.landedAtBase = true;
    player.hp = Math.round(cfg.maxHp * 0.55);
    player.secondaryAmmo = Math.floor(cfg.maxSecondary * 0.5);
    player.passengers = Array(Math.min(2, cabinCap)).fill("infantry");
  } else {
    // "hover" default
    player.x = dir * -800;
    player.y = 260;
    player.vx = 0;
    player.vy = 0;
    player.landedAtBase = false;
    player.passengers = Array(Math.min(4, cabinCap)).fill("infantry");
  }

  player.speed = Math.hypot(player.vx, player.vy);
  state.events.push({ type: "heli_test_spawned", playerId, mode, tick: state.tick });
  return true;
}

export function swapPlayerAircraft(state, playerId, nextType = null) {
  const player = state.players[playerId];
  if (!player || !player.alive || player.crashing || !player.landedAtBase) return false;

  const targetType = nextType || (player.aircraftType === "heli" ? "p47" : "heli");
  if (!AIRCRAFT_CONFIG[targetType] || targetType === player.aircraftType) return false;

  const cfg = AIRCRAFT_CONFIG[targetType];
  player.aircraftType = targetType;
  player.hp = cfg.maxHp;
  player.maxHp = cfg.maxHp;
  player.secondaryAmmo = cfg.maxSecondary;
  player.maxSecondary = cfg.maxSecondary;
  resetPlayerRaidAccuracy(player);
  player.cabinCapacity = cfg.cabinCapacity;
  player.passengers = targetType === "heli" ? ["infantry", "infantry", "infantry", "infantry"] : [];
  player.vx = 0;
  player.vy = 0;
  player.speed = 0;
  player.stallVy = 0;
  player.pitch = 0;
  player.effectivePitch = 0;
  player.throttleOffTime = 0;
  player.stallTime = 0;
  player.wavePhase = 0;
  player.flightStage = 1;
  player.prevHInput = 0;
  player.oppHoldTime = 0;
  player.crashing = false;
  player.crashSlideTicks = 0;
  player.turnTimer = 0;
  player.turnDuration = cfg.turnDuration;
  player.dir = player.team === "allied" ? 1 : -1;
  player.burstReservoir = BURST_MAX_TICKS;
  player.primaryCooldown = 0;
  player.primaryIdleTicks = 0;
  player.secondaryCooldown = 0;
  player.samWarningTicks = 0;
  player.aaWarningTicks = 0;
  player.controllingV2Id = null;
  checkCivilianSpecialUnlock(state, player.team);
  state.events.push({ type: "aircraft_swapped", playerId, aircraftType: targetType, tick: state.tick });
  return true;
}

export function spawnGroundUnit(state, team, unitKeyOrId, customX = null, opts = {}) {
  const cfg = resolveUnitConfig(unitKeyOrId);
  if (!cfg) return null;
  const base = BASES[team];
  const dir = team === "allied" ? 1 : -1;
  // Ground units (including ambulances) deploy strictly from their team's Main Base HQ
  const hqX = state.hqs?.[team]?.x ?? base.hqX;
  const x = customX !== null && customX !== undefined ? customX : hqX + dir * 120;
  const unit = {
    id: `unit_${state.nextEntityId++}`,
    kind: cfg.kind,
    unitId: cfg.id,
    team,
    x,
    y: GROUND_Y,
    vx: 0,
    dir,
    hp: cfg.hp,
    maxHp: cfg.maxHp,
    speed: cfg.speed,
    fireCooldown: 0,
    samCooldown: 0,
    samTrack: null,
    walkPhase: 0,
    pickupGraceTicks: 0,
    passengers: [],
    cabinCapacity: cfg.cabinCapacity || 0,
    returningToBase: false,
    repairedThisTick: false,
    autoPurchased: Boolean(opts.autoPurchased),
    lastDamagedByTeam: null,
    penaltyApplied: false
  };
  state.units.push(unit);
  return unit;
}

export function launchSpecialWeapon(state, playerId, weaponType, opts = {}) {
  const player = state.players[playerId];
  if (!player || state.winner) return false;
  const sw = ensureSpecialWeapons(state, player.team);
  if (sw.available <= 0) return false;

  const norm = String(weaponType || "").toLowerCase();
  if (norm === "b52" || norm === "b52_raid" || norm === "z") {
    const cfg = STRATEGIC_CONFIG.b52_raid;
    sw.available -= 1;
    const dir = player.team === "allied" ? 1 : -1;
    const defaultTargetX = player.team === "allied" ? 1800 : -1800;
    const targetX = clamp(Number.isFinite(opts.targetX) ? opts.targetX : defaultTargetX, MIN_X + 800, MAX_X - 800);
    const b52 = {
      id: `b52_${state.nextEntityId++}`,
      team: player.team,
      ownerId: player.id,
      x: dir === 1 ? MIN_X - 200 : MAX_X + 200,
      y: cfg.altitude,
      vx: dir * cfg.speed,
      dir,
      hp: cfg.hp,
      maxHp: cfg.maxHp,
      targetX,
      stripWidth: cfg.stripWidth,
      bombsTotal: cfg.bombCount,
      bombsDropped: 0,
      alive: true
    };
    state.b52s.push(b52);
    ensureTeamStats(state, player.team).unitsBought += 1;
    state.events.push({ type: "b52_raid_called", playerId, team: player.team, b52Id: b52.id, targetX, tick: state.tick });
    return b52;
  }

  if (norm === "v2" || norm === "v2_missile" || norm === "x") {
    const cfg = STRATEGIC_CONFIG.v2_missile;
    if (state.v2s.some((v) => v.ownerId === player.id && v.alive)) return false;
    sw.available -= 1;
    const base = BASES[player.team];
    const dir = player.team === "allied" ? 1 : -1;
    const initPitch = 1.05;
    const v2 = {
      id: `v2_${state.nextEntityId++}`,
      team: player.team,
      ownerId: player.id,
      x: base.siloX,
      y: 36,
      dir,
      pitch: initPitch,
      speed: cfg.speed,
      vx: dir * cfg.speed * Math.cos(initPitch),
      vy: cfg.speed * Math.sin(initPitch),
      hp: cfg.hp,
      maxHp: cfg.maxHp,
      fuelTicks: cfg.maxFuelTicks,
      launchGraceTicks: 18,
      alive: true
    };
    state.v2s.push(v2);
    player.controllingV2Id = v2.id;
    ensureTeamStats(state, player.team).unitsBought += 1;
    state.events.push({ type: "v2_launched", playerId, team: player.team, v2Id: v2.id, x: v2.x, tick: state.tick });
    return v2;
  }

  return false;
}

export function handlePlayerRequisition(state, playerId, key, opts = {}) {
  const player = state.players[playerId];
  if (!player || state.winner) return false;
  const normKey = String(key);

  if (normKey === "0" || normKey === "swap_aircraft") {
    return swapPlayerAircraft(state, playerId);
  }

  const cfg = resolveUnitConfig(normKey);
  if (!cfg) return false;
  if (state.teamFunds[player.team] < cfg.cost) return false;

  state.teamFunds[player.team] -= cfg.cost;
  const unit = spawnGroundUnit(state, player.team, normKey);
  ensureTeamStats(state, player.team).unitsBought += 1;
  state.events.push({
    type: "unit_requisitioned",
    playerId,
    team: player.team,
    key: normKey,
    unitKind: unit.kind,
    unitId: unit.id,
    cost: cfg.cost,
    tick: state.tick
  });
  return unit;
}

function pickupNearbyFriendlyInfantry(state, player, maxDist) {
  if (player.passengers.length >= player.cabinCapacity) return false;
  let bestKind = null;
  let bestIdx = -1;
  let bestDist = maxDist + 1;

  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (u.hp <= 0 || u.team !== player.team || u.kind !== "infantry") continue;
    if ((u.pickupGraceTicks || 0) > 0) continue;
    const dist = Math.abs(u.x - player.x);
    if (dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      bestKind = "unit";
      bestIdx = i;
    }
  }

  for (let i = 0; i < state.paratroopers.length; i++) {
    const p = state.paratroopers[i];
    if (p.team !== player.team || p.phase === "descent" || p.y > 5) continue;
    if ((p.pickupGraceTicks || 0) > 0) continue;
    const dist = Math.abs(p.x - player.x);
    if (dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      bestKind = "para";
      bestIdx = i;
    }
  }

  if (bestIdx === -1) return false;
  if (bestKind === "unit") {
    state.units.splice(bestIdx, 1);
  } else {
    state.paratroopers.splice(bestIdx, 1);
  }
  player.passengers.push("infantry");
  state.events.push({ type: "troop_loaded", playerId: player.id, count: player.passengers.length, tick: state.tick });
  return true;
}

function hasApproachingFriendlyInfantry(state, player, maxDist = 200) {
  for (const u of state.units) {
    if (u.hp <= 0 || u.team !== player.team || u.kind !== "infantry") continue;
    if ((u.pickupGraceTicks || 0) > 0) continue;
    const forwardDir = u.team === "allied" ? 1 : -1;
    const dx = player.x - u.x;
    if (Math.abs(dx) <= maxDist && dx * forwardDir > 0) return true;
  }
  for (const p of state.paratroopers) {
    if (p.team !== player.team || p.phase === "descent" || p.y > 5) continue;
    if ((p.pickupGraceTicks || 0) > 0) continue;
    const forwardDir = p.team === "allied" ? 1 : -1;
    const dx = player.x - p.x;
    if (Math.abs(dx) <= maxDist && dx * forwardDir > 0) return true;
  }
  return false;
}

function updateInfantryBoarding(state, resolvedInputs = {}) {
  const heliCfg = AIRCRAFT_CONFIG.heli;
  const maxAlt = heliCfg.pickupMaxAlt ?? 15;
  const maxSpeed = heliCfg.pickupMaxSpeed ?? 95;
  for (const player of Object.values(state.players)) {
    if (!player.alive || player.crashing || player.aircraftType !== "heli") continue;
    if (player.y > maxAlt || Math.abs(player.vx) >= maxSpeed) continue;
    if (player.passengers.length >= player.cabinCapacity) continue;

    const inp = resolvedInputs[player.id] || {};
    if (!inp.down && !inp.utility) continue;

    const reach = inp.utility ? 58 : 52;
    while (player.passengers.length < player.cabinCapacity && pickupNearbyFriendlyInfantry(state, player, reach)) {
      // Board any friendly infantry in contact while holding Down or E
    }
  }
}

export function handlePlayerUtility(state, playerId) {
  const player = state.players[playerId];
  if (!player || !player.alive || player.aircraftType !== "heli") return false;
  const heliCfg = AIRCRAFT_CONFIG.heli;
  const pickupMaxAlt = heliCfg.pickupMaxAlt ?? 15;

  // Low/Landed: pick up nearby friendly infantry, load at base garrison, or drop off infantry on ground
  if (player.y <= pickupMaxAlt) {
    if (player.passengers.length < player.cabinCapacity && pickupNearbyFriendlyInfantry(state, player, 64)) {
      return true;
    }

    if (player.y <= 3 && isOnFriendlyPad(player) && player.passengers.length < player.cabinCapacity) {
      if (!pickupNearbyFriendlyInfantry(state, player, 160)) {
        player.passengers.push("infantry");
        state.events.push({ type: "troop_loaded", playerId, count: player.passengers.length, tick: state.tick });
      }
      return true;
    }

    if (player.passengers.length < player.cabinCapacity && hasApproachingFriendlyInfantry(state, player, 200)) {
      return false;
    }

    if (player.passengers.length > 0) {
      const idx = player.passengers.lastIndexOf("infantry");
      if (idx === -1) return false;
      player.passengers.splice(idx, 1);
      const forwardDir = player.team === "allied" ? 1 : -1;
      const dropX = clamp(player.x + forwardDir * 26, MIN_X + 60, MAX_X - 60);
      const unit = spawnGroundUnit(state, player.team, "infantry", dropX);
      if (unit) unit.pickupGraceTicks = 60;
      state.events.push({ type: "troop_dropped", playerId, unitId: unit?.id, tick: state.tick });
      return true;
    }
    return false;
  }

  // Airborne: drop 1 infantry paratrooper from cabin (never drop rescued civilians!)
  if (player.y > pickupMaxAlt && player.passengers.length > 0) {
    const idx = player.passengers.lastIndexOf("infantry");
    if (idx === -1) return false;
    const [unitKind] = player.passengers.splice(idx, 1);
    const id = `para_${state.nextEntityId++}`;
    state.paratroopers.push({
      id,
      team: player.team,
      kind: unitKind,
      x: player.x,
      y: player.y - 18,
      vx: player.vx * (heliCfg.paraDropVxFactor ?? 0.25),
      vy: -Math.max(10, heliCfg.paraDescentSpeed ?? 65),
      dir: player.dir,
      phase: "descent", // 'descent' | 'collapse' | 'march'
      collapseTimer: 0,
      walkPhase: 0,
      hp: 40,
      maxHp: 40,
      fireCooldown: 0,
      pickupGraceTicks: 0
    });
    state.events.push({ type: "paratrooper_dropped", playerId, id, tick: state.tick });
    return true;
  }
  return false;
}

export function updateHeli(player, input, dt) {
  const cfg = AIRCRAFT_CONFIG.heli;
  const hInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const vInput = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const turnDur = Math.max(0.05, cfg.turnDuration);
  const turnThresh = cfg.turnSpeedThreshold ?? 35;
  const driftScale = cfg.turnDriftScale ?? 0.45;
  const horizDrag = Math.max(0, cfg.horizDragRate ?? 2.53);
  const groundDrag = Math.max(0, cfg.groundDragRate ?? 4.6);
  const maxTilt = cfg.maxTiltPitch ?? 0.24;
  const tiltResp = Math.max(0.1, cfg.tiltResponse ?? 8.0);
  const vertDamp = Math.max(0, cfg.verticalDamping ?? 3.0);
  const crashVy = Math.max(10, cfg.crashLandingVy ?? 185);
  const maxVx = Math.max(1, cfg.maxSpeedX);

  if (player.turnTimer > 0) {
    player.turnTimer += dt;
    player.turnDuration = turnDur;
    const p = Math.min(1, player.turnTimer / turnDur);
    player.vx = player.turnStartDir * Math.min(110, Math.abs(player.turnStartSpeed) + 40) * driftScale * Math.cos(Math.PI * p);
    player.pitch *= 0.85;
    if (player.turnTimer >= turnDur) {
      player.turnTimer = 0;
      player.dir = -player.turnStartDir;
    }
  } else {
    // Trigger smooth turnaround when reversing thrust past low speed while airborne (or stationary)
    if (hInput !== 0 && hInput !== player.dir && (player.y > 4 ? player.vx * player.dir <= turnThresh : true)) {
      if (player.y > 4) {
        player.turnTimer = dt;
        player.turnDuration = turnDur;
        player.turnStartDir = player.dir;
        player.turnStartSpeed = Math.abs(player.vx);
      } else {
        player.dir = hInput;
      }
    }

    if (player.y > 2 || vInput > 0) {
      if (hInput !== 0) {
        player.vx += hInput * cfg.accelX * dt;
      } else {
        player.vx *= Math.exp(-horizDrag * dt);
      }
      player.vx = clamp(player.vx, -cfg.maxSpeedX, cfg.maxSpeedX);
    } else {
      player.vx *= Math.exp(-groundDrag * dt);
      if (Math.abs(player.vx) < 2) player.vx = 0;
    }

    // Target forward/backward pitch proportional to horizontal velocity
    const targetPitch = player.y > 2 ? clamp((-player.vx * player.dir) / maxVx, -1, 1) * maxTilt : 0;
    player.pitch += (targetPitch - player.pitch) * Math.min(1, dt * tiltResp);
  }

  // Vertical collective hover physics (gentle gravity sink when no Up/Down input)
  const wasGrounded = player.y <= 0.001 && Math.abs(player.vy) < 5;
  if (vInput !== 0) {
    if (wasGrounded && vInput < 0) {
      player.vy = 0;
    } else {
      player.vy += vInput * cfg.accelY * dt;
    }
  } else if (player.y > 0) {
    player.vy += (-cfg.idleSinkSpeed - player.vy) * Math.min(1, dt * vertDamp);
  }
  player.vy = clamp(player.vy, -cfg.maxSpeedY, cfg.maxSpeedY);

  player.x = clamp(player.x + player.vx * dt, MIN_X + 60, MAX_X - 60);
  player.y += player.vy * dt;

  if (player.y <= 0) {
    // Check hard crash vs safe touchdown
    if (player.vy < -crashVy && !isOnFriendlyPad(player)) {
      player.speed = Math.hypot(player.vx, player.vy);
      player.effectivePitch = player.pitch;
      return "crash";
    }
    player.y = 0;
    if (player.vy < 0) player.vy = 0;
  } else if (player.y > CEILING_Y) {
    player.y = CEILING_Y;
    if (player.vy > 0) player.vy = 0;
  }

  player.speed = Math.hypot(player.vx, player.vy);
  player.effectivePitch = player.pitch;
  player.airborneTime = player.y > 2 ? player.airborneTime + dt : 0;
  player.rotorPhase += dt * 20;
  return "ok";
}

export function updateP47(state, player, input, dt) {
  const cfg = AIRCRAFT_CONFIG.p47;
  const hInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const vInput = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const turnDur = Math.max(0.05, cfg.turnDuration);
  const graceDur = Math.max(0.05, cfg.throttleReleaseDelay);
  const stage3Dur = Math.max(0.05, cfg.stallGlideDelay);

  // Sync scalar speed if external state/test set vx directly while airborne
  if (player.y > 1 && player.speed === 0 && Math.abs(player.vx) > 10) {
    player.speed = Math.hypot(player.vx, player.vy);
  }

  // Landed / Runway Takeoff roll (only when already resting on ground with near-zero vertical velocity)
  const isGrounded = player.y <= 0.001 && Math.abs(player.vy) < 5;
  if (isGrounded && player.turnTimer === 0 && (vInput <= 0 || player.speed < cfg.takeoffSpeed)) {
    player.y = 0;
    player.vy = 0;
    player.stallVy = 0;
    player.pitch = 0;
    player.effectivePitch = 0;
    player.airborneTime = 0;
    player.wavePhase = 0;
    player.throttleOffTime = 0;
    player.stallTime = 0;
    player.flightStage = 1;
    player.oppHoldTime = 0;
    player.prevHInput = hInput;

    if (hInput !== 0) {
      if (player.speed < 15) player.dir = hInput;
      if (hInput === player.dir) {
        player.speed = Math.min(cfg.maxSpeed, player.speed + cfg.accelRate * 1.25 * dt);
      } else {
        player.speed = Math.max(0, player.speed - cfg.accelRate * 1.6 * dt);
        if (player.speed < 15) player.dir = hInput;
      }
    } else {
      const groundFriction = isOnFriendlyPad(player) ? 140 : 280;
      player.speed = Math.max(0, player.speed - groundFriction * dt);
    }

    // Off-base ground rolling deals scrape damage proportional to momentum
    if (!isOnFriendlyPad(player) && player.speed > 12) {
      player.hp = Math.max(0, player.hp - (22 + player.speed * 0.28) * dt);
      if (player.hp <= 0) {
        player.crashing = true;
        player.crashSlideTicks = cfg.crashSlideTicks;
        player.speed = Math.max(190, player.speed);
        player.pitch = -0.16;
        player.effectivePitch = -0.16;
        state.events.push({ type: "crash_slide_start", playerId: player.id, x: player.x, tick: state.tick });
        return "ok";
      }
    }

    player.vx = player.dir * player.speed;
    player.x = clamp(player.x + player.vx * dt, MIN_X + 80, MAX_X - 80);

    // Liftoff once above takeoff speed and pulling Up
    if (vInput > 0 && player.speed >= cfg.takeoffSpeed) {
      player.y = 4;
      player.pitch = 0.22;
      player.effectivePitch = 0.22;
      player.vy = player.speed * Math.sin(player.pitch);
    }
    player.rotorPhase += dt * (player.speed > 20 ? 22 : 10);
    return "ok";
  }

  // Airborne flight!
  player.airborneTime += dt;
  player.wavePhase = (player.wavePhase || 0) + cfg.sineOmega * dt;
  player.rotorPhase += dt * 24;

  // Wide U-turn with continuous horizontal momentum: vx(p) = startDir * startSpeed * cos(pi * p)
  if (player.turnTimer > 0) {
    player.turnTimer += dt;
    player.turnDuration = turnDur;
    const p = Math.min(1, player.turnTimer / turnDur);
    const speed = Math.max(cfg.minGlideSpeed, player.turnStartSpeed);
    player.vx = player.turnStartDir * speed * Math.cos(Math.PI * p);
    // Gentle banking altitude arc through the U-turn
    player.vy = 26 * Math.PI * Math.cos(Math.PI * p) / turnDur;
    player.pitch = 0;
    player.effectivePitch = 0;
    player.x = clamp(player.x + player.vx * dt, MIN_X + 80, MAX_X - 80);
    player.y = clamp(player.y + player.vy * dt, 18, CEILING_Y);
    player.prevHInput = hInput;
    if (player.turnTimer >= turnDur) {
      player.turnTimer = 0;
      player.dir = -player.turnStartDir;
      player.speed = speed;
      player.vx = player.dir * speed;
      player.oppHoldTime = 0;
      player.throttleOffTime = 0;
      player.stallTime = 0;
      player.flightStage = 2;
    }
    return "ok";
  }

  // 1. Horizontal Speed Control:
  // - Throttling (hInput === dir): accelerate up to maxSpeed
  // - Neutral (hInput === 0): decelerate down to cruiseSpeed ONLY if currently above cruiseSpeed
  // - Opposite (hInput === -dir): tap shaves brakeTapStep, hold brakes continuously; once at minGlideSpeed, tap or hold executes U-turn
  const isNewOppPress = hInput === -player.dir && (player.prevHInput || 0) !== -player.dir;
  if (hInput === player.dir) {
    player.throttleOffTime = 0;
    player.stallTime = 0;
    player.oppHoldTime = 0;
    player.speed = Math.min(cfg.maxSpeed, player.speed + cfg.accelRate * dt);
  } else if (hInput === -player.dir) {
    player.throttleOffTime = (player.throttleOffTime || 0) + dt;
    player.oppHoldTime = isNewOppPress ? dt : (player.oppHoldTime || 0) + dt;

    if (isNewOppPress && player.speed <= cfg.minGlideSpeed + 1) {
      player.turnTimer = dt;
      player.turnDuration = turnDur;
      player.turnStartDir = player.dir;
      player.turnStartSpeed = Math.max(cfg.minGlideSpeed, player.speed);
      player.oppHoldTime = 0;
      player.prevHInput = hInput;
      return "ok";
    }

    if (isNewOppPress) {
      player.speed = Math.max(cfg.minGlideSpeed, player.speed - cfg.brakeTapStep);
    }
    player.speed = Math.max(cfg.minGlideSpeed, player.speed - cfg.brakeDecelRate * dt);

    if (player.speed <= cfg.minGlideSpeed + 0.5 && player.oppHoldTime >= (cfg.turnHoldThreshold ?? 0.14)) {
      player.turnTimer = dt;
      player.turnDuration = turnDur;
      player.turnStartDir = player.dir;
      player.turnStartSpeed = cfg.minGlideSpeed;
      player.oppHoldTime = 0;
      player.prevHInput = hInput;
      return "ok";
    }
  } else {
    player.throttleOffTime = (player.throttleOffTime || 0) + dt;
    player.oppHoldTime = 0;
    if (player.speed > cfg.cruiseSpeed) {
      player.speed = Math.max(cfg.cruiseSpeed, player.speed - cfg.dragDecelRate * dt);
    }
  }
  player.prevHInput = hInput;

  // 2. Four-Stage Vertical Lift & Tilt Progression (independent of horizontal speed):
  // Stage 1: Full lift while throttling
  // Stage 2: Grace period lift off-throttle (Up climbs cleanly while slowly losing lift)
  // Stage 3: No lift, slow descent, slight nose-down tilt (Up counteracts to slightly above level without stopping descent)
  // Stage 4: Faster descent, Down-arrow nose-down tilt (Up counteracts to level without stopping descent)
  let effectivePitch = 0;
  if (hInput === player.dir) {
    player.flightStage = 1;
    player.stallVy = 0;
    player.stallTime = 0;
    if (vInput !== 0) {
      player.pitch = clamp(player.pitch + vInput * cfg.pitchRate * dt, -cfg.maxPitch, cfg.maxPitch);
    } else if (cfg.pitchLevelRate > 0) {
      player.pitch *= Math.exp(-cfg.pitchLevelRate * dt);
    }
    const waveVelY = Math.cos(player.wavePhase) * cfg.sineAmpVel;
    const wavePitch = Math.cos(player.wavePhase) * cfg.sinePitchAmp;
    effectivePitch = clamp(player.pitch + (vInput === 0 ? wavePitch : 0), -cfg.maxPitch, cfg.maxPitch);
    player.vx = player.dir * player.speed * Math.cos(effectivePitch);
    player.vy = player.speed * Math.sin(effectivePitch) + (vInput === 0 ? waveVelY : 0);
  } else if (player.throttleOffTime <= graceDur) {
    player.flightStage = 2;
    player.stallTime = 0;
    const graceRatio = clamp(player.throttleOffTime / graceDur, 0, 1);
    const graceLift = 1 - graceRatio * 0.35;
    if (vInput !== 0) {
      player.pitch = clamp(player.pitch + vInput * cfg.pitchRate * dt, -cfg.maxPitch, cfg.maxPitch);
    } else if (cfg.pitchLevelRate > 0) {
      player.pitch *= Math.exp(-cfg.pitchLevelRate * dt);
    }
    player.stallVy = graceRatio * graceRatio * cfg.stallSinkGravity * 0.45;
    const waveVelY = Math.cos(player.wavePhase) * cfg.sineAmpVel * graceLift;
    const wavePitch = Math.cos(player.wavePhase) * cfg.sinePitchAmp * graceLift;
    effectivePitch = clamp(player.pitch + (vInput === 0 ? wavePitch : 0), -cfg.maxPitch, cfg.maxPitch);
    player.vx = player.dir * player.speed * Math.cos(effectivePitch);
    player.vy = player.speed * Math.sin(effectivePitch) + (vInput === 0 ? waveVelY : 0) - player.stallVy;
  } else if (player.throttleOffTime - graceDur <= stage3Dur) {
    player.flightStage = 3;
    player.stallTime = player.throttleOffTime - graceDur;
    if (vInput > 0) {
      player.pitch += (cfg.stage3UpPitch - player.pitch) * Math.min(1, dt * cfg.pitchRate * 2.4);
    } else if (vInput < 0) {
      player.pitch = clamp(player.pitch - cfg.pitchRate * dt, -cfg.maxPitch, cfg.maxPitch);
    } else {
      player.pitch += (cfg.glidePitch - player.pitch) * Math.min(1, dt * cfg.divePitchRate);
    }
    effectivePitch = clamp(player.pitch, -cfg.maxPitch, cfg.maxPitch);
    const extraDown = player.pitch < cfg.glidePitch ? (cfg.glidePitch - player.pitch) * player.speed * 0.6 : 0;
    player.stallVy = cfg.stallSinkGravity + extraDown;
    player.vx = player.dir * player.speed * Math.cos(effectivePitch);
    player.vy = -player.stallVy;
  } else {
    player.flightStage = 4;
    player.stallTime = player.throttleOffTime - graceDur;
    const stage4TargetDown = cfg.maxDivePitch;
    if (vInput > 0) {
      player.pitch += (cfg.stage4UpPitch - player.pitch) * Math.min(1, dt * cfg.pitchRate * 2.4);
    } else {
      player.pitch += (stage4TargetDown - player.pitch) * Math.min(1, dt * cfg.divePitchRate);
    }
    const minClampPitch = Math.min(-cfg.maxPitch, stage4TargetDown);
    effectivePitch = clamp(player.pitch, minClampPitch, cfg.maxPitch);
    player.stallVy = cfg.stage4SinkRate;
    player.vx = player.dir * player.speed * Math.cos(effectivePitch);
    player.vy = -player.stallVy;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // Auto U-turn softly at world edges
  if (player.x >= MAX_X - 180 && player.dir === 1) {
    player.x = MAX_X - 180;
    player.turnTimer = dt;
    player.turnDuration = turnDur;
    player.turnStartDir = 1;
    player.turnStartSpeed = Math.max(cfg.minGlideSpeed, player.speed);
    player.oppHoldTime = 0;
  } else if (player.x <= MIN_X + 180 && player.dir === -1) {
    player.x = MIN_X + 180;
    player.turnTimer = dt;
    player.turnDuration = turnDur;
    player.turnStartDir = -1;
    player.turnStartSpeed = Math.max(cfg.minGlideSpeed, player.speed);
    player.oppHoldTime = 0;
  }

  if (player.y <= 0) {
    const impactVy = Math.max(0, -player.vy);
    const impactVx = Math.abs(player.vx);
    const momentumSpeed = Math.hypot(impactVx, impactVy);
    const onStrip = isOnFriendlyPad(player);

    const safeAirstripLanding = onStrip && impactVy <= cfg.safeLandingVy && Math.abs(player.pitch) <= cfg.safeLandingPitch;
    if (safeAirstripLanding) {
      player.y = 0;
      player.vy = 0;
      player.stallVy = 0;
      player.pitch = 0;
      player.effectivePitch = 0;
      player.throttleOffTime = 0;
      player.stallTime = 0;
      player.flightStage = 1;
      player.oppHoldTime = 0;
      player.wavePhase = 0;
      player.speed = impactVx;
    } else {
      const dmg = onStrip
        ? (Math.max(0, impactVy - cfg.safeLandingVy) * 0.75 + Math.max(0, Math.abs(player.pitch) - cfg.safeLandingPitch) * 110) * (0.6 + momentumSpeed / 320)
        : (28 + impactVy * 0.85 + Math.max(0, -player.pitch) * 70) * (0.55 + momentumSpeed / 300);

      player.hp = Math.max(0, player.hp - dmg);

      if (player.hp > 0) {
        // Survives impact -> bounces back up a little into the air!
        player.y = 2;
        player.stallTime = 0;
        player.throttleOffTime = 0;
        player.flightStage = 2;
        player.stallVy = 0;
        player.speed = Math.max(cfg.minGlideSpeed * Math.min(1, cfg.bounceSpeedRetention), impactVx * cfg.bounceSpeedRetention);
        const bounceVy = clamp(impactVy * cfg.bounceElasticity + cfg.bounceBaseVy, 24, 180);
        player.pitch = clamp(Math.atan2(bounceVy, Math.max(1, player.speed)), 0.12, 0.36);
        player.vx = player.dir * player.speed * Math.cos(player.pitch);
        player.vy = bounceVy;
        player.effectivePitch = player.pitch;
        state.events.push({ type: "hard_landing", playerId: player.id, x: player.x, damage: dmg, bounced: true, onStrip, tick: state.tick });
        return "ok";
      }

      // Fatal impact -> crash-landing slide along the ground destroying vehicles & troops in path!
      player.y = 0;
      player.vy = 0;
      player.stallVy = 0;
      player.crashing = true;
      player.crashSlideTicks = cfg.crashSlideTicks;
      player.speed = Math.max(210, impactVx * 0.85);
      player.vx = player.dir * player.speed;
      player.pitch = -0.16;
      player.effectivePitch = -0.16;
      state.events.push({ type: "crash_slide_start", playerId: player.id, x: player.x, tick: state.tick });
      return "ok";
    }
  } else if (player.y > CEILING_Y) {
    player.y = CEILING_Y;
    if (player.vy > 0) player.vy = 0;
    if (player.pitch > 0) player.pitch = 0;
  }

  // Expose effective nose pitch for straight-trajectory firing
  player.effectivePitch = effectivePitch;
  return "ok";
}

function updateWeapons(state, player, input) {
  const cfg = AIRCRAFT_CONFIG[player.aircraftType];

  if (player.primaryCooldown > 0) player.primaryCooldown -= 1;
  if (player.secondaryCooldown > 0) player.secondaryCooldown -= 1;

  // Primary Weapon (A): 60 Hz Burst-Fire Reservoir Mechanic
  const canFire = player.turnTimer === 0 && (!player.landedAtBase || player.y > 4);
  if (input.firePrimary && canFire) {
    player.primaryIdleTicks = 0;
    if (player.primaryCooldown <= 0) {
      // Helicopter shoots straight out front of cockpit (0 deg + current pitch); P-47 along nose vector
      const angle = player.aircraftType === "heli"
        ? player.pitch + (cfg.primaryAngleDeg * Math.PI) / 180
        : (player.effectivePitch ?? player.pitch);
      const speed = cfg.primarySpeed;
      const vx = player.dir * speed * Math.cos(angle) + player.vx * 0.25;
      const vy = speed * Math.sin(angle);
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "bullet",
        ownerId: player.id,
        team: player.team,
        fromAircraft: true,
        x: player.x + player.dir * 38,
        y: player.y + (player.aircraftType === "heli" ? 8 : 18),
        vx,
        vy,
        damage: cfg.primaryDamage,
        distanceTraveled: 0,
        fuelBurnedOut: false,
        lifeTicks: 90
      });
      player.primaryCooldown = player.burstReservoir > 0 ? BURST_FIRE_INTERVAL : SLOW_FIRE_INTERVAL;
      state.events.push({ type: "primary_fired", playerId: player.id, burst: player.burstReservoir > 0, tick: state.tick });
    }
    if (player.burstReservoir > 0) {
      player.burstReservoir -= 1;
    }
  } else {
    player.primaryIdleTicks += 1;
    if (player.primaryIdleTicks >= BURST_RECHARGE_DELAY && player.burstReservoir < BURST_MAX_TICKS) {
      player.burstReservoir = Math.min(BURST_MAX_TICKS, player.burstReservoir + BURST_RECHARGE_RATE);
    }
  }

  // Secondary Weapon (S) — tracks single-raid 100% accuracy toward Special Weapon unlock
  if (input.fireSecondary && canFire && player.secondaryAmmo > 0 && player.secondaryCooldown <= 0) {
    player.secondaryAmmo -= 1;
    player.secondaryCooldown = cfg.secondaryCooldownTicks;
    if ((player.raidShotsFired || 0) === 0) {
      player.raidRequiredShots = cfg.maxSecondary;
    }
    player.raidShotsFired = (player.raidShotsFired || 0) + 1;

    if (player.aircraftType === "heli") {
      // Helicopter straight-trajectory fuel-limited missile (hits air OR ground!)
      const angle = player.pitch;
      const vx = player.dir * cfg.missileSpeed * Math.cos(angle);
      const vy = cfg.missileSpeed * Math.sin(angle);
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "heli_missile",
        ownerId: player.id,
        team: player.team,
        fromAircraft: true,
        isPlayerSecondary: true,
        raidId: player.raidId,
        scoredGroundUnitHit: false,
        x: player.x + player.dir * 34,
        y: player.y + 12,
        vx,
        vy,
        damage: cfg.missileDamage,
        distanceTraveled: 0,
        maxFuelDistance: Math.max(100, cfg.missileFuelDistance ?? MISSILE_FUEL_DISTANCE),
        fuelBurnedOut: false,
        lifeTicks: 420
      });
    } else {
      // P-47 ballistic dumb bomb: drops inheriting exact plane (vx, vy) momentum
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "p47_bomb",
        ownerId: player.id,
        team: player.team,
        fromAircraft: true,
        isPlayerSecondary: true,
        raidId: player.raidId,
        scoredGroundUnitHit: false,
        x: player.x,
        y: player.y + 4,
        vx: player.vx,
        vy: player.vy,
        damage: cfg.bombDamage ?? cfg.secondaryDamage ?? 145,
        distanceTraveled: 0,
        fuelBurnedOut: true, // ballistic under gravity
        lifeTicks: 240
      });
    }
    state.events.push({ type: "secondary_fired", playerId: player.id, aircraftType: player.aircraftType, tick: state.tick });
  }
}

export function updateCrashSlide(state, player, dt) {
  const cfg = AIRCRAFT_CONFIG[player.aircraftType] || AIRCRAFT_CONFIG.p47;
  player.y = 0;
  player.vy = 0;
  player.pitch = -0.16;
  player.effectivePitch = -0.16;
  player.speed = Math.max(0, player.speed - (cfg.crashSlideDecel ?? 210) * dt);
  player.vx = player.dir * player.speed;
  player.x = clamp(player.x + player.vx * dt, MIN_X + 60, MAX_X - 60);
  player.rotorPhase += dt * 6;
  player.crashSlideTicks -= 1;

  if (state.tick % 4 === 0) {
    state.events.push({ type: "explosion", x: player.x, y: 8, size: 0.55, tick: state.tick });
  }

  // Wreck drags across the ground destroying any vehicles or troops in its path
  for (const t of state.targets || []) {
    if (t.hp > 0 && Math.abs(t.x - player.x) <= 52) {
      t.hp = 0;
      t.respawnTimer = 6;
      state.events.push({ type: "explosion", x: t.x, y: 18, size: 1.25, tick: state.tick });
      state.events.push({ type: "crash_destroyed_unit", unitId: t.id, kind: t.kind, tick: state.tick });
    }
  }
  const paratroopers = state.paratroopers || [];
  for (let i = paratroopers.length - 1; i >= 0; i--) {
    const p = paratroopers[i];
    if (p.y <= 36 && Math.abs(p.x - player.x) <= 52) {
      state.events.push({ type: "explosion", x: p.x, y: 10, size: 0.6, tick: state.tick });
      state.events.push({ type: "crash_destroyed_unit", unitId: p.id, kind: p.kind, tick: state.tick });
      paratroopers.splice(i, 1);
    }
  }
  for (const u of state.units || []) {
    if (u.hp > 0 && Math.abs(u.x - player.x) <= 52) {
      u.hp = 0;
      state.events.push({ type: "explosion", x: u.x, y: 16, size: 1.15, tick: state.tick });
      state.events.push({ type: "crash_destroyed_unit", unitId: u.id, kind: u.kind, tick: state.tick });
    }
  }
  const civilians = state.civilians || [];
  for (let i = civilians.length - 1; i >= 0; i--) {
    const c = civilians[i];
    if (Math.abs(c.x - player.x) <= 44) {
      killCivilian(state, i, player.team);
      state.events.push({ type: "explosion", x: c.x, y: 10, size: 0.55, tick: state.tick });
    }
  }

  if (player.crashSlideTicks <= 0 || player.speed < 15) {
    player.crashing = false;
    player.alive = false;
    player.hp = 0;
    player.vx = 0;
    player.speed = 0;
    player.respawnTicks = 180;
    state.teamFunds[player.team] = Math.max(0, state.teamFunds[player.team] - 100);
    state.events.push({ type: "explosion", x: player.x, y: 12, size: 1.6, tick: state.tick });
    state.events.push({ type: "player_crashed", playerId: player.id, x: player.x, y: 0, tick: state.tick });
  }
}

function killPlayerAircraft(state, player) {
  if (!player.alive) return;
  player.alive = false;
  player.crashing = false;
  player.crashSlideTicks = 0;
  player.hp = 0;
  player.vx = 0;
  player.vy = 0;
  player.speed = 0;
  player.controllingV2Id = null;
  player.samWarningTicks = 0;
  player.aaWarningTicks = 0;
  resetPlayerRaidAccuracy(player);
  player.respawnTicks = 180;
  state.teamFunds[player.team] = Math.max(0, state.teamFunds[player.team] - 100);
  state.events.push({ type: "explosion", x: player.x, y: Math.max(12, player.y), size: 1.6, tick: state.tick });
  state.events.push({ type: "player_crashed", playerId: player.id, x: player.x, y: player.y, tick: state.tick });
}

function damageHq(state, hq, dmg, attackerTeam) {
  if (!hq || hq.hp <= 0 || dmg <= 0) return;
  hq.hp = Math.max(0, hq.hp - dmg);
  if (hq.hp <= 0 && !state.winner) {
    state.winner = attackerTeam;
    state.events.push({ type: "match_won", winner: attackerTeam, x: hq.x, tick: state.tick });
  }
}

function damageBunker(state, bunker, dmg) {
  if (!bunker || bunker.hp <= 0 || bunker.owner === "neutral" || dmg <= 0) return;
  bunker.hp = Math.max(0, bunker.hp - dmg);
  if (bunker.hp === 0) {
    bunker.owner = "neutral";
    state.events.push({ type: "bunker_neutralized", bunkerId: bunker.id, x: bunker.x, tick: state.tick });
  }
}

function killCivilian(state, civIndex, attackerTeam) {
  const civ = state.civilians[civIndex];
  if (!civ) return;
  state.teamFunds[attackerTeam] = Math.max(0, state.teamFunds[attackerTeam] - CIVILIAN_KILL_PENALTY);
  state.events.push({ type: "civilian_killed", team: attackerTeam, x: civ.x, penalty: CIVILIAN_KILL_PENALTY, tick: state.tick });
  state.civilians.splice(civIndex, 1);
}

function applyAmbulanceDestroyPenalty(state, amb, attackerTeam) {
  if (!amb || amb.penaltyApplied || !attackerTeam || state.teamFunds[attackerTeam] === undefined) return;
  amb.penaltyApplied = true;
  const passengersLost = amb.passengers?.length || 0;
  const penalty = CIVILIAN_KILL_PENALTY * (1 + passengersLost);
  state.teamFunds[attackerTeam] = Math.max(0, state.teamFunds[attackerTeam] - penalty);
  state.events.push({
    type: "civilian_killed",
    team: attackerTeam,
    x: amb.x,
    penalty,
    unitId: amb.id,
    cause: "ambulance_destroyed",
    passengersLost,
    tick: state.tick
  });
}

function damageAmbulance(state, amb, dmg, attackerTeam) {
  if (!amb || amb.kind !== "ambulance" || amb.hp <= 0 || dmg <= 0) return false;
  const wasAlive = amb.hp > 0;
  amb.hp = Math.max(0, amb.hp - dmg);
  if (attackerTeam) amb.lastDamagedByTeam = attackerTeam;
  if (wasAlive && amb.hp <= 0) {
    applyAmbulanceDestroyPenalty(state, amb, attackerTeam || amb.lastDamagedByTeam);
  }
  return true;
}

function applyCrossfireToAmbulances(state, targetX, hitW, damage, sourceTargetId, alreadyHitSet = null, attackerTeam = null) {
  const ratio = GROUND_BEHAVIOR_CONFIG.ambulanceCrossfireRatio;
  if (!damage || damage <= 0 || ratio <= 0) return;
  const sharedDmg = Math.max(1, Math.round(damage * ratio));
  for (const amb of state.units) {
    if (amb.kind !== "ambulance" || amb.hp <= 0 || amb.id === sourceTargetId) continue;
    if (alreadyHitSet && alreadyHitSet.has(amb.id)) continue;
    if (Math.abs(amb.x - targetX) <= hitW) {
      damageAmbulance(state, amb, sharedDmg, attackerTeam);
      if (alreadyHitSet) alreadyHitSet.add(amb.id);
      state.events.push({
        type: "ambulance_crossfire",
        unitId: amb.id,
        team: amb.team,
        damage: sharedDmg,
        sourceTargetId,
        x: amb.x,
        tick: state.tick
      });
    }
  }
}

function applySplashDamage(state, x, y, team, baseDamage, splashRadius, skipIds = new Set(), crossfiredAmbs = new Set(), allowFriendlyGroundFire = false, onEnemyGroundHit = null) {
  if (!splashRadius || splashRadius <= 0 || baseDamage <= 0) return;
  const skipAmb = !GROUND_BEHAVIOR_CONFIG.ambulanceTargetable;

  const calcFalloff = (dist, minFloor = 0.35) => {
    const core = Math.min(48, splashRadius * 0.3);
    if (dist <= core) return 1;
    return clamp(1 - 0.5 * ((dist - core) / Math.max(1, splashRadius - core)), minFloor, 1);
  };

  for (const u of state.units) {
    if (u.hp <= 0 || (skipAmb && u.kind === "ambulance") || (!allowFriendlyGroundFire && u.team === team) || skipIds.has(u.id)) continue;
    const dist = Math.hypot(u.x - x, Math.max(0, y - 24));
    if (dist <= splashRadius) {
      const dmg = Math.round(baseDamage * calcFalloff(dist));
      u.hp = Math.max(0, u.hp - dmg);
      if (u.team !== team) onEnemyGroundHit?.();
      applyCrossfireToAmbulances(state, u.x, getGroundUnitHitbox(u.kind).hitW, dmg, u.id, crossfiredAmbs, team);
    }
  }

  for (const t of state.targets) {
    if (t.hp <= 0 || (skipAmb && t.kind === "ambulance") || (!allowFriendlyGroundFire && t.team === team) || skipIds.has(t.id)) continue;
    const dist = Math.hypot(t.x - x, Math.max(0, y - 24));
    if (dist <= splashRadius) {
      const dmg = Math.round(baseDamage * calcFalloff(dist));
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp === 0) t.respawnTimer = 6;
      if (t.team !== team) onEnemyGroundHit?.();
      applyCrossfireToAmbulances(state, t.x, 58, dmg, t.id, crossfiredAmbs, team);
    }
  }

  for (let i = state.paratroopers.length - 1; i >= 0; i--) {
    const p = state.paratroopers[i];
    if ((!allowFriendlyGroundFire && p.team === team) || skipIds.has(p.id)) continue;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist <= splashRadius) {
      p.hp = (p.hp ?? 40) - Math.round(baseDamage * calcFalloff(dist));
      if (p.team !== team) onEnemyGroundHit?.();
      if (p.hp <= 0) state.paratroopers.splice(i, 1);
    }
  }

  for (const b of state.bunkers) {
    if (b.owner === "neutral" || (!allowFriendlyGroundFire && b.owner === team) || b.hp <= 0 || skipIds.has(b.id)) continue;
    const dist = Math.abs(b.x - x);
    if (dist <= splashRadius && y <= 120) {
      const dmg = Math.round(baseDamage * calcFalloff(dist, 0.45));
      damageBunker(state, b, dmg);
      applyCrossfireToAmbulances(state, b.x, 62, dmg, b.id, crossfiredAmbs, team);
    }
  }

  const enemyTeam = team === "allied" ? "enemy" : "allied";
  const hq = state.hqs[enemyTeam];
  if (hq && hq.hp > 0 && !skipIds.has(`hq_${enemyTeam}`) && Math.abs(hq.x - x) <= splashRadius + 40 && y <= 160) {
    const dist = Math.max(0, Math.abs(hq.x - x) - 40);
    const dmg = Math.round(baseDamage * calcFalloff(dist, 0.45));
    damageHq(state, hq, dmg, team);
    applyCrossfireToAmbulances(state, hq.x, 95, dmg, `hq_${enemyTeam}`, crossfiredAmbs, team);
  }

  // Ambulances are vulnerable to both friendly and enemy explosion splash
  for (const u of state.units) {
    if (u.hp <= 0 || u.kind !== "ambulance" || skipIds.has(u.id) || crossfiredAmbs.has(u.id)) continue;
    const dist = Math.hypot(u.x - x, Math.max(0, y - 24));
    if (dist <= splashRadius) {
      const dmg = Math.round(baseDamage * calcFalloff(dist));
      damageAmbulance(state, u, dmg, team);
      crossfiredAmbs.add(u.id);
    }
  }

  for (let i = state.civilians.length - 1; i >= 0; i--) {
    const c = state.civilians[i];
    if (skipIds.has(c.id)) continue;
    if (Math.abs(c.x - x) <= Math.min(splashRadius, 70) && y <= 65) {
      killCivilian(state, i, team);
    }
  }
}

function findGroundEnemyTarget(state, originX, team, maxRange, opts = {}) {
  const enemyTeam = team === "allied" ? "enemy" : "allied";
  const forwardDir = team === "allied" ? 1 : -1;
  const heavySet = new Set(["main_battle_tank", "self_propelled_howitzer"]);
  let best = null;
  let bestDist = maxRange + 1;

  const consider = (kind, id, x, y, ref) => {
    if (opts.forwardOnly && (x - originX) * forwardDir < -30) return;
    const dist = Math.abs(x - originX);
    if (dist <= maxRange && dist < bestDist) {
      bestDist = dist;
      best = { kind, id, x, y, dist, ref };
    }
  };

  const skipAmb = !GROUND_BEHAVIOR_CONFIG.ambulanceTargetable;
  for (const u of state.units) {
    if (u.hp <= 0 || u.team === team || (skipAmb && u.kind === "ambulance")) continue;
    if (opts.unarmoredOnly && heavySet.has(u.kind)) continue;
    consider(u.kind, u.id, u.x, u.kind === "infantry" ? 12 : 24, u);
  }
  for (const t of state.targets) {
    if (t.hp <= 0 || t.team === team || (skipAmb && t.kind === "ambulance")) continue;
    if (opts.unarmoredOnly && heavySet.has(t.kind)) continue;
    consider(t.kind, t.id, t.x, 24, t);
  }
  for (const p of state.paratroopers) {
    if (p.team === team || p.y > 24) continue;
    consider("paratrooper", p.id, p.x, p.y + 10, p);
  }
  if (opts.includeBunkers !== false) {
    for (const b of state.bunkers) {
      if (b.owner !== enemyTeam || b.hp <= 0) continue;
      consider("bunker", b.id, b.x, 36, b);
    }
  }
  if (opts.includeHq !== false) {
    const hq = state.hqs[enemyTeam];
    if (hq && hq.hp > 0) {
      consider("hq", `hq_${enemyTeam}`, hq.x, 55, hq);
    }
  }
  return best;
}

function findLowAirEnemyTarget(state, originX, originY, team, maxRange) {
  const forwardDir = team === "allied" ? 1 : -1;
  let best = null;
  let bestDist = maxRange + 1;

  for (const p of Object.values(state.players)) {
    if (!p.alive || p.crashing || p.team === team) continue;
    const dxForward = (p.x - originX) * forwardDir;
    // Never fire overhead or backwards; target must lie in front along horizontal line of fire
    if (dxForward < 10 || dxForward > maxRange) continue;
    const targetCenterY = p.y + 22;
    if (Math.abs(targetCenterY - originY) > 32) continue;
    if (dxForward < bestDist) {
      bestDist = dxForward;
      best = { targetType: "player", id: p.id, x: p.x, y: originY, dist: dxForward, ref: p };
    }
  }
  return best;
}

function findAirEnemyTarget(state, originX, originY, team, maxRange, opts = {}) {
  let best = null;
  let bestDist = maxRange + 1;

  const consider = (targetType, id, x, y, vx, vy, ref) => {
    const dist = Math.hypot(x - originX, y - originY);
    if (dist <= maxRange && dist < bestDist) {
      bestDist = dist;
      best = { targetType, id, x, y, vx, vy, dist, ref };
    }
  };

  for (const p of Object.values(state.players)) {
    if (!p.alive || p.crashing || p.team === team || p.y <= 15) continue;
    consider("player", p.id, p.x, p.y + 22, p.vx || 0, p.vy || 0, p);
  }
  for (const b52 of state.b52s) {
    if (!b52.alive || b52.hp <= 0 || b52.team === team) continue;
    consider("b52", b52.id, b52.x, b52.y, b52.vx || 0, 0, b52);
  }
  for (const v2 of state.v2s) {
    if (!v2.alive || v2.hp <= 0 || v2.team === team) continue;
    consider("v2", v2.id, v2.x, v2.y, v2.vx || 0, v2.vy || 0, v2);
  }
  if (opts.includeParatroopers) {
    for (const para of state.paratroopers) {
      if (para.team === team || para.phase !== "descent" || para.y <= 15) continue;
      consider("paratrooper", para.id, para.x, para.y + 12, para.vx || 0, para.vy || 0, para);
    }
  }
  return best;
}

function launchUnguidedSamMissile(state, team, originX, originY, target, intercept, samDamage) {
  state.projectiles.push({
    id: `proj_${state.nextEntityId++}`,
    kind: "sam_missile",
    guided: false,
    samProfile: intercept.profile,
    team,
    x: originX,
    y: originY,
    vx: intercept.vx,
    vy: intercept.vy,
    speed: intercept.speed,
    damage: samDamage,
    targetType: target.targetType,
    targetId: target.id,
    predictedX: intercept.predictedX,
    predictedY: intercept.predictedY,
    spoofedByFlareId: null,
    lifeTicks: clamp(Math.ceil((intercept.t + 0.65) * TICK_RATE), 90, 220)
  });
  if (target.targetType === "player" && target.ref) {
    target.ref.aaWarningTicks = Math.max(target.ref.aaWarningTicks || 0, 75);
  }
  state.events.push({
    type: "sam_launched",
    team,
    targetId: target.id,
    x: originX,
    guided: false,
    profile: intercept.profile,
    speed: intercept.speed,
    predictedX: intercept.predictedX,
    predictedY: intercept.predictedY,
    tick: state.tick
  });
}

function fireGroundProjectile(state, unit, kind, _targetX, _targetY, damage, speed, opts = {}) {
  const fireDir = unit.dir || (unit.team === "allied" ? 1 : -1);
  const fireX = unit.x + fireDir * 26;
  const fireY = opts.originY ?? 22;

  state.projectiles.push({
    id: `proj_${state.nextEntityId++}`,
    kind,
    team: unit.team,
    ownerId: unit.id,
    originX: fireX,
    x: fireX,
    y: fireY,
    vx: fireDir * speed,
    vy: 0,
    damage,
    splashRadius: opts.splashRadius || 0,
    fuelBurnedOut: false,
    lifeTicks: opts.lifeTicks || 80
  });
}

function updateGroundUnits(state) {
  const { minX, maxX } = getWorldBounds(state);
  // First pass: reset repair marker and project Supply Truck [7] +25 HP/s aura + ammo resupply
  for (const u of state.units) {
    u.repairedThisTick = false;
  }
  const supCfg = UNIT_CONFIG.supply_truck;
  for (const truck of state.units) {
    if (truck.hp <= 0 || truck.kind !== "supply_truck") continue;
    for (const ally of state.units) {
      if (ally.id === truck.id || ally.hp <= 0 || ally.team !== truck.team) continue;
      if (Math.abs(ally.x - truck.x) <= supCfg.auraRadius) {
        if (ally.hp < ally.maxHp) {
          ally.hp = Math.min(ally.maxHp, ally.hp + supCfg.healRate * DT);
        }
        ally.repairedThisTick = true;
        if (GROUND_BEHAVIOR_CONFIG.supplyReloadBoost && ally.fireCooldown > 0) {
          ally.fireCooldown = Math.max(0, ally.fireCooldown - 1);
        }
      }
    }
  }

  // Second pass: unit destruction, APC troop drops, and per-class AI
  for (let i = state.units.length - 1; i >= 0; i--) {
    const u = state.units[i];
    if (u.hp <= 0) {
      if (u.kind === "ambulance" && !u.penaltyApplied) {
        const crasher = Object.values(state.players).find(
          (p) => (p.crashing || (!p.alive && p.y <= 5)) && Math.abs(p.x - u.x) <= 80
        );
        const culprit = u.lastDamagedByTeam || crasher?.team || null;
        if (culprit) applyAmbulanceDestroyPenalty(state, u, culprit);
      }
      state.events.push({ type: "unit_destroyed", unitId: u.id, kind: u.kind, team: u.team, x: u.x, tick: state.tick });
      state.units.splice(i, 1);
      continue;
    }

    if (u.fireCooldown > 0) u.fireCooldown -= 1;
    if (u.samCooldown > 0) u.samCooldown -= 1;
    if ((u.pickupGraceTicks || 0) > 0) u.pickupGraceTicks -= 1;

    const forwardDir = u.team === "allied" ? 1 : -1;
    const enemyTeam = u.team === "allied" ? "enemy" : "allied";
    const enemyHqX = state.hqs?.[enemyTeam]?.x ?? BASES[enemyTeam].hqX;
    const speedMult = getGroundUnitSpeedMultiplier(u);
    const isDamaged = u.hp < u.maxHp;

    if (u.kind === "infantry") {
      const cfg = UNIT_CONFIG.infantry;
      const effectiveSpeed = cfg.speed * speedMult;
      u.dir = forwardDir;
      if (cfg.canCaptureBunker) {
        const capturable = state.bunkers.find(
          (b) => Math.abs(b.x - u.x) <= 22 && b.owner !== u.team && (b.owner === "neutral" || b.hp <= 0)
        );
        if (capturable) {
          capturable.owner = u.team;
          capturable.hp = capturable.maxHp;
          ensureTeamStats(state, u.team).bunkersCaptured += 1;
          state.events.push({ type: "bunker_captured", bunkerId: capturable.id, team: u.team, tick: state.tick });
          state.units.splice(i, 1);
          continue;
        }
      }

      const tgt = findGroundEnemyTarget(state, u.x, u.team, cfg.range, { forwardOnly: true });
      if (tgt) {
        u.vx = 0;
        if (!u.passiveDummy && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "bullet", tgt.x, tgt.y, cfg.damage, cfg.projSpeed, { originY: 14, lifeTicks: 40 });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.fireCooldownTicks, u);
        }
      } else if (u.holdPosition) {
        u.vx = 0;
      } else {
        const lowAirTgt = findLowAirEnemyTarget(state, u.x, 14, u.team, cfg.range);
        if (lowAirTgt && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "bullet", lowAirTgt.x, lowAirTgt.y, cfg.damage, cfg.projSpeed, { originY: 14, lifeTicks: 45 });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.fireCooldownTicks, u);
        }
        u.vx = forwardDir * effectiveSpeed;
        u.x = clamp(u.x + u.vx * DT, minX + 60, maxX - 60);
        u.walkPhase += DT * 10 * speedMult;
      }
      continue;
    }

    if (u.kind === "aa_flak_truck") {
      const cfg = UNIT_CONFIG.aa_truck;
      const effectiveSpeed = cfg.speed * speedMult;
      u.dir = forwardDir;

      const airTarget = findAirEnemyTarget(state, u.x, 34, u.team, cfg.visualRange, { includeParatroopers: false });
      if (airTarget) {
        const tvx = airTarget.vx ?? 0;
        const tvy = airTarget.vy ?? 0;
        if (u.samTrack && u.samTrack.targetId === airTarget.id) {
          const instAx = (tvx - u.samTrack.vx) / DT;
          const instAy = (tvy - u.samTrack.vy) / DT;
          u.samTrack.ax = u.samTrack.ax * 0.75 + instAx * 0.25;
          u.samTrack.ay = u.samTrack.ay * 0.75 + instAy * 0.25;
          u.samTrack.vx = tvx;
          u.samTrack.vy = tvy;
          u.samTrack.ticks += 1;
        } else {
          u.samTrack = {
            targetId: airTarget.id,
            vx: tvx,
            vy: tvy,
            ax: 0,
            ay: 0,
            ticks: 1
          };
        }
      } else {
        u.samTrack = null;
      }

      if (airTarget && !u.passiveDummy && u.samCooldown <= 0) {
        const intercept = planSamInterception(u.x, 34, airTarget, u.samTrack, {
          damaged: isDamaged && GROUND_BEHAVIOR_CONFIG.damageDegradationEnabled && GROUND_BEHAVIOR_CONFIG.damagedAaSlowOnly
        });
        if (intercept) {
          launchUnguidedSamMissile(state, u.team, u.x, 34, airTarget, intercept, cfg.samDamage);
          u.samCooldown = getGroundUnitFireCooldown(cfg.samCooldownTicks, u);
        }
      }

      const groundTarget = findGroundEnemyTarget(state, u.x, u.team, cfg.groundRange, { forwardOnly: true });
      if (groundTarget) {
        u.vx = 0;
        if (!u.passiveDummy && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "bullet", groundTarget.x, groundTarget.y, cfg.groundDamage, cfg.groundProjSpeed, {
            originY: 26,
            lifeTicks: 45
          });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.groundFireCooldownTicks, u);
        }
      } else if (u.holdPosition) {
        u.vx = 0;
      } else {
        const lowAirTgt = findLowAirEnemyTarget(state, u.x, 26, u.team, cfg.groundRange);
        if (lowAirTgt && !u.passiveDummy && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "bullet", lowAirTgt.x, lowAirTgt.y, cfg.groundDamage, cfg.groundProjSpeed, {
            originY: 26,
            lifeTicks: 45
          });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.groundFireCooldownTicks, u);
        }
        u.vx = forwardDir * effectiveSpeed;
        u.x = clamp(u.x + u.vx * DT, minX + 60, maxX - 60);
      }
      continue;
    }

    if (u.kind === "main_battle_tank") {
      const cfg = UNIT_CONFIG.mbt;
      const effectiveSpeed = cfg.speed * speedMult;
      u.dir = forwardDir;
      const tgt = findGroundEnemyTarget(state, u.x, u.team, cfg.range, { forwardOnly: true });
      if (tgt) {
        u.vx = 0;
        if (!u.passiveDummy && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "tank_shell", tgt.x, tgt.y, cfg.damage, cfg.projSpeed, { originY: 26, lifeTicks: 55 });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.fireCooldownTicks, u);
        }
      } else if (u.holdPosition) {
        u.vx = 0;
      } else {
        const lowAirTgt = findLowAirEnemyTarget(state, u.x, 26, u.team, cfg.range);
        if (lowAirTgt && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "tank_shell", lowAirTgt.x, lowAirTgt.y, cfg.damage, cfg.projSpeed, { originY: 26, lifeTicks: 55 });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.fireCooldownTicks, u);
        }
        u.vx = forwardDir * effectiveSpeed;
        u.x = clamp(u.x + u.vx * DT, minX + 60, maxX - 60);
      }
      continue;
    }

    if (u.kind === "self_propelled_howitzer") {
      const cfg = UNIT_CONFIG.howitzer;
      const effectiveSpeed = cfg.speed * speedMult;
      u.dir = forwardDir;
      const tgt = findGroundEnemyTarget(state, u.x, u.team, cfg.range, { forwardOnly: true });
      if (tgt) {
        u.vx = 0;
        if (!u.passiveDummy && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "howitzer_shell", tgt.x, tgt.y, cfg.damage, cfg.projSpeed, {
            originY: 28,
            splashRadius: cfg.splashRadius,
            lifeTicks: 100
          });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.fireCooldownTicks, u);
        }
      } else if (u.holdPosition) {
        u.vx = 0;
      } else {
        const lowAirTgt = findLowAirEnemyTarget(state, u.x, 28, u.team, cfg.range);
        if (lowAirTgt && u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "howitzer_shell", lowAirTgt.x, lowAirTgt.y, cfg.damage, cfg.projSpeed, {
            originY: 28,
            splashRadius: cfg.splashRadius,
            lifeTicks: 100
          });
          u.fireCooldown = getGroundUnitFireCooldown(cfg.fireCooldownTicks, u);
        }
        u.vx = forwardDir * effectiveSpeed;
        u.x = clamp(u.x + u.vx * DT, minX + 60, maxX - 60);
      }
      continue;
    }

    if (u.kind === "ambulance") {
      const cfg = UNIT_CONFIG.ambulance;
      const effectiveSpeed = cfg.speed * speedMult;
      const homeHqX = BASES[u.team].hqX;
      if (u.passengers.length >= u.cabinCapacity || (u.passengers.length > 0 && state.civilians.length === 0)) {
        u.returningToBase = true;
      } else if (u.passengers.length === 0) {
        u.returningToBase = false;
      }

      if (u.holdPosition) {
        u.vx = 0;
        continue;
      }

      if (u.returningToBase) {
        // Return rescued civilians strictly to Main Base HQ (drive right past intermediate friendly bunkers)
        const homeHqX = state.hqs?.[u.team]?.x ?? BASES[u.team].hqX;
        const dx = homeHqX - u.x;
        if (Math.abs(dx) > 135) {
          u.dir = dx >= 0 ? 1 : -1;
          u.vx = u.dir * effectiveSpeed;
          u.x = clamp(u.x + u.vx * DT, minX + 60, maxX - 60);
        } else {
          u.vx = 0;
          if (u.passengers.length > 0) {
            const count = u.passengers.length;
            const payout = calculateCivilianPayout(count);
            state.teamFunds[u.team] += payout;
            const tStats = ensureTeamStats(state, u.team);
            tStats.civiliansRescued += count;
            tStats.fundsEarned += payout;
            u.passengers = [];
            u.returningToBase = false;
            state.events.push({
              type: "civilians_rescued",
              by: "ambulance",
              unitId: u.id,
              team: u.team,
              count,
              payout,
              tick: state.tick
            });
            checkCivilianSpecialUnlock(state, u.team);
          }
        }
      } else if (state.civilians.length > 0) {
        let nearest = state.civilians[0];
        let bestDist = Math.abs(nearest.x - u.x);
        for (const c of state.civilians) {
          const d = Math.abs(c.x - u.x);
          if (d < bestDist) {
            bestDist = d;
            nearest = c;
          }
        }
        const dx = nearest.x - u.x;
        if (Math.abs(dx) > 18) {
          u.dir = dx >= 0 ? 1 : -1;
          u.vx = u.dir * effectiveSpeed;
          u.x = clamp(u.x + u.vx * DT, minX + 60, maxX - 60);
        } else {
          u.vx = 0;
        }
      } else {
        // When idle with no civilians on map, stage back at Main Base HQ rather than waiting at bunkers
        const dx = homeHqX - u.x;
        if (Math.abs(dx) > 135) {
          u.dir = dx >= 0 ? 1 : -1;
          u.vx = u.dir * effectiveSpeed;
          u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
        } else {
          u.vx = 0;
        }
      }
      continue;
    }

    if (u.kind === "supply_truck") {
      const cfg = UNIT_CONFIG.supply_truck;
      const effectiveSpeed = cfg.speed * speedMult;
      u.dir = forwardDir;
      if (u.holdPosition) {
        u.vx = 0;
        continue;
      }
      const combatTypes = new Set(["main_battle_tank", "self_propelled_howitzer", "aa_flak_truck"]);
      const allies = state.units.filter((other) => other.id !== u.id && other.hp > 0 && other.team === u.team && combatTypes.has(other.kind));
      let targetX = enemyHqX - forwardDir * 240;
      if (allies.length > 0) {
        allies.sort((a, b) => (b.x - a.x) * forwardDir);
        targetX = allies[0].x - forwardDir * 95;
      }
      const groundThreat = findGroundEnemyTarget(state, u.x, u.team, 220, { forwardOnly: true });
      const forwardDelta = (targetX - u.x) * forwardDir;
      if (forwardDelta > 16 && !groundThreat) {
        u.vx = forwardDir * effectiveSpeed;
        u.x = clamp(u.x + u.vx * DT, minX + 60, maxX - 60);
      } else {
        u.vx = 0;
      }
    }
  }
}

function updateDefenses(state) {
  // Bunkers fire only at ground enemies (bases and bunkers do not fire AA flak or SAMs)
  const bCfg = DEFENSE_CONFIG.bunker;
  for (const b of state.bunkers) {
    if (b.owner === "neutral" || b.hp <= 0 || b.passiveDummy) continue;
    if (b.fireCooldown > 0) b.fireCooldown -= 1;
    if (b.fireCooldown > 0) continue;

    const tgt = findGroundEnemyTarget(state, b.x, b.owner, bCfg.range, { includeBunkers: false, includeHq: false });
    if (tgt) {
      const fireDir = tgt.x >= b.x ? 1 : -1;
      const fireX = b.x + fireDir * 34;
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "bullet",
        team: b.owner,
        ownerId: b.id,
        originX: fireX,
        x: fireX,
        y: 24,
        vx: fireDir * bCfg.projSpeed,
        vy: 0,
        damage: bCfg.damage,
        fuelBurnedOut: false,
        lifeTicks: 55
      });
      b.fireCooldown = bCfg.fireCooldownTicks;
    }
  }

}

function updateB52s(state) {
  const cfg = STRATEGIC_CONFIG.b52_raid;
  for (let i = state.b52s.length - 1; i >= 0; i--) {
    const b52 = state.b52s[i];
    if (!b52.alive || b52.hp <= 0) {
      b52.alive = false;
      state.events.push({ type: "b52_destroyed", b52Id: b52.id, team: b52.team, x: b52.x, y: b52.y, tick: state.tick });
      state.events.push({ type: "explosion", x: b52.x, y: b52.y, size: 2.6, tick: state.tick });
      state.b52s.splice(i, 1);
      continue;
    }

    b52.x += b52.vx * DT;
    const stripStart = b52.targetX - b52.dir * (b52.stripWidth * 0.5);
    const progress = (b52.x - stripStart) * b52.dir;

    while (b52.bombsDropped < b52.bombsTotal && progress >= (b52.bombsDropped / b52.bombsTotal) * b52.stripWidth) {
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "b52_bomb",
        team: b52.team,
        fromAircraft: true,
        ownerId: b52.ownerId,
        x: b52.x,
        y: b52.y - 16,
        vx: b52.vx * 0.35,
        vy: -45,
        damage: cfg.bombDamage,
        splashRadius: cfg.bombSplashRadius,
        fuelBurnedOut: true,
        lifeTicks: 360
      });
      b52.bombsDropped += 1;
      state.events.push({ type: "b52_bomb_dropped", b52Id: b52.id, x: b52.x, y: b52.y, count: b52.bombsDropped, tick: state.tick });
    }

    if (b52.x < MIN_X - 360 || b52.x > MAX_X + 360) {
      state.b52s.splice(i, 1);
    }
  }
}

function detonateV2(state, v2) {
  const cfg = STRATEGIC_CONFIG.v2_missile;
  const hitY = Math.max(0, v2.y);
  applySplashDamage(state, v2.x, hitY, v2.team, cfg.damage, cfg.splashRadius, new Set(), new Set(), true);
  const owner = state.players[v2.ownerId];
  if (owner && owner.controllingV2Id === v2.id) {
    owner.controllingV2Id = null;
  }
  v2.alive = false;
  state.events.push({ type: "v2_detonated", v2Id: v2.id, team: v2.team, x: v2.x, y: hitY, tick: state.tick });
  state.events.push({ type: "explosion", x: v2.x, y: Math.max(14, hitY), size: 2.8, tick: state.tick });
}

function updateV2s(state, inputsByPlayer) {
  const cfg = STRATEGIC_CONFIG.v2_missile;
  for (let i = state.v2s.length - 1; i >= 0; i--) {
    const v2 = state.v2s[i];
    if (!v2.alive || v2.hp <= 0) {
      const owner = state.players[v2.ownerId];
      if (owner && owner.controllingV2Id === v2.id) owner.controllingV2Id = null;
      v2.alive = false;
      state.events.push({ type: "v2_intercepted", v2Id: v2.id, team: v2.team, x: v2.x, y: v2.y, tick: state.tick });
      state.events.push({ type: "explosion", x: v2.x, y: Math.max(14, v2.y), size: 2.0, tick: state.tick });
      state.v2s.splice(i, 1);
      continue;
    }

    v2.fuelTicks -= 1;
    v2.launchGraceTicks = Math.max(0, v2.launchGraceTicks - 1);

    const inp = inputsByPlayer[v2.ownerId] || {};
    const hInput = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const vInput = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);

    if (vInput !== 0) {
      v2.pitch = clamp(v2.pitch + vInput * 2.2 * DT, -1.35, 1.35);
    } else if (v2.y > 180 && v2.pitch > 0.04) {
      v2.pitch = Math.max(0.02, v2.pitch - 1.4 * DT);
    }

    if (hInput !== 0) {
      if (hInput === v2.dir) {
        v2.speed = Math.min(cfg.maxSpeed, v2.speed + 240 * DT);
      } else {
        v2.speed = Math.max(cfg.minSpeed, v2.speed - 220 * DT);
      }
    }

    if (v2.fuelTicks <= 0) {
      v2.pitch = Math.max(-1.35, v2.pitch - 1.2 * DT);
    }

    v2.vx = v2.dir * v2.speed * Math.cos(v2.pitch);
    v2.vy = v2.speed * Math.sin(v2.pitch);
    v2.x += v2.vx * DT;
    v2.y = Math.min(CEILING_Y, v2.y + v2.vy * DT);

    let impacted = false;
    if (v2.launchGraceTicks <= 0) {
      const { minX, maxX } = getWorldBounds(state);
      if (v2.y <= 0 || v2.x <= minX + 20 || v2.x >= maxX - 20) {
        impacted = true;
      } else {
        const enemyTeam = v2.team === "allied" ? "enemy" : "allied";
        const hq = state.hqs[enemyTeam];
        if (hq.hp > 0 && Math.abs(v2.x - hq.x) <= 95 && v2.y <= 140) impacted = true;
        if (!impacted) {
          for (const b of state.bunkers) {
            if (b.owner !== "neutral" && b.hp > 0 && Math.abs(v2.x - b.x) <= 60 && v2.y <= 85) {
              impacted = true;
              break;
            }
          }
        }
        if (!impacted && v2.y <= 55) {
          const skipAmb = !GROUND_BEHAVIOR_CONFIG.ambulanceTargetable;
          for (const u of state.units) {
            if (u.hp > 0 && !(skipAmb && u.kind === "ambulance") && Math.abs(v2.x - u.x) <= 45) {
              impacted = true;
              break;
            }
          }
          if (!impacted) {
            for (const t of state.targets) {
              if (t.team !== v2.team && t.hp > 0 && Math.abs(v2.x - t.x) <= 45) {
                impacted = true;
                break;
              }
            }
          }
        }
      }
    }

    if (impacted) {
      detonateV2(state, v2);
      state.v2s.splice(i, 1);
    }
  }
}

function updateCivilians(state) {
  if (state.includeCivilians && state.tick % 720 === 0 && state.civilians.length < 8) {
    for (const vx of VILLAGE_X_POSITIONS) {
      if (!state.civilians.some((c) => Math.abs(c.x - vx) < 160)) {
        spawnCivilian(state, vx, vx);
        break;
      }
    }
  }

  for (let i = state.civilians.length - 1; i >= 0; i--) {
    const civ = state.civilians[i];
    civ.animPhase += DT * 6;

    let extractor = null;
    let bestDist = Infinity;
    const heliCfg = AIRCRAFT_CONFIG.heli;
    const heliAttract = Math.max(24, heliCfg.civAttractRadius ?? 180);
    const heliMaxAlt = heliCfg.pickupMaxAlt ?? 15;
    const heliMaxSpeed = heliCfg.pickupMaxSpeed ?? 95;

    for (const p of Object.values(state.players)) {
      if (!p.alive || p.crashing || p.aircraftType !== "heli") continue;
      if (p.y > heliMaxAlt || Math.abs(p.vx) >= heliMaxSpeed || p.passengers.length >= p.cabinCapacity) continue;
      const dist = Math.abs(p.x - civ.x);
      if (dist <= heliAttract && dist < bestDist) {
        bestDist = dist;
        extractor = { kind: "heli", id: p.id, x: p.x, team: p.team, ref: p };
      }
    }

    for (const u of state.units) {
      if (u.hp <= 0 || u.kind !== "ambulance" || u.passengers.length >= u.cabinCapacity) continue;
      const dist = Math.abs(u.x - civ.x);
      if (dist <= 180 && dist < bestDist) {
        bestDist = dist;
        extractor = { kind: "ambulance", id: u.id, x: u.x, team: u.team, ref: u };
      }
    }

    if (extractor) {
      const wantDir = extractor.x >= civ.x ? 1 : -1;
      if (civ.state === "wave" || civ.dir !== wantDir) {
        civ.state = "turn";
        civ.turnTimer = 0.16;
        civ.dir = wantDir;
      } else if (civ.state === "turn") {
        civ.turnTimer -= DT;
        if (civ.turnTimer <= 0) {
          civ.state = "run";
        }
      } else {
        const { minX, maxX } = getWorldBounds(state);
        civ.vx = civ.dir * 64;
        civ.x = clamp(civ.x + civ.vx * DT, minX + 60, maxX - 60);
      }

      if (Math.abs(civ.x - extractor.x) <= 24) {
        extractor.ref.passengers.push("civilian");
        state.events.push({
          type: "civilian_boarded",
          civilianId: civ.id,
          extractorId: extractor.id,
          extractorKind: extractor.kind,
          team: extractor.team,
          tick: state.tick
        });
        state.civilians.splice(i, 1);
      }
    } else {
      civ.state = "wave";
      civ.vx = 0;
    }
  }
}

function updateProjectiles(state) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const pr = state.projectiles[i];
    pr.lifeTicks -= 1;

    if (pr.kind === "heli_missile" || pr.kind === "p47_missile") {
      if (!pr.fuelBurnedOut) {
        const stepDist = Math.hypot(pr.vx * DT, pr.vy * DT);
        pr.x += pr.vx * DT;
        pr.y += pr.vy * DT;
        pr.distanceTraveled += stepDist;
        if (pr.distanceTraveled >= pr.maxFuelDistance) {
          pr.fuelBurnedOut = true;
          state.events.push({ type: "missile_fuel_cutoff", id: pr.id, x: pr.x, y: pr.y, tick: state.tick });
        }
      } else {
        // Out of fuel -> falls ballistically under gravity
        pr.vy -= GRAVITY * DT;
        pr.vx *= Math.pow(0.82, DT);
        pr.x += pr.vx * DT;
        pr.y += pr.vy * DT;
      }
    } else if (pr.kind === "p47_bomb" || pr.kind === "heli_bomb" || pr.kind === "b52_bomb") {
      pr.vy -= GRAVITY * DT;
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
    } else if (pr.kind === "sam_missile") {
      if (pr.guided === false) {
        // AA Flak Truck unguided SAMs fly strictly in a straight line (no mid-flight homing)
        pr.x += pr.vx * DT;
        pr.y += pr.vy * DT;
      } else {
        let targetPos = null;
        if (pr.targetType === "player") {
          const tp = state.players[pr.targetId];
          if (tp && tp.alive) targetPos = { x: tp.x, y: tp.y + 18, ref: tp };
        } else if (pr.targetType === "b52") {
          const b52 = state.b52s.find((b) => b.id === pr.targetId && b.alive);
          if (b52) targetPos = { x: b52.x, y: b52.y };
        } else if (pr.targetType === "v2") {
          const v2 = state.v2s.find((v) => v.id === pr.targetId && v.alive);
          if (v2) targetPos = { x: v2.x, y: v2.y };
        }

        if (targetPos) {
          const desired = Math.atan2(targetPos.y - pr.y, targetPos.x - pr.x);
          const cur = Math.atan2(pr.vy, pr.vx);
          let diff = desired - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = 3.2 * DT;
          const nextAng = cur + clamp(diff, -maxTurn, maxTurn);
          pr.vx = Math.cos(nextAng) * pr.speed;
          pr.vy = Math.sin(nextAng) * pr.speed;
        }

        pr.x += pr.vx * DT;
        pr.y += pr.vy * DT;
      }
    } else {
      // bullet, tank_shell, howitzer_shell, flak_shell — strictly straight-line trajectory
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
    }

    let hit = false;
    const skipSplash = new Set();
    const crossfiredAmbs = new Set();
    const isAntiAirProj = pr.kind === "flak_shell" || pr.kind === "sam_missile";
    const isAircraftProj = Boolean(
      pr.fromAircraft ||
      pr.kind === "p47_bomb" ||
      pr.kind === "heli_bomb" ||
      pr.kind === "b52_bomb" ||
      pr.kind === "heli_missile" ||
      pr.kind === "p47_missile"
    );
    const canHitAir =
      pr.kind === "bullet" ||
      pr.kind === "heli_missile" ||
      pr.kind === "p47_missile" ||
      pr.kind === "tank_shell" ||
      pr.kind === "howitzer_shell" ||
      isAntiAirProj;

    // Air targets (enemy aircraft, B-52, V2) — friendly fire passes harmlessly through friendly aircraft
    if (canHitAir) {
      for (const other of Object.values(state.players)) {
        if (!other.alive || other.crashing || other.team === pr.team) continue;
        const dx = pr.x - other.x;
        const dy = pr.y - (other.y + 22);
        if (dx * dx + dy * dy <= 34 * 34) {
          other.hp = Math.max(0, other.hp - pr.damage);
          hit = true;
          state.events.push({ type: "explosion", x: pr.x, y: pr.y, size: pr.kind === "bullet" ? 0.4 : 1.2, tick: state.tick });
          if (other.hp <= 0) {
            killPlayerAircraft(state, other);
          }
          break;
        }
      }

      if (!hit) {
        for (const b52 of state.b52s) {
          if (!b52.alive || b52.hp <= 0 || b52.team === pr.team) continue;
          if (Math.abs(pr.x - b52.x) <= 95 && Math.abs(pr.y - b52.y) <= 42) {
            b52.hp = Math.max(0, b52.hp - pr.damage);
            hit = true;
            state.events.push({ type: "explosion", x: pr.x, y: pr.y, size: pr.kind === "bullet" ? 0.45 : 1.3, tick: state.tick });
            break;
          }
        }
      }

      if (!hit) {
        for (const v2 of state.v2s) {
          if (!v2.alive || v2.hp <= 0 || v2.team === pr.team) continue;
          if (Math.abs(pr.x - v2.x) <= 32 && Math.abs(pr.y - v2.y) <= 24) {
            v2.hp = Math.max(0, v2.hp - pr.damage);
            hit = true;
            state.events.push({ type: "explosion", x: pr.x, y: pr.y, size: 1.0, tick: state.tick });
            break;
          }
        }
      }
    }

    // Ground targets (practice targets, RTS units, paratroopers, bunkers, HQ, ambulances, civilians)
    // Aircraft projectiles can hit their own ground units, paratroopers, and bunkers; ambulances can be hit by any fire
    if (!hit && !isAntiAirProj) {
      const skipAmb = !GROUND_BEHAVIOR_CONFIG.ambulanceTargetable;
      const rearMult = Math.max(1, GROUND_BEHAVIOR_CONFIG.rearHitMultiplier);
      for (const t of state.targets) {
        if (t.hp <= 0 || (!isAircraftProj && t.team === pr.team) || (skipAmb && t.kind === "ambulance")) continue;
        if (Math.abs(pr.x - t.x) <= 58 && pr.y >= 0 && pr.y <= 52) {
          const hitFromBehind = (t.dir === 1 && pr.vx > 0) || (t.dir === -1 && pr.vx < 0);
          const rearHit = hitFromBehind && pr.kind !== "bullet";
          const dmg = rearHit ? Math.round(pr.damage * rearMult) : pr.damage;
          t.hp = Math.max(0, t.hp - dmg);
          if (t.hp === 0) t.respawnTimer = 6;
          if (t.team !== pr.team) recordSecondaryGroundUnitHit(state, pr);
          applyCrossfireToAmbulances(state, t.x, 58, dmg, t.id, crossfiredAmbs, pr.team);
          skipSplash.add(t.id);
          hit = true;
          state.events.push({
            type: "explosion",
            x: pr.x,
            y: Math.max(12, pr.y),
            size: pr.kind === "bullet" ? 0.35 : 1.3,
            rearHit,
            tick: state.tick
          });
          break;
        }
      }

      if (!hit) {
        for (const u of state.units) {
          if (u.hp <= 0 || (skipAmb && u.kind === "ambulance") || (!isAircraftProj && u.team === pr.team)) continue;
          const { hitW, hitH } = getGroundUnitHitbox(u.kind);
          if (Math.abs(pr.x - u.x) <= hitW && pr.y >= 0 && pr.y <= hitH) {
            const hitFromBehind = (u.dir === 1 && pr.vx > 0) || (u.dir === -1 && pr.vx < 0);
            const uCfg = resolveUnitConfig(u.unitId || u.kind);
            const isArmored = Boolean(uCfg?.heavyArmor);
            const rearHit = isArmored && hitFromBehind && pr.kind !== "bullet";
            const dmg = rearHit ? Math.round(pr.damage * rearMult) : pr.damage;
            u.hp = Math.max(0, u.hp - dmg);
            if (u.team !== pr.team) recordSecondaryGroundUnitHit(state, pr);
            applyCrossfireToAmbulances(state, u.x, hitW, dmg, u.id, crossfiredAmbs, pr.team);
            skipSplash.add(u.id);
            hit = true;
            state.events.push({
              type: "explosion",
              x: pr.x,
              y: Math.max(12, pr.y),
              size: pr.kind === "bullet" ? 0.35 : 1.25,
              rearHit,
              tick: state.tick
            });
            break;
          }
        }
      }

      if (!hit) {
        for (let pi = state.paratroopers.length - 1; pi >= 0; pi--) {
          const p = state.paratroopers[pi];
          if (!isAircraftProj && p.team === pr.team) continue;
          if (Math.abs(pr.x - p.x) <= 22 && Math.abs(pr.y - (p.y + 12)) <= 20) {
            p.hp = (p.hp ?? 40) - pr.damage;
            if (p.team !== pr.team) recordSecondaryGroundUnitHit(state, pr);
            skipSplash.add(p.id);
            if (p.hp <= 0) state.paratroopers.splice(pi, 1);
            hit = true;
            state.events.push({ type: "explosion", x: pr.x, y: Math.max(10, pr.y), size: 0.45, tick: state.tick });
            break;
          }
        }
      }

      if (!hit) {
        for (const b of state.bunkers) {
          if (b.owner === "neutral" || (!isAircraftProj && b.owner === pr.team) || b.hp <= 0) continue;
          if (Math.abs(pr.x - b.x) <= 62 && pr.y >= 0 && pr.y <= 84) {
            damageBunker(state, b, pr.damage);
            applyCrossfireToAmbulances(state, b.x, 62, pr.damage, b.id, crossfiredAmbs, pr.team);
            skipSplash.add(b.id);
            hit = true;
            state.events.push({ type: "explosion", x: pr.x, y: Math.max(16, pr.y), size: pr.kind === "bullet" ? 0.35 : 1.2, tick: state.tick });
            break;
          }
        }
      }

      if (!hit) {
        const enemyTeam = pr.team === "allied" ? "enemy" : "allied";
        const hq = state.hqs[enemyTeam];
        if (hq && hq.hp > 0 && Math.abs(pr.x - hq.x) <= 95 && pr.y >= 0 && pr.y <= 140) {
          damageHq(state, hq, pr.damage, pr.team);
          applyCrossfireToAmbulances(state, hq.x, 95, pr.damage, `hq_${enemyTeam}`, crossfiredAmbs, pr.team);
          skipSplash.add(`hq_${enemyTeam}`);
          hit = true;
          state.events.push({ type: "explosion", x: pr.x, y: Math.max(20, pr.y), size: pr.kind === "bullet" ? 0.4 : 1.5, tick: state.tick });
        }
      }

      if (!hit) {
        for (const u of state.units) {
          if (u.hp <= 0 || u.kind !== "ambulance") continue;
          // Do not hit an overlapped ambulance sitting behind/beside a ground unit's outgoing muzzle
          if (!isAircraftProj && pr.originX !== undefined && (u.x - pr.originX) * pr.vx <= 0) continue;
          const { hitW, hitH } = getGroundUnitHitbox(u.kind);
          if (Math.abs(pr.x - u.x) <= hitW && pr.y >= 0 && pr.y <= hitH) {
            damageAmbulance(state, u, pr.damage, pr.team);
            skipSplash.add(u.id);
            crossfiredAmbs.add(u.id);
            hit = true;
            state.events.push({
              type: "explosion",
              x: pr.x,
              y: Math.max(12, pr.y),
              size: pr.kind === "bullet" ? 0.35 : 1.1,
              tick: state.tick
            });
            break;
          }
        }
      }

      if (!hit) {
        for (let ci = state.civilians.length - 1; ci >= 0; ci--) {
          const c = state.civilians[ci];
          if (Math.abs(pr.x - c.x) <= 24 && pr.y >= 0 && pr.y <= 28) {
            skipSplash.add(c.id);
            killCivilian(state, ci, pr.team);
            hit = true;
            state.events.push({ type: "explosion", x: pr.x, y: 12, size: 0.6, tick: state.tick });
            break;
          }
        }
      }
    }

    if (!hit && pr.y <= 0) {
      hit = true;
      state.events.push({
        type: "explosion",
        x: pr.x,
        y: 6,
        size: pr.kind === "bullet" || pr.kind === "flak_shell" ? 0.25 : 1.0,
        tick: state.tick
      });
    }

    if (hit && pr.splashRadius > 0 && !isAntiAirProj) {
      applySplashDamage(
        state,
        pr.x,
        Math.max(0, pr.y),
        pr.team,
        pr.damage,
        pr.splashRadius,
        skipSplash,
        crossfiredAmbs,
        isAircraftProj,
        pr.isPlayerSecondary ? () => recordSecondaryGroundUnitHit(state, pr) : null
      );
    }

    const { minX, maxX } = getWorldBounds(state);
    if (hit || pr.lifeTicks <= 0 || pr.x < minX - 300 || pr.x > maxX + 300 || pr.y > CEILING_Y + 400) {
      if (pr.isPlayerSecondary && !pr.scoredGroundUnitHit) {
        const owner = state.players[pr.ownerId];
        if (owner && owner.raidId === pr.raidId) {
          owner.raidFailed = true;
        }
      }
      state.projectiles.splice(i, 1);
    }
  }
}

function updateAutoProduction(state) {
  if (!state.autoProduction) return;
  if (!state.autoProdCooldown) state.autoProdCooldown = { allied: 0, enemy: 0 };
  if (!state.autoProdCounter) state.autoProdCounter = { allied: 0, enemy: 0 };
  if (!state.autoProdState) {
    state.autoProdState = {
      allied: createTeamAutoProdState(),
      enemy: createTeamAutoProdState()
    };
  }

  for (const team of ["allied", "enemy"]) {
    if (!state.autoProduction[team]) continue;
    if (!state.autoProdState[team]) state.autoProdState[team] = createTeamAutoProdState();
    const ap = state.autoProdState[team];

    if (ap.pauseTicks > 0) {
      ap.pauseTicks -= 1;
      state.autoProdCooldown[team] = ap.pauseTicks;
      continue;
    }
    if (ap.cooldownTicks > 0) {
      ap.cooldownTicks -= 1;
      state.autoProdCooldown[team] = ap.cooldownTicks;
      continue;
    }

    // Pace strictly against the previous AUTO-purchased unit so manual player deployments never disrupt auto pacing
    const dir = team === "allied" ? 1 : -1;
    const gateX = BASES[team].hqX + dir * 120;
    const lastAuto = ap.lastUnitId
      ? state.units.find((u) => u.id === ap.lastUnitId && u.hp > 0 && u.autoPurchased)
      : null;
    if (lastAuto) {
      const distFromGate = (lastAuto.x - gateX) * dir;
      if (distFromGate < AUTO_PRODUCTION_GATE_CLEARANCE) {
        if (Math.abs(lastAuto.vx) < 1) {
          ap.gateStallTicks = (ap.gateStallTicks || 0) + 1;
          if (ap.gateStallTicks < 240) continue;
        } else {
          ap.gateStallTicks = 0;
          continue;
        }
      } else {
        ap.gateStallTicks = 0;
      }
    } else {
      ap.gateStallTicks = 0;
    }

    const activeCount = state.units.filter((u) => u.team === team && u.hp > 0).length;
    if (activeCount >= 40) continue;

    const idx = ap.patternIndex % AUTO_PRODUCTION_PATTERN.length;
    const unitKey = AUTO_PRODUCTION_PATTERN[idx];
    const cfg = resolveUnitConfig(unitKey);
    if (!cfg || state.teamFunds[team] < cfg.cost) continue;

    state.teamFunds[team] -= cfg.cost;
    const unit = spawnGroundUnit(state, team, unitKey, null, { autoPurchased: true });
    ensureTeamStats(state, team).unitsBought += 1;

    ap.lastUnitId = unit.id;
    ap.patternIndex += 1;
    state.autoProdCounter[team] = ap.patternIndex;
    ap.columnCount += 1;
    ap.gateStallTicks = 0;

    if (ap.columnCount >= AUTO_PRODUCTION_COLUMN_SIZE) {
      ap.columnCount = 0;
      ap.pauseTicks = AUTO_PRODUCTION_COLUMN_PAUSE_TICKS;
      ap.cooldownTicks = 0;
      state.autoProdCooldown[team] = ap.pauseTicks;
    } else {
      ap.cooldownTicks = AUTO_PRODUCTION_COOLDOWN_TICKS;
      state.autoProdCooldown[team] = ap.cooldownTicks;
    }

    state.events.push({
      type: "unit_requisitioned",
      playerId: "auto",
      team,
      key: cfg.key,
      unitKind: unit.kind,
      unitId: unit.id,
      cost: cfg.cost,
      auto: true,
      tick: state.tick
    });
  }
}

function updateAiCommanders(state) {
  if (!state.botThinkCooldown) state.botThinkCooldown = { allied: 0, enemy: 0 };

  for (const team of ["allied", "enemy"]) {
    if (state.autoProduction?.[team]) continue;
    const bot = Object.values(state.players).find((p) => p.isBot && p.team === team);
    if (!bot) continue;

    state.botThinkCooldown[team] -= 1;
    if (state.botThinkCooldown[team] > 0) continue;
    state.botThinkCooldown[team] = 45;

    const funds = state.teamFunds[team];
    const myUnits = state.units.filter((u) => u.team === team && u.hp > 0);
    const enemyUnits = state.units.filter((u) => u.team !== team && u.hp > 0 && u.kind !== "ambulance");
    const enemyAir = Object.values(state.players).some((p) => p.team !== team && p.alive && p.y > 25)
      || state.b52s.some((b) => b.team !== team && b.alive);
    const unownedBunkers = state.bunkers.filter((b) => b.owner !== team);

    if ((state.specialWeapons?.[team]?.available || 0) > 0 && enemyUnits.length >= 3) {
      launchSpecialWeapon(state, bot.id, "b52", { targetX: enemyUnits[0].x });
    } else if (unownedBunkers.length > 0 && myUnits.filter((u) => u.kind === "infantry").length < 2 && funds >= 50) {
      handlePlayerRequisition(state, bot.id, "1");
    } else if (state.civilians.length > 0 && !myUnits.some((u) => u.kind === "ambulance") && funds >= 120) {
      handlePlayerRequisition(state, bot.id, "5");
    } else if (enemyAir && myUnits.filter((u) => u.kind === "aa_flak_truck").length < 2 && funds >= 150) {
      handlePlayerRequisition(state, bot.id, "2");
    } else if (myUnits.filter((u) => u.kind === "main_battle_tank").length >= 1 && !myUnits.some((u) => u.kind === "supply_truck") && funds >= 200) {
      handlePlayerRequisition(state, bot.id, "6");
    } else if (funds >= 650 && myUnits.filter((u) => u.kind === "self_propelled_howitzer").length < 1) {
      handlePlayerRequisition(state, bot.id, "4");
    } else if (funds >= 400) {
      handlePlayerRequisition(state, bot.id, "3");
    }
  }
}

export function computeBotPilotInput(state, bot) {
  const inp = {
    left: false,
    right: false,
    up: false,
    down: false,
    firePrimary: false,
    fireSecondary: false
  };

  const forwardDir = bot.team === "allied" ? 1 : -1;
  const enemyTeam = bot.team === "allied" ? "enemy" : "allied";
  const homeX = BASES[bot.team].padCenterX;
  const enemyHqX = BASES[enemyTeam].hqX;

  if (bot.aircraftType === "heli") {
    const civCount = bot.passengers.filter((p) => p === "civilian").length;
    const infCount = bot.passengers.filter((p) => p === "infantry").length;

    if (bot.landedAtBase) {
      if (bot.hp < bot.maxHp * 0.9) return inp;
      if (infCount < 4 && bot.passengers.length < bot.cabinCapacity && state.tick % 15 === 0) {
        handlePlayerUtility(state, bot.id);
        return inp;
      }
      inp.up = true;
      return inp;
    }

    let goalX = 0;
    let goalY = 140;
    let landingAtPad = false;

    const shouldReturn = bot.hp < bot.maxHp * 0.35
      || civCount >= 2
      || (civCount >= 1 && state.civilians.length === 0)
      || (infCount === 0 && bot.secondaryAmmo === 0);

    if (shouldReturn) {
      goalX = homeX;
      if (Math.abs(bot.x - homeX) <= 90) {
        landingAtPad = true;
        if (bot.vy < -32) inp.up = true;
        else if (bot.vy > -24) inp.down = true;
      }
    } else {
      const safeCivs = state.civilians
        .filter((c) => Math.abs(c.x - enemyHqX) > 1400)
        .sort((a, b) => Math.abs(a.x - bot.x) - Math.abs(b.x - bot.x));

      if (safeCivs.length > 0 && bot.passengers.length < bot.cabinCapacity) {
        const civ = safeCivs[0];
        goalX = civ.x;
        goalY = Math.abs(bot.x - civ.x) <= 70 ? 8 : 110;
      } else {
        const unowned = state.bunkers
          .filter((b) => b.owner === "neutral" || b.hp <= 0)
          .sort((a, b) => Math.abs(a.x - bot.x) - Math.abs(b.x - bot.x));

        if (infCount > 0 && unowned.length > 0) {
          const b = unowned[0];
          goalX = b.x;
          goalY = 135;
          if (Math.abs(bot.x - b.x) <= 45 && bot.y > 40 && state.tick % 20 === 0) {
            handlePlayerUtility(state, bot.id);
          }
        } else {
          // Frontline combat support
          let target = null;
          let bestDist = Infinity;
          const skipAmb = !GROUND_BEHAVIOR_CONFIG.ambulanceTargetable;
          for (const u of state.units) {
            if (u.team === bot.team || u.hp <= 0 || (skipAmb && u.kind === "ambulance")) continue;
            const d = Math.abs(u.x - bot.x);
            if (d < bestDist) { bestDist = d; target = { x: u.x, y: 20, isAir: false }; }
          }
          for (const t of state.targets) {
            if (t.team === bot.team || t.hp <= 0) continue;
            const d = Math.abs(t.x - bot.x);
            if (d < bestDist) { bestDist = d; target = { x: t.x, y: 20, isAir: false }; }
          }
          for (const b of state.bunkers) {
            if (b.owner !== enemyTeam || b.hp <= 0) continue;
            const d = Math.abs(b.x - bot.x);
            if (d < bestDist) { bestDist = d; target = { x: b.x, y: 36, isAir: false }; }
          }
          for (const ep of Object.values(state.players)) {
            if (ep.team === bot.team || !ep.alive || ep.y <= 15) continue;
            const d = Math.abs(ep.x - bot.x);
            if (d < bestDist) { bestDist = d; target = { x: ep.x, y: ep.y, isAir: true }; }
          }

          if (target) {
            goalX = target.x - forwardDir * 180;
            goalY = target.isAir ? clamp(target.y, 80, 420) : 125;
            const dxForward = (target.x - bot.x) * bot.dir;
            if (dxForward > 0) {
              if (dxForward <= 380 && (target.isAir || bot.y <= 150)) {
                inp.firePrimary = true;
              }
              if (bot.secondaryAmmo > 0 && dxForward <= 650 && (target.isAir ? Math.abs(target.y - bot.y) < 85 : bot.y <= 180)) {
                inp.fireSecondary = true;
              }
            }
          } else {
            goalX = 0;
            goalY = 140;
          }
        }
      }
    }

    if (goalX - bot.x > 25) inp.right = true;
    else if (goalX - bot.x < -25) inp.left = true;

    if (!landingAtPad) {
      if (bot.y < goalY - 12) inp.up = true;
      else if (bot.y > goalY + 18) inp.down = true;
    }
    return inp;
  }

  // P-47 Thunderbolt Bot Pilot
  const cfg = AIRCRAFT_CONFIG.p47;
  if (bot.y <= 2) {
    if (bot.dir === 1) inp.right = true;
    else inp.left = true;
    if (bot.speed >= cfg.takeoffSpeed) inp.up = true;
    return inp;
  }

  const nearEnemyBase = Math.abs(bot.x - enemyHqX) < 1150 && state.hqs[enemyTeam].hp > 800 && bot.dir === forwardDir;
  const pastHomeSide = (bot.x - BASES[bot.team].hqX) * forwardDir < 500 && bot.dir === -forwardDir;
  const nearWorldEdge = (bot.x > MAX_X - 600 && bot.dir === 1) || (bot.x < MIN_X + 600 && bot.dir === -1);
  const wantTurn = nearEnemyBase || pastHomeSide || nearWorldEdge;

  if (bot.turnTimer === 0) {
    if (wantTurn) {
      if (bot.dir === 1) inp.left = true;
      else inp.right = true;
    } else {
      if (bot.dir === 1) inp.right = true;
      else inp.left = true;
    }
  }

  let targetY = 260;
  const enemyB52 = state.b52s.find((b) => b.team !== bot.team && b.alive && b.hp > 0);
  if (enemyB52) {
    targetY = enemyB52.y;
  } else {
    const enemyAir = Object.values(state.players).find((p) => p.team !== bot.team && p.alive && p.y > 40);
    if (enemyAir) targetY = clamp(enemyAir.y, 180, 900);
  }

  if (bot.y < Math.max(110, targetY - 25)) inp.up = true;
  else if (bot.y > targetY + 25 && bot.y > 140) inp.down = true;

  // Air-to-air firing (cannons only — dumb bombs are reserved for ground bombing runs)
  for (const b52 of state.b52s) {
    if (b52.team === bot.team || !b52.alive || b52.hp <= 0) continue;
    const dx = (b52.x - bot.x) * bot.dir;
    if (dx > 0 && dx <= 750 && Math.abs(b52.y - bot.y) < 120) {
      inp.firePrimary = true;
    }
  }
  for (const ep of Object.values(state.players)) {
    if (ep.team === bot.team || !ep.alive || ep.y <= 20) continue;
    const dx = (ep.x - bot.x) * bot.dir;
    if (dx > 0 && dx <= 750 && Math.abs(ep.y - bot.y) < 120) {
      inp.firePrimary = true;
    }
  }
  for (const v2 of state.v2s) {
    if (v2.team === bot.team || !v2.alive || v2.hp <= 0) continue;
    const dx = (v2.x - bot.x) * bot.dir;
    if (dx > 0 && dx <= 750 && Math.abs(v2.y - bot.y) < 100) inp.firePrimary = true;
  }

  // Ground strafe / ballistic dumb bomb drops when cruising low
  if (bot.y < 380) {
    const gTgt = findGroundEnemyTarget(state, bot.x, bot.team, 900);
    if (gTgt) {
      const dxForward = (gTgt.x - bot.x) * bot.dir;
      if (dxForward > 0) {
        if (bot.pitch <= 0.05 && gTgt.dist < 550) inp.firePrimary = true;
        const lead = Math.abs(bot.vx) * Math.sqrt((2 * Math.max(10, bot.y)) / GRAVITY);
        if (bot.secondaryAmmo > 0 && Math.abs(dxForward - lead) <= 85) {
          inp.fireSecondary = true;
        }
      }
    }
  }

  return inp;
}

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

export function createNetworkSnapshot(state, eventsOverride = null) {
  const players = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = {
      ...p,
      x: r2(p.x),
      y: r2(p.y),
      vx: r2(p.vx),
      vy: r2(p.vy),
      speed: r2(p.speed),
      pitch: r2(p.pitch),
      effectivePitch: r2(p.effectivePitch),
      hp: r2(p.hp),
      passengers: [...p.passengers]
    };
  }

  return {
    tick: state.tick,
    time: r2(state.time),
    phase: state.phase || "playing",
    roomId: state.roomId || "ALPHA",
    winner: state.winner,
    matchMode: state.matchMode,
    botsEnabled: state.botsEnabled,
    autoProduction: { ...(state.autoProduction || { allied: false, enemy: false }) },
    autoProdCooldown: { ...(state.autoProdCooldown || { allied: 0, enemy: 0 }) },
    autoProdCounter: { ...(state.autoProdCounter || { allied: 0, enemy: 0 }) },
    autoProdState: {
      allied: { ...(state.autoProdState?.allied || createTeamAutoProdState()) },
      enemy: { ...(state.autoProdState?.enemy || createTeamAutoProdState()) }
    },
    specialWeapons: {
      allied: { ...(state.specialWeapons?.allied || createTeamSpecialWeaponState()) },
      enemy: { ...(state.specialWeapons?.enemy || createTeamSpecialWeaponState()) }
    },
    includeCivilians: state.includeCivilians,
    ...(state.worldBounds ? { worldBounds: { ...state.worldBounds } } : {}),
    // Required by stepSimulation when clients run local prediction on received snapshots
    nextEntityId: state.nextEntityId,
    botThinkCooldown: { ...(state.botThinkCooldown || { allied: 0, enemy: 0 }) },
    baseAa: {
      allied: { ...(state.baseAa?.allied || { flakCooldown: 0, samCooldown: 0 }) },
      enemy: { ...(state.baseAa?.enemy || { flakCooldown: 0, samCooldown: 0 }) }
    },
    players,
    teamFunds: {
      allied: r2(state.teamFunds.allied),
      enemy: r2(state.teamFunds.enemy)
    },
    hqs: {
      allied: { ...state.hqs.allied, hp: r2(state.hqs.allied.hp) },
      enemy: { ...state.hqs.enemy, hp: r2(state.hqs.enemy.hp) }
    },
    bunkers: state.bunkers.map((b) => ({ ...b, hp: r2(b.hp) })),
    units: state.units.map((u) => ({
      ...u,
      x: r2(u.x),
      y: r2(u.y),
      vx: r2(u.vx),
      hp: r2(u.hp),
      samTrack: u.samTrack
        ? {
            ...u.samTrack,
            vx: r2(u.samTrack.vx),
            vy: r2(u.samTrack.vy),
            ax: r2(u.samTrack.ax),
            ay: r2(u.samTrack.ay)
          }
        : null,
      passengers: u.passengers ? [...u.passengers] : []
    })),
    targets: state.targets.map((t) => ({ ...t, x: r2(t.x), y: r2(t.y), vx: r2(t.vx), hp: r2(t.hp) })),
    paratroopers: state.paratroopers.map((p) => ({ ...p, x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy), hp: r2(p.hp) })),
    civilians: state.civilians.map((c) => ({ ...c, x: r2(c.x), y: r2(c.y), vx: r2(c.vx) })),
    b52s: state.b52s.map((b) => ({ ...b, x: r2(b.x), y: r2(b.y), vx: r2(b.vx), hp: r2(b.hp) })),
    v2s: state.v2s.map((v) => ({ ...v, x: r2(v.x), y: r2(v.y), vx: r2(v.vx), vy: r2(v.vy), speed: r2(v.speed), pitch: r2(v.pitch), hp: r2(v.hp) })),
    projectiles: state.projectiles.map((pr) => ({ ...pr, x: r2(pr.x), y: r2(pr.y), vx: r2(pr.vx), vy: r2(pr.vy) })),
    flares: state.flares.map((f) => ({ ...f, x: r2(f.x), y: r2(f.y), vx: r2(f.vx), vy: r2(f.vy) })),
    stats: state.stats,
    events: eventsOverride ?? state.events
  };
}

export function reconcileClientState(localState, serverState, localPlayerId) {
  const localP = localState?.players?.[localPlayerId];
  const srvP = serverState?.players?.[localPlayerId];
  if (
    localP &&
    srvP &&
    srvP.alive &&
    localP.alive &&
    !srvP.crashing &&
    !localP.crashing &&
    srvP.aircraftType === localP.aircraftType &&
    !srvP.controllingV2Id
  ) {
    const dist = Math.hypot(srvP.x - localP.x, srvP.y - localP.y);
    if (dist < 180) {
      const blend = 0.35;
      srvP.x = localP.x + (srvP.x - localP.x) * blend;
      if (localP.y > 0 && srvP.y <= 0.5 && localP.vy > 0 && localP.y < 30) {
        srvP.y = localP.y;
        srvP.vy = localP.vy;
      } else {
        srvP.y = localP.y + (srvP.y - localP.y) * blend;
        srvP.vy = localP.vy + (srvP.vy - localP.vy) * blend;
      }
      srvP.vx = localP.vx + (srvP.vx - localP.vx) * blend;
      srvP.speed = localP.speed + (srvP.speed - localP.speed) * blend;
      srvP.pitch = localP.pitch + (srvP.pitch - localP.pitch) * blend;
      srvP.effectivePitch = localP.effectivePitch + (srvP.effectivePitch - localP.effectivePitch) * blend;
      srvP.dir = localP.dir;
      srvP.flightStage = localP.flightStage;
      srvP.throttleOffTime = localP.throttleOffTime;
      srvP.stallTime = localP.stallTime;
      srvP.wavePhase = localP.wavePhase;
      srvP.oppHoldTime = localP.oppHoldTime;
      srvP.prevHInput = localP.prevHInput;
      srvP.rotorPhase = localP.rotorPhase;
      srvP.airborneTime = localP.airborneTime;
      if (localP.turnTimer > 0) {
        srvP.turnTimer = localP.turnTimer;
        srvP.turnDuration = localP.turnDuration;
        srvP.turnStartDir = localP.turnStartDir;
        srvP.turnStartSpeed = localP.turnStartSpeed;
      }
    }
  }
  return serverState;
}

export function stepSimulation(state, inputsByPlayer = {}) {
  if (state.phase === "lobby") {
    state.events = [];
    return state;
  }

  state.tick += 1;
  state.time = state.tick * DT;
  state.events = [];

  if (state.winner) {
    return state;
  }

  // 0. Passive Shared Team War Funds Income (every 1.0s / 60 ticks)
  if (state.tick % TICK_RATE === 0) {
    for (const team of ["allied", "enemy"]) {
      const ownedBunkers = state.bunkers.filter((b) => b.owner === team && b.hp > 0).length;
      const income = BASE_INCOME_PER_SEC + BUNKER_INCOME_PER_SEC * ownedBunkers;
      state.teamFunds[team] += income;
      ensureTeamStats(state, team).fundsEarned += income;
      state.events.push({ type: "income_tick", team, income, ownedBunkers, tick: state.tick });
    }
  }

  // 0a. Automatic Ground Troop Production (tanks & AA flaks)
  updateAutoProduction(state);

  // 0b. AI Bot Commanders
  if (state.botsEnabled) {
    updateAiCommanders(state);
  }

  // 1. Update Players
  const resolvedInputs = { ...inputsByPlayer };
  for (const player of Object.values(state.players)) {
    player.samWarningTicks = Math.max(0, (player.samWarningTicks || 0) - 1);
    player.aaWarningTicks = Math.max(0, (player.aaWarningTicks || 0) - 1);

    if (player.controllingV2Id) {
      const activeV2 = state.v2s.find((v) => v.id === player.controllingV2Id && v.alive);
      if (!activeV2) player.controllingV2Id = null;
    }

    if (!player.alive) {
      player.respawnTicks -= 1;
      if (player.respawnTicks <= 0) {
        const base = BASES[player.team];
        const cfg = AIRCRAFT_CONFIG[player.aircraftType];
        player.alive = true;
        player.crashing = false;
        player.crashSlideTicks = 0;
        player.x = base.padCenterX;
        player.y = 0;
        player.vx = 0;
        player.vy = 0;
        player.speed = 0;
        player.stallVy = 0;
        player.pitch = 0;
        player.effectivePitch = 0;
        player.throttleOffTime = 0;
        player.stallTime = 0;
        player.airborneTime = 0;
        player.wavePhase = 0;
        player.flightStage = 1;
        player.prevHInput = 0;
        player.oppHoldTime = 0;
        player.dir = player.team === "allied" ? 1 : -1;
        player.hp = cfg.maxHp;
        player.secondaryAmmo = cfg.maxSecondary;
        resetPlayerRaidAccuracy(player);
        player.burstReservoir = BURST_MAX_TICKS;
        player.turnTimer = 0;
        player.turnDuration = cfg.turnDuration;
        player.landedAtBase = true;
        player.samWarningTicks = 0;
        player.aaWarningTicks = 0;
        if (player.aircraftType === "heli") {
          player.passengers = ["infantry", "infantry", "infantry", "infantry"];
        }
        state.events.push({ type: "player_respawned", playerId: player.id, tick: state.tick });
      }
      continue;
    }

    if (player.crashing) {
      updateCrashSlide(state, player, DT);
      continue;
    }

    // When steering a launched V2 cruise missile, aircraft coasts hands-off while arrow keys steer V2
    const rawInput = resolvedInputs[player.id] !== undefined
      ? resolvedInputs[player.id]
      : (player.isBot && state.botsEnabled ? computeBotPilotInput(state, player) : {});
    resolvedInputs[player.id] = rawInput;
    let aircraftInput = player.controllingV2Id ? {} : rawInput;
    if (!player.controllingV2Id && player.aircraftType === "p47" && player.y <= 0.5) {
      if (aircraftInput.up && !aircraftInput.left && !aircraftInput.right) {
        aircraftInput = { ...aircraftInput, [player.dir >= 0 ? "right" : "left"]: true };
      } else if ((aircraftInput.left || aircraftInput.right) && !aircraftInput.down && player.speed >= AIRCRAFT_CONFIG.p47.takeoffSpeed) {
        aircraftInput = { ...aircraftInput, up: true };
      }
    } else if (!player.controllingV2Id && player.aircraftType === "heli" && player.y <= 2) {
      if ((aircraftInput.left || aircraftInput.right) && !aircraftInput.down) {
        aircraftInput = { ...aircraftInput, up: true };
      }
    }
    const status = player.aircraftType === "heli"
      ? updateHeli(player, aircraftInput, DT)
      : updateP47(state, player, aircraftInput, DT);

    if (status === "crash") {
      killPlayerAircraft(state, player);
      continue;
    }

    player.landedAtBase = player.y <= 0.5 && isOnFriendlyPad(player) && Math.abs(player.vx) < 25;
    if (player.landedAtBase) {
      // Landing mid-raid (or rearming at pad) resets single-raid accuracy streak
      if ((player.raidShotsFired || 0) > 0 && (player.raidShotsFired || 0) < (player.raidRequiredShots || AIRCRAFT_CONFIG[player.aircraftType]?.maxSecondary || 8)) {
        resetPlayerRaidAccuracy(player);
      }
      // Auto-repair, silent ammo reload & civilian evacuation payout (no modal!)
      if (player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + 100 * DT);
      }
      player.resupplyTicks += 1;
      if (player.resupplyTicks >= 30) {
        player.resupplyTicks = 0;
        if (player.secondaryAmmo < player.maxSecondary) {
          player.secondaryAmmo += 1;
          resetPlayerRaidAccuracy(player);
        }
      }

      const civCount = player.passengers.filter((p) => p === "civilian").length;
      if (civCount > 0) {
        player.passengers = player.passengers.filter((p) => p !== "civilian");
        const payout = calculateCivilianPayout(civCount);
        state.teamFunds[player.team] += payout;
        const tStats = ensureTeamStats(state, player.team);
        tStats.civiliansRescued += civCount;
        tStats.fundsEarned += payout;
        state.events.push({
          type: "civilians_rescued",
          by: "heli",
          playerId: player.id,
          team: player.team,
          count: civCount,
          payout,
          tick: state.tick
        });
        checkCivilianSpecialUnlock(state, player.team);
      }
    } else {
      player.resupplyTicks = 0;
    }

    updateWeapons(state, player, aircraftInput);
  }

  // 2. Update Practice Targets (simple patrol + respawn for Phase 1 combat testing)
  for (const t of state.targets) {
    if (t.hp <= 0) {
      t.respawnTimer -= DT;
      if (t.respawnTimer <= 0) {
        t.hp = t.maxHp;
      }
      continue;
    }
    t.x += t.vx * DT;
    if (t.x <= t.minX) { t.x = t.minX; t.vx = Math.abs(t.vx); t.dir = 1; }
    if (t.x >= t.maxX) { t.x = t.maxX; t.vx = -Math.abs(t.vx); t.dir = -1; }
  }

  // 3. Update Phase 2 Ground Units, Defenses, B-52 Raids & Steerable V2 Missiles
  updateGroundUnits(state);
  updateDefenses(state);
  updateB52s(state);
  updateV2s(state, resolvedInputs);

  // 4. Update Projectiles (straight-line fuel tracking, gravity & hit detection)
  updateProjectiles(state);

  // 5. Update Stranded Civilians & Helicopter/Ambulance Boarding
  updateCivilians(state);
  updateInfantryBoarding(state, resolvedInputs);

  // 7. Update Paratroopers (Descent -> Chute Collapse -> March to nearest Bunker)
  const { minX: paraMinX, maxX: paraMaxX } = getWorldBounds(state);
  for (let i = state.paratroopers.length - 1; i >= 0; i--) {
    const p = state.paratroopers[i];
    if ((p.pickupGraceTicks || 0) > 0) p.pickupGraceTicks -= 1;
    if (p.phase === "descent") {
      p.vx *= Math.pow(0.15, DT);
      p.x = clamp(p.x + p.vx * DT, paraMinX + 40, paraMaxX - 40);
      p.y += p.vy * DT;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.vx = 0;
        p.phase = "collapse";
        p.collapseTimer = 0.35;
      }
    } else if (p.phase === "collapse") {
      p.collapseTimer -= DT;
      if (p.collapseTimer <= 0) {
        p.phase = "march";
      }
    } else {
      const capturable = state.bunkers.find(
        (b) => Math.abs(b.x - p.x) <= 22 && b.owner !== p.team && (b.owner === "neutral" || b.hp <= 0)
      );
      if (capturable) {
        capturable.owner = p.team;
        capturable.hp = capturable.maxHp;
        ensureTeamStats(state, p.team).bunkersCaptured += 1;
        state.events.push({ type: "bunker_captured", bunkerId: capturable.id, team: p.team, tick: state.tick });
        state.paratroopers.splice(i, 1);
        continue;
      }

      if ((p.fireCooldown || 0) > 0) p.fireCooldown -= 1;
      const forwardDir = p.team === "allied" ? 1 : -1;
      const infCfg = UNIT_CONFIG.infantry;
      p.dir = forwardDir;
      const tgt = findGroundEnemyTarget(state, p.x, p.team, infCfg.range, { forwardOnly: true });
      if (tgt) {
        p.vx = 0;
        if ((p.fireCooldown || 0) <= 0) {
          fireGroundProjectile(state, p, "bullet", tgt.x, tgt.y, infCfg.damage, infCfg.projSpeed, { originY: 14, lifeTicks: 40 });
          p.fireCooldown = getGroundUnitFireCooldown(infCfg.fireCooldownTicks, p);
        }
      } else {
        const lowAirTgt = findLowAirEnemyTarget(state, p.x, 14, p.team, infCfg.range);
        if (lowAirTgt && (p.fireCooldown || 0) <= 0) {
          fireGroundProjectile(state, p, "bullet", lowAirTgt.x, lowAirTgt.y, infCfg.damage, infCfg.projSpeed, { originY: 14, lifeTicks: 45 });
          p.fireCooldown = getGroundUnitFireCooldown(infCfg.fireCooldownTicks, p);
        }
        const speedMult = getGroundUnitSpeedMultiplier(p);
        p.vx = forwardDir * infCfg.speed * speedMult;
        p.x = clamp(p.x + p.vx * DT, paraMinX + 60, paraMaxX - 60);
        p.walkPhase += DT * 10 * speedMult;
      }
    }
  }

  return state;
}
