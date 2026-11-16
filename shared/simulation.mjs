import {
  AIRCRAFT_CONFIG,
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
  DEFAULT_P47_CONFIG,
  DEFENSE_CONFIG,
  DT,
  GRAVITY,
  GROUND_Y,
  MAX_X,
  MIN_X,
  MISSILE_FUEL_DISTANCE,
  SLOW_FIRE_INTERVAL,
  STRATEGIC_CONFIG,
  TICK_RATE,
  UNIT_CONFIG,
  VILLAGE_X_POSITIONS
} from "./constants.mjs";

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
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
    "3": UNIT_CONFIG.apc,
    apc: UNIT_CONFIG.apc,
    armored_apc: UNIT_CONFIG.apc,
    "4": UNIT_CONFIG.mbt,
    mbt: UNIT_CONFIG.mbt,
    main_battle_tank: UNIT_CONFIG.mbt,
    "5": UNIT_CONFIG.howitzer,
    howitzer: UNIT_CONFIG.howitzer,
    self_propelled_howitzer: UNIT_CONFIG.howitzer,
    "6": UNIT_CONFIG.ambulance,
    ambulance: UNIT_CONFIG.ambulance,
    "7": UNIT_CONFIG.supply_truck,
    supply_truck: UNIT_CONFIG.supply_truck
  };
  return map[String(unitKeyOrId)] || null;
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

  const state = {
    tick: 0,
    time: 0,
    winner: null,
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

  return state;
}

export function createPlayer(id, team = "allied", aircraftType = "heli") {
  const base = BASES[team];
  const cfg = AIRCRAFT_CONFIG[aircraftType];
  const dir = team === "allied" ? 1 : -1;
  return {
    id,
    team,
    aircraftType,
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
    flaresAmmo: cfg.maxFlares,
    maxFlares: cfg.maxFlares,
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
    flareCooldown: 0,
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
    controllingV2Id: null
  };
}

export function resetMatch(state, opts = {}) {
  state.tick = 0;
  state.time = 0;
  state.winner = null;
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
    state.players[id] = createPlayer(id, existing.team, existing.aircraftType);
  }
  state.events.push({ type: "match_reset", tick: state.tick });
  return state;
}

export function addPlayer(state, id, team = "allied", aircraftType = "heli") {
  const p = createPlayer(id, team, aircraftType);
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
  player.flaresAmmo = cfg.maxFlares;
  player.maxFlares = cfg.maxFlares;
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
  player.flareCooldown = 0;
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
  player.flaresAmmo = cfg.maxFlares;
  player.maxFlares = cfg.maxFlares;
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
  player.flareCooldown = 0;
  player.samWarningTicks = 0;
  player.controllingV2Id = null;
  state.events.push({ type: "aircraft_swapped", playerId, aircraftType: targetType, tick: state.tick });
  return true;
}

export function spawnGroundUnit(state, team, unitKeyOrId, customX = null) {
  const cfg = resolveUnitConfig(unitKeyOrId);
  if (!cfg) return null;
  const base = BASES[team];
  const dir = team === "allied" ? 1 : -1;
  const x = customX !== null && customX !== undefined ? customX : base.hqX + dir * 120;
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
    walkPhase: 0,
    troopsCarried: cfg.deployTroopCount || 0,
    deployedTroops: false,
    passengers: [],
    cabinCapacity: cfg.cabinCapacity || 0,
    returningToBase: false,
    repairedThisTick: false
  };
  state.units.push(unit);
  return unit;
}

export function handlePlayerRequisition(state, playerId, key, opts = {}) {
  const player = state.players[playerId];
  if (!player || state.winner) return false;
  const normKey = String(key);

  if (normKey === "0" || normKey === "swap_aircraft") {
    return swapPlayerAircraft(state, playerId);
  }

  if (normKey === "8" || normKey === "b52_raid") {
    const cfg = STRATEGIC_CONFIG.b52_raid;
    if (state.teamFunds[player.team] < cfg.cost) return false;
    state.teamFunds[player.team] -= cfg.cost;
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
    state.events.push({ type: "b52_raid_called", playerId, team: player.team, b52Id: b52.id, targetX, tick: state.tick });
    return b52;
  }

  if (normKey === "9" || normKey === "v2_missile") {
    const cfg = STRATEGIC_CONFIG.v2_missile;
    if (state.teamFunds[player.team] < cfg.cost) return false;
    if (state.v2s.some((v) => v.ownerId === player.id && v.alive)) return false;
    state.teamFunds[player.team] -= cfg.cost;
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
    state.events.push({ type: "v2_launched", playerId, team: player.team, v2Id: v2.id, x: v2.x, tick: state.tick });
    return v2;
  }

  const cfg = resolveUnitConfig(normKey);
  if (!cfg) return false;
  if (state.teamFunds[player.team] < cfg.cost) return false;

  state.teamFunds[player.team] -= cfg.cost;
  const unit = spawnGroundUnit(state, player.team, normKey);
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

export function handlePlayerUtility(state, playerId) {
  const player = state.players[playerId];
  if (!player || !player.alive || player.aircraftType !== "heli") return false;

  // On ground at base: manually load waiting friendly infantry into cabin
  if (player.y <= 3 && isOnFriendlyPad(player)) {
    if (player.passengers.length < player.cabinCapacity) {
      const base = BASES[player.team];
      const waitIdx = state.units.findIndex(
        (u) => u.team === player.team && u.kind === "infantry" && u.hp > 0 && Math.abs(u.x - base.padCenterX) <= 160
      );
      if (waitIdx !== -1) {
        state.units.splice(waitIdx, 1);
      }
      player.passengers.push("infantry");
      state.events.push({ type: "troop_loaded", playerId, count: player.passengers.length, tick: state.tick });
      return true;
    }
    return false;
  }

  // Airborne: drop 1 infantry paratrooper from cabin (never drop rescued civilians!)
  if (player.y > 10 && player.passengers.length > 0) {
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
      vx: player.vx * 0.25,
      vy: -65,
      dir: player.dir,
      phase: "descent", // 'descent' | 'collapse' | 'march'
      collapseTimer: 0,
      walkPhase: 0,
      hp: 40
    });
    state.events.push({ type: "paratrooper_dropped", playerId, id, tick: state.tick });
    return true;
  }
  return false;
}

function updateHeli(player, input, dt) {
  const cfg = AIRCRAFT_CONFIG.heli;
  const hInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const vInput = (input.up ? 1 : 0) - (input.down ? 1 : 0);

  if (player.turnTimer > 0) {
    player.turnTimer += dt;
    const p = Math.min(1, player.turnTimer / cfg.turnDuration);
    player.vx = player.turnStartDir * Math.min(110, Math.abs(player.turnStartSpeed) + 40) * 0.45 * Math.cos(Math.PI * p);
    player.pitch *= 0.85;
    if (player.turnTimer >= cfg.turnDuration) {
      player.turnTimer = 0;
      player.dir = -player.turnStartDir;
    }
  } else {
    // Trigger smooth turnaround when reversing thrust past low speed while airborne (or stationary)
    if (hInput !== 0 && hInput !== player.dir && (player.y > 4 ? player.vx * player.dir <= 35 : true)) {
      if (player.y > 4) {
        player.turnTimer = dt;
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
        player.vx *= Math.pow(0.08, dt);
      }
      player.vx = clamp(player.vx, -cfg.maxSpeedX, cfg.maxSpeedX);
    } else {
      player.vx *= Math.pow(0.01, dt);
      if (Math.abs(player.vx) < 2) player.vx = 0;
    }

    // Target forward/backward pitch proportional to horizontal velocity
    const targetPitch = player.y > 2 ? clamp((-player.vx * player.dir) / cfg.maxSpeedX, -1, 1) * 0.24 : 0;
    player.pitch += (targetPitch - player.pitch) * Math.min(1, dt * 8);
  }

  // Vertical collective hover physics (gentle gravity sink when no Up/Down input)
  if (vInput !== 0) {
    player.vy += vInput * cfg.accelY * dt;
  } else if (player.y > 0) {
    player.vy += (-cfg.idleSinkSpeed - player.vy) * Math.min(1, dt * 3.0);
  }
  player.vy = clamp(player.vy, -cfg.maxSpeedY, cfg.maxSpeedY);

  player.x = clamp(player.x + player.vx * dt, MIN_X + 60, MAX_X - 60);
  player.y += player.vy * dt;

  if (player.y <= 0) {
    // Check hard crash vs safe touchdown
    if (player.vy < -185 && !isOnFriendlyPad(player)) {
      return "crash";
    }
    player.y = 0;
    if (player.vy < 0) player.vy = 0;
  } else if (player.y > CEILING_Y) {
    player.y = CEILING_Y;
    if (player.vy > 0) player.vy = 0;
  }

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
  if (player.flareCooldown > 0) player.flareCooldown -= 1;

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

  // Secondary Weapon (S)
  if (input.fireSecondary && canFire && player.secondaryAmmo > 0 && player.secondaryCooldown <= 0) {
    player.secondaryAmmo -= 1;
    player.secondaryCooldown = cfg.secondaryCooldownTicks;

    if (player.aircraftType === "heli") {
      // Helicopter free-drop bomb: releases straight downward inheriting 100% of chopper's (vx, vy) momentum
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "heli_bomb",
        ownerId: player.id,
        team: player.team,
        x: player.x,
        y: player.y + 4,
        vx: player.vx,
        vy: player.vy,
        damage: cfg.secondaryDamage,
        distanceTraveled: 0,
        fuelBurnedOut: true, // ballistic under gravity
        lifeTicks: 240
      });
    } else {
      // P-47 Unified Straight-Trajectory Fuel-Limited Missile (hits air OR ground!)
      // Travels straight along exact continuation of plane's nose vector for 4,000m (1/3 map), then drops under gravity
      const angle = player.effectivePitch ?? player.pitch;
      const vx = player.dir * cfg.missileSpeed * Math.cos(angle);
      const vy = cfg.missileSpeed * Math.sin(angle);
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "p47_missile",
        ownerId: player.id,
        team: player.team,
        x: player.x + player.dir * 32,
        y: player.y + 14,
        vx,
        vy,
        damage: cfg.missileDamage,
        distanceTraveled: 0,
        maxFuelDistance: MISSILE_FUEL_DISTANCE,
        fuelBurnedOut: false,
        lifeTicks: 420
      });
    }
    state.events.push({ type: "secondary_fired", playerId: player.id, aircraftType: player.aircraftType, tick: state.tick });
  }

  // Flares (Z)
  if (input.fireFlare && player.flaresAmmo > 0 && player.flareCooldown <= 0 && player.y > 4) {
    player.flaresAmmo -= 1;
    player.flareCooldown = cfg.flareCooldownTicks;
    for (let k = -1; k <= 1; k += 2) {
      state.flares.push({
        id: `flare_${state.nextEntityId++}`,
        team: player.team,
        x: player.x - player.dir * 18,
        y: player.y + 12,
        vx: -player.dir * (45 + k * 25),
        vy: -30 + k * 22,
        lifeTicks: 110
      });
    }
    state.events.push({ type: "flare_deployed", playerId: player.id, tick: state.tick });
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

function applySplashDamage(state, x, y, team, baseDamage, splashRadius, skipIds = new Set()) {
  if (!splashRadius || splashRadius <= 0 || baseDamage <= 0) return;

  const calcFalloff = (dist, minFloor = 0.35) => {
    const core = Math.min(48, splashRadius * 0.3);
    if (dist <= core) return 1;
    return clamp(1 - 0.5 * ((dist - core) / Math.max(1, splashRadius - core)), minFloor, 1);
  };

  for (const u of state.units) {
    if (u.hp <= 0 || u.team === team || skipIds.has(u.id)) continue;
    const dist = Math.hypot(u.x - x, Math.max(0, y - 24));
    if (dist <= splashRadius) {
      u.hp = Math.max(0, u.hp - Math.round(baseDamage * calcFalloff(dist)));
    }
  }

  for (const t of state.targets) {
    if (t.hp <= 0 || t.team === team || skipIds.has(t.id)) continue;
    const dist = Math.hypot(t.x - x, Math.max(0, y - 24));
    if (dist <= splashRadius) {
      t.hp = Math.max(0, t.hp - Math.round(baseDamage * calcFalloff(dist)));
      if (t.hp === 0) t.respawnTimer = 6;
    }
  }

  for (let i = state.paratroopers.length - 1; i >= 0; i--) {
    const p = state.paratroopers[i];
    if (p.team === team || skipIds.has(p.id)) continue;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist <= splashRadius) {
      p.hp = (p.hp ?? 40) - Math.round(baseDamage * calcFalloff(dist));
      if (p.hp <= 0) state.paratroopers.splice(i, 1);
    }
  }

  for (const b of state.bunkers) {
    if (b.owner === "neutral" || b.owner === team || b.hp <= 0 || skipIds.has(b.id)) continue;
    const dist = Math.abs(b.x - x);
    if (dist <= splashRadius && y <= 120) {
      damageBunker(state, b, Math.round(baseDamage * calcFalloff(dist, 0.45)));
    }
  }

  const enemyTeam = team === "allied" ? "enemy" : "allied";
  const hq = state.hqs[enemyTeam];
  if (hq && hq.hp > 0 && !skipIds.has(`hq_${enemyTeam}`) && Math.abs(hq.x - x) <= splashRadius + 40 && y <= 160) {
    const dist = Math.max(0, Math.abs(hq.x - x) - 40);
    damageHq(state, hq, Math.round(baseDamage * calcFalloff(dist, 0.45)), team);
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
  const heavySet = new Set(["main_battle_tank", "self_propelled_howitzer"]);
  let best = null;
  let bestDist = maxRange + 1;

  const consider = (kind, id, x, y, ref) => {
    const dist = Math.abs(x - originX);
    if (dist <= maxRange && dist < bestDist) {
      bestDist = dist;
      best = { kind, id, x, y, dist, ref };
    }
  };

  for (const u of state.units) {
    if (u.hp <= 0 || u.team === team) continue;
    if (opts.unarmoredOnly && heavySet.has(u.kind)) continue;
    consider(u.kind, u.id, u.x, u.kind === "infantry" ? 12 : 24, u);
  }
  for (const t of state.targets) {
    if (t.hp <= 0 || t.team === team) continue;
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

function findAirEnemyTarget(state, originX, originY, team, maxRange, opts = {}) {
  let best = null;
  let bestDist = maxRange + 1;

  const consider = (targetType, id, x, y, ref) => {
    const dist = Math.hypot(x - originX, y - originY);
    if (dist <= maxRange && dist < bestDist) {
      bestDist = dist;
      best = { targetType, id, x, y, dist, ref };
    }
  };

  for (const p of Object.values(state.players)) {
    if (!p.alive || p.crashing || p.team === team || p.y <= 15) continue;
    consider("player", p.id, p.x, p.y + 18, p);
  }
  for (const b52 of state.b52s) {
    if (!b52.alive || b52.hp <= 0 || b52.team === team) continue;
    consider("b52", b52.id, b52.x, b52.y, b52);
  }
  for (const v2 of state.v2s) {
    if (!v2.alive || v2.hp <= 0 || v2.team === team) continue;
    consider("v2", v2.id, v2.x, v2.y, v2);
  }
  if (opts.includeParatroopers) {
    for (const para of state.paratroopers) {
      if (para.team === team || para.phase !== "descent" || para.y <= 15) continue;
      consider("paratrooper", para.id, para.x, para.y + 12, para);
    }
  }
  return best;
}

function launchSamMissile(state, team, originX, originY, target, samSpeed, samDamage) {
  const dx = target.x - originX;
  const dy = target.y - originY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  state.projectiles.push({
    id: `proj_${state.nextEntityId++}`,
    kind: "sam_missile",
    team,
    x: originX,
    y: originY,
    vx: (dx / dist) * samSpeed,
    vy: (dy / dist) * samSpeed,
    speed: samSpeed,
    damage: samDamage,
    targetType: target.targetType,
    targetId: target.id,
    spoofedByFlareId: null,
    lifeTicks: 240
  });
  if (target.targetType === "player" && target.ref) {
    target.ref.samWarningTicks = 90;
    state.events.push({ type: "sam_launched", team, targetId: target.id, x: originX, tick: state.tick });
  }
}

function fireGroundProjectile(state, unit, kind, targetX, targetY, damage, speed, opts = {}) {
  const fireX = unit.x + unit.dir * 26;
  const fireY = opts.originY ?? 22;
  const dx = targetX - fireX;
  const dy = targetY - fireY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  let vx = (dx / dist) * speed;
  let vy = (dy / dist) * speed;

  if (kind === "howitzer_shell") {
    const g = GRAVITY * 0.55;
    const flightT = clamp(Math.abs(dx) / 420, 0.35, 1.5);
    vx = dx / flightT;
    vy = (14 - fireY + 0.5 * g * flightT * flightT) / flightT;
  }

  state.projectiles.push({
    id: `proj_${state.nextEntityId++}`,
    kind,
    team: unit.team,
    ownerId: unit.id,
    x: fireX,
    y: fireY,
    vx,
    vy,
    damage,
    splashRadius: opts.splashRadius || 0,
    fuelBurnedOut: kind === "howitzer_shell",
    lifeTicks: opts.lifeTicks || 80
  });
}

function updateGroundUnits(state) {
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
        if (ally.fireCooldown > 0) ally.fireCooldown = Math.max(0, ally.fireCooldown - 1);
      }
    }
  }

  // Second pass: unit destruction, APC troop drops, and per-class AI
  for (let i = state.units.length - 1; i >= 0; i--) {
    const u = state.units[i];
    if (u.hp <= 0) {
      if (u.kind === "armored_apc" && !u.deployedTroops && u.troopsCarried > 0) {
        u.deployedTroops = true;
        u.troopsCarried = 0;
        spawnGroundUnit(state, u.team, "infantry", clamp(u.x - 12, MIN_X + 60, MAX_X - 60));
        spawnGroundUnit(state, u.team, "infantry", clamp(u.x + 12, MIN_X + 60, MAX_X - 60));
        state.events.push({ type: "apc_troops_deployed", unitId: u.id, team: u.team, count: 2, reason: "destroyed", tick: state.tick });
      }
      state.events.push({ type: "unit_destroyed", unitId: u.id, kind: u.kind, team: u.team, x: u.x, tick: state.tick });
      state.units.splice(i, 1);
      continue;
    }

    if (u.fireCooldown > 0) u.fireCooldown -= 1;
    if (u.samCooldown > 0) u.samCooldown -= 1;

    const forwardDir = u.team === "allied" ? 1 : -1;
    const enemyTeam = u.team === "allied" ? "enemy" : "allied";
    const enemyHqX = BASES[enemyTeam].hqX;

    if (u.kind === "infantry") {
      const cfg = UNIT_CONFIG.infantry;
      const capturable = state.bunkers.find(
        (b) => Math.abs(b.x - u.x) <= 22 && b.owner !== u.team && (b.owner === "neutral" || b.hp <= 0)
      );
      if (capturable) {
        capturable.owner = u.team;
        capturable.hp = capturable.maxHp;
        state.events.push({ type: "bunker_captured", bunkerId: capturable.id, team: u.team, tick: state.tick });
        state.units.splice(i, 1);
        continue;
      }

      const tgt = findGroundEnemyTarget(state, u.x, u.team, cfg.range, { unarmoredOnly: true });
      if (tgt) {
        u.dir = tgt.x >= u.x ? 1 : -1;
        if (u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "bullet", tgt.x, tgt.y, cfg.damage, cfg.projSpeed, { originY: 14, lifeTicks: 40 });
          u.fireCooldown = cfg.fireCooldownTicks;
        }
      }

      if (!tgt || tgt.dist > 140) {
        const nonFriendlyBunkers = state.bunkers
          .filter((b) => b.owner !== u.team)
          .sort((a, b) => Math.abs(a.x - u.x) - Math.abs(b.x - u.x));
        const destX = nonFriendlyBunkers.length > 0 ? nonFriendlyBunkers[0].x : enemyHqX;
        const dx = destX - u.x;
        if (Math.abs(dx) > 10) {
          u.dir = dx >= 0 ? 1 : -1;
          u.vx = u.dir * cfg.speed;
          u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
          u.walkPhase += DT * 10;
        } else {
          u.vx = 0;
        }
      } else {
        u.vx = 0;
      }
      continue;
    }

    if (u.kind === "aa_flak_truck") {
      const cfg = UNIT_CONFIG.aa_truck;
      const samTarget = findAirEnemyTarget(state, u.x, 28, u.team, cfg.samRange, { includeParatroopers: false });
      if (samTarget && u.samCooldown <= 0) {
        launchSamMissile(state, u.team, u.x, 28, samTarget, cfg.samSpeed, cfg.samDamage);
        u.samCooldown = cfg.samCooldownTicks;
      }

      const flakTarget = findAirEnemyTarget(state, u.x, 28, u.team, cfg.flakRange, { includeParatroopers: true });
      if (flakTarget) {
        u.dir = flakTarget.x >= u.x ? 1 : -1;
        if (u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "flak_shell", flakTarget.x, flakTarget.y, cfg.flakDamage, cfg.flakSpeed, { originY: 32, lifeTicks: 75 });
          u.fireCooldown = cfg.flakCooldownTicks;
        }
      }

      const groundThreat = findGroundEnemyTarget(state, u.x, u.team, 320);
      if ((!flakTarget || flakTarget.dist > 480) && !groundThreat) {
        u.dir = forwardDir;
        u.vx = forwardDir * cfg.speed;
        u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
      } else {
        u.vx = 0;
      }
      continue;
    }

    if (u.kind === "armored_apc") {
      const cfg = UNIT_CONFIG.apc;
      if (u.troopsCarried > 0 && !u.deployedTroops) {
        const neutralBunker = state.bunkers.find(
          (b) => Math.abs(b.x - u.x) <= 65 && b.owner !== u.team && (b.owner === "neutral" || b.hp <= 0)
        );
        if (neutralBunker) {
          u.deployedTroops = true;
          u.troopsCarried = 0;
          spawnGroundUnit(state, u.team, "infantry", clamp(u.x - 10, MIN_X + 60, MAX_X - 60));
          spawnGroundUnit(state, u.team, "infantry", clamp(u.x + 10, MIN_X + 60, MAX_X - 60));
          state.events.push({ type: "apc_troops_deployed", unitId: u.id, team: u.team, count: 2, reason: "bunker", tick: state.tick });
        }
      }

      const tgt = findGroundEnemyTarget(state, u.x, u.team, cfg.range);
      if (tgt) {
        u.dir = tgt.x >= u.x ? 1 : -1;
        if (u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "bullet", tgt.x, tgt.y, cfg.damage, cfg.projSpeed, { originY: 28, lifeTicks: 48 });
          u.fireCooldown = cfg.fireCooldownTicks;
        }
      }

      if (!tgt || tgt.dist > 220) {
        u.dir = forwardDir;
        u.vx = forwardDir * cfg.speed;
        u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
      } else {
        u.vx = 0;
      }
      continue;
    }

    if (u.kind === "main_battle_tank") {
      const cfg = UNIT_CONFIG.mbt;
      const tgt = findGroundEnemyTarget(state, u.x, u.team, cfg.range);
      if (tgt) {
        u.dir = tgt.x >= u.x ? 1 : -1;
        if (u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "tank_shell", tgt.x, tgt.y, cfg.damage, cfg.projSpeed, { originY: 26, lifeTicks: 55 });
          u.fireCooldown = cfg.fireCooldownTicks;
        }
      }

      if (!tgt || tgt.dist > 340) {
        u.dir = forwardDir;
        u.vx = forwardDir * cfg.speed;
        u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
      } else {
        u.vx = 0;
      }
      continue;
    }

    if (u.kind === "self_propelled_howitzer") {
      const cfg = UNIT_CONFIG.howitzer;
      const tgt = findGroundEnemyTarget(state, u.x, u.team, cfg.range);
      if (tgt) {
        u.dir = tgt.x >= u.x ? 1 : -1;
        if (u.fireCooldown <= 0) {
          fireGroundProjectile(state, u, "howitzer_shell", tgt.x, tgt.y, cfg.damage, cfg.projSpeed, {
            originY: 36,
            splashRadius: cfg.splashRadius,
            lifeTicks: 150
          });
          u.fireCooldown = cfg.fireCooldownTicks;
        }
      }

      if (!tgt || tgt.dist > 620) {
        u.dir = forwardDir;
        u.vx = forwardDir * cfg.speed;
        u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
      } else {
        u.vx = 0;
      }
      continue;
    }

    if (u.kind === "ambulance") {
      const cfg = UNIT_CONFIG.ambulance;
      if (u.passengers.length >= u.cabinCapacity || (u.passengers.length > 0 && state.civilians.length === 0)) {
        u.returningToBase = true;
      } else if (u.passengers.length === 0) {
        u.returningToBase = false;
      }

      if (u.returningToBase) {
        const homeHqX = BASES[u.team].hqX;
        const dx = homeHqX - u.x;
        if (Math.abs(dx) > 180) {
          u.dir = dx >= 0 ? 1 : -1;
          u.vx = u.dir * cfg.speed;
          u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
        } else {
          u.vx = 0;
          if (u.passengers.length > 0) {
            const count = u.passengers.length;
            const payout = calculateCivilianPayout(count);
            state.teamFunds[u.team] += payout;
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
          u.vx = u.dir * cfg.speed;
          u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
        } else {
          u.vx = 0;
        }
      } else {
        u.vx = 0;
      }
      continue;
    }

    if (u.kind === "supply_truck") {
      const cfg = UNIT_CONFIG.supply_truck;
      const combatTypes = new Set(["main_battle_tank", "self_propelled_howitzer", "armored_apc", "aa_flak_truck"]);
      const allies = state.units.filter((other) => other.id !== u.id && other.hp > 0 && other.team === u.team && combatTypes.has(other.kind));
      let targetX = BASES[u.team].padCenterX + forwardDir * 120;
      if (allies.length > 0) {
        allies.sort((a, b) => (b.x - a.x) * forwardDir);
        targetX = allies[0].x - forwardDir * 95;
      } else {
        const ownedBunkers = state.bunkers.filter((b) => b.owner === u.team && b.hp > 0);
        if (ownedBunkers.length > 0) {
          ownedBunkers.sort((a, b) => (b.x - a.x) * forwardDir);
          targetX = ownedBunkers[0].x - forwardDir * 60;
        }
      }
      const dx = targetX - u.x;
      if (Math.abs(dx) > 16) {
        u.dir = dx >= 0 ? 1 : -1;
        u.vx = u.dir * cfg.speed;
        u.x = clamp(u.x + u.vx * DT, MIN_X + 60, MAX_X - 60);
      } else {
        u.vx = 0;
      }
    }
  }
}

function updateDefenses(state) {
  const bCfg = DEFENSE_CONFIG.bunker;
  for (const b of state.bunkers) {
    if (b.owner === "neutral" || b.hp <= 0) continue;
    if (b.fireCooldown > 0) b.fireCooldown -= 1;
    if (b.fireCooldown > 0) continue;

    let tgt = findGroundEnemyTarget(state, b.x, b.owner, bCfg.range, { includeBunkers: false, includeHq: false });
    if (!tgt) {
      for (const p of Object.values(state.players)) {
        if (!p.alive || p.crashing || p.team === b.owner || p.y > bCfg.maxAirY) continue;
        const dist = Math.hypot(p.x - b.x, p.y - 24);
        if (dist <= bCfg.range) {
          tgt = { x: p.x, y: p.y + 18 };
          break;
        }
      }
    }

    if (tgt) {
      const dx = tgt.x - b.x;
      const dy = tgt.y - 42;
      const dist = Math.max(1, Math.hypot(dx, dy));
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "bullet",
        team: b.owner,
        ownerId: b.id,
        x: b.x + (dx >= 0 ? 34 : -34),
        y: 42,
        vx: (dx / dist) * bCfg.projSpeed,
        vy: (dy / dist) * bCfg.projSpeed,
        damage: bCfg.damage,
        fuelBurnedOut: false,
        lifeTicks: 55
      });
      b.fireCooldown = bCfg.fireCooldownTicks;
    }
  }

  const aaCfg = DEFENSE_CONFIG.baseAa;
  for (const side of ["allied", "enemy"]) {
    if (state.hqs[side].hp <= 0) continue;
    const aa = state.baseAa[side];
    if (aa.flakCooldown > 0) aa.flakCooldown -= 1;
    if (aa.samCooldown > 0) aa.samCooldown -= 1;

    const hqX = BASES[side].hqX;
    const samTarget = findAirEnemyTarget(state, hqX, 65, side, aaCfg.samRange, { includeParatroopers: false });
    if (samTarget && aa.samCooldown <= 0) {
      launchSamMissile(state, side, hqX, 65, samTarget, aaCfg.samSpeed, aaCfg.samDamage);
      aa.samCooldown = aaCfg.samCooldownTicks;
    }

    const flakTarget = findAirEnemyTarget(state, hqX, 65, side, aaCfg.flakRange, { includeParatroopers: true });
    if (flakTarget && aa.flakCooldown <= 0) {
      const dx = flakTarget.x - hqX;
      const dy = flakTarget.y - 65;
      const dist = Math.max(1, Math.hypot(dx, dy));
      state.projectiles.push({
        id: `proj_${state.nextEntityId++}`,
        kind: "flak_shell",
        team: side,
        ownerId: `base_aa_${side}`,
        x: hqX,
        y: 65,
        vx: (dx / dist) * aaCfg.flakSpeed,
        vy: (dy / dist) * aaCfg.flakSpeed,
        damage: aaCfg.flakDamage,
        fuelBurnedOut: false,
        lifeTicks: 75
      });
      aa.flakCooldown = aaCfg.flakCooldownTicks;
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
  applySplashDamage(state, v2.x, hitY, v2.team, cfg.damage, cfg.splashRadius);
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
      if (v2.y <= 0 || v2.x <= MIN_X + 20 || v2.x >= MAX_X - 20) {
        impacted = true;
      } else {
        const enemyTeam = v2.team === "allied" ? "enemy" : "allied";
        const hq = state.hqs[enemyTeam];
        if (hq.hp > 0 && Math.abs(v2.x - hq.x) <= 95 && v2.y <= 140) impacted = true;
        if (!impacted) {
          for (const b of state.bunkers) {
            if (b.owner !== "neutral" && b.owner !== v2.team && b.hp > 0 && Math.abs(v2.x - b.x) <= 60 && v2.y <= 85) {
              impacted = true;
              break;
            }
          }
        }
        if (!impacted && v2.y <= 55) {
          for (const u of state.units) {
            if (u.team !== v2.team && u.hp > 0 && Math.abs(v2.x - u.x) <= 45) {
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
    let bestDist = 180;

    for (const p of Object.values(state.players)) {
      if (!p.alive || p.crashing || p.aircraftType !== "heli") continue;
      if (p.y > 15 || Math.abs(p.vx) >= 95 || p.passengers.length >= p.cabinCapacity) continue;
      const dist = Math.abs(p.x - civ.x);
      if (dist <= bestDist) {
        bestDist = dist;
        extractor = { kind: "heli", id: p.id, x: p.x, team: p.team, ref: p };
      }
    }

    for (const u of state.units) {
      if (u.hp <= 0 || u.kind !== "ambulance" || u.passengers.length >= u.cabinCapacity) continue;
      const dist = Math.abs(u.x - civ.x);
      if (dist <= bestDist) {
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
        civ.vx = civ.dir * 64;
        civ.x = clamp(civ.x + civ.vx * DT, MIN_X + 60, MAX_X - 60);
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

    if (pr.kind === "p47_missile") {
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
    } else if (pr.kind === "heli_bomb" || pr.kind === "b52_bomb") {
      pr.vy -= GRAVITY * DT;
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
    } else if (pr.kind === "howitzer_shell") {
      pr.vy -= GRAVITY * 0.55 * DT;
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
    } else if (pr.kind === "sam_missile") {
      // Check flare spoofing within 480m of SAM or target
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

      if (!pr.spoofedByFlareId) {
        for (const fl of state.flares) {
          if (fl.team === pr.team) continue;
          const distSam = Math.hypot(fl.x - pr.x, fl.y - pr.y);
          const distTarget = targetPos ? Math.hypot(fl.x - targetPos.x, fl.y - targetPos.y) : Infinity;
          if (distSam <= 480 || distTarget <= 480) {
            pr.spoofedByFlareId = fl.id;
            break;
          }
        }
      }

      if (pr.spoofedByFlareId) {
        const flare = state.flares.find((f) => f.id === pr.spoofedByFlareId);
        if (!flare || Math.hypot(flare.x - pr.x, flare.y - pr.y) <= 34) {
          state.events.push({ type: "sam_spoofed", id: pr.id, x: pr.x, y: pr.y, tick: state.tick });
          state.events.push({ type: "explosion", x: pr.x, y: Math.max(8, pr.y), size: 0.65, tick: state.tick });
          state.projectiles.splice(i, 1);
          continue;
        }
        const desired = Math.atan2(flare.y - pr.y, flare.x - pr.x);
        const cur = Math.atan2(pr.vy, pr.vx);
        let diff = desired - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = 4.2 * DT;
        const nextAng = cur + clamp(diff, -maxTurn, maxTurn);
        pr.vx = Math.cos(nextAng) * pr.speed;
        pr.vy = Math.sin(nextAng) * pr.speed;
      } else if (targetPos) {
        if (pr.targetType === "player" && targetPos.ref) {
          targetPos.ref.samWarningTicks = Math.max(targetPos.ref.samWarningTicks || 0, 20);
        }
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
    } else {
      // bullet, tank_shell, flak_shell
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
    }

    let hit = false;
    const skipSplash = new Set();
    const isAntiAirProj = pr.kind === "flak_shell" || pr.kind === "sam_missile";
    const canHitAir = pr.kind === "bullet" || pr.kind === "p47_missile" || isAntiAirProj;

    // Air targets (enemy aircraft, B-52, V2)
    if (canHitAir && !pr.spoofedByFlareId) {
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

    // Ground targets (practice targets, RTS units, paratroopers, bunkers, HQ, civilians)
    if (!hit && !isAntiAirProj) {
      for (const t of state.targets) {
        if (t.hp <= 0 || t.team === pr.team) continue;
        if (Math.abs(pr.x - t.x) <= 58 && pr.y >= 0 && pr.y <= 52) {
          const hitFromBehind = (t.dir === 1 && pr.vx > 0) || (t.dir === -1 && pr.vx < 0);
          const rearHit = hitFromBehind && pr.kind !== "bullet";
          const dmg = rearHit ? Math.round(pr.damage * 1.75) : pr.damage;
          t.hp = Math.max(0, t.hp - dmg);
          if (t.hp === 0) t.respawnTimer = 6;
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
          if (u.hp <= 0 || u.team === pr.team) continue;
          const hitW = u.kind === "infantry" ? 26 : u.kind === "self_propelled_howitzer" ? 64 : 52;
          const hitH = u.kind === "infantry" ? 30 : 54;
          if (Math.abs(pr.x - u.x) <= hitW && pr.y >= 0 && pr.y <= hitH) {
            const hitFromBehind = (u.dir === 1 && pr.vx > 0) || (u.dir === -1 && pr.vx < 0);
            const isArmored = u.kind === "main_battle_tank" || u.kind === "self_propelled_howitzer" || u.kind === "armored_apc";
            const rearHit = isArmored && hitFromBehind && pr.kind !== "bullet";
            const dmg = rearHit ? Math.round(pr.damage * 1.75) : pr.damage;
            u.hp = Math.max(0, u.hp - dmg);
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
          if (p.team === pr.team) continue;
          if (Math.abs(pr.x - p.x) <= 22 && Math.abs(pr.y - (p.y + 12)) <= 20) {
            p.hp = (p.hp ?? 40) - pr.damage;
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
          if (b.owner === "neutral" || b.owner === pr.team || b.hp <= 0) continue;
          if (Math.abs(pr.x - b.x) <= 62 && pr.y >= 0 && pr.y <= 84) {
            damageBunker(state, b, pr.damage);
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
          skipSplash.add(`hq_${enemyTeam}`);
          hit = true;
          state.events.push({ type: "explosion", x: pr.x, y: Math.max(20, pr.y), size: pr.kind === "bullet" ? 0.4 : 1.5, tick: state.tick });
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
      applySplashDamage(state, pr.x, Math.max(0, pr.y), pr.team, pr.damage, pr.splashRadius, skipSplash);
    }

    if (hit || pr.lifeTicks <= 0 || pr.x < MIN_X - 300 || pr.x > MAX_X + 300 || pr.y > CEILING_Y + 400) {
      state.projectiles.splice(i, 1);
    }
  }
}

export function stepSimulation(state, inputsByPlayer = {}) {
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
      state.events.push({ type: "income_tick", team, income, ownedBunkers, tick: state.tick });
    }
  }

  // 1. Update Players
  for (const player of Object.values(state.players)) {
    player.samWarningTicks = Math.max(0, (player.samWarningTicks || 0) - 1);

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
        player.flaresAmmo = cfg.maxFlares;
        player.burstReservoir = BURST_MAX_TICKS;
        player.turnTimer = 0;
        player.turnDuration = cfg.turnDuration;
        player.landedAtBase = true;
        player.samWarningTicks = 0;
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
    const rawInput = inputsByPlayer[player.id] || {};
    const aircraftInput = player.controllingV2Id ? {} : rawInput;
    const status = player.aircraftType === "heli"
      ? updateHeli(player, aircraftInput, DT)
      : updateP47(state, player, aircraftInput, DT);

    if (status === "crash") {
      killPlayerAircraft(state, player);
      continue;
    }

    player.landedAtBase = player.y <= 0.5 && isOnFriendlyPad(player) && Math.abs(player.vx) < 25;
    if (player.landedAtBase) {
      // Auto-repair, silent ammo/flare reload & civilian evacuation payout (no modal!)
      if (player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + 100 * DT);
      }
      player.resupplyTicks += 1;
      if (player.resupplyTicks >= 30) {
        player.resupplyTicks = 0;
        if (player.secondaryAmmo < player.maxSecondary) player.secondaryAmmo += 1;
        if (player.flaresAmmo < player.maxFlares) player.flaresAmmo += 1;
      }

      const civCount = player.passengers.filter((p) => p === "civilian").length;
      if (civCount > 0) {
        player.passengers = player.passengers.filter((p) => p !== "civilian");
        const payout = calculateCivilianPayout(civCount);
        state.teamFunds[player.team] += payout;
        state.events.push({
          type: "civilians_rescued",
          by: "heli",
          playerId: player.id,
          team: player.team,
          count: civCount,
          payout,
          tick: state.tick
        });
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
  updateV2s(state, inputsByPlayer);

  // 4. Update Projectiles (straight-line fuel tracking, SAM homing/spoofing, gravity & hit detection)
  updateProjectiles(state);

  // 5. Update Flares
  for (let i = state.flares.length - 1; i >= 0; i--) {
    const fl = state.flares[i];
    fl.lifeTicks -= 1;
    fl.vy -= 45 * DT;
    fl.x += fl.vx * DT;
    fl.y = Math.max(0, fl.y + fl.vy * DT);
    if (fl.lifeTicks <= 0) state.flares.splice(i, 1);
  }

  // 6. Update Stranded Civilians & Helicopter/Ambulance Boarding
  updateCivilians(state);

  // 7. Update Paratroopers (Descent -> Chute Collapse -> March to nearest Bunker)
  for (let i = state.paratroopers.length - 1; i >= 0; i--) {
    const p = state.paratroopers[i];
    if (p.phase === "descent") {
      p.vx *= Math.pow(0.15, DT);
      p.x = clamp(p.x + p.vx * DT, MIN_X + 40, MAX_X - 40);
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
      // March toward nearest bunker or forward
      const targetBunker = state.bunkers.reduce((best, b) =>
        Math.abs(b.x - p.x) < Math.abs(best.x - p.x) ? b : best
      );
      const dx = targetBunker.x - p.x;
      if (Math.abs(dx) > 12) {
        p.dir = dx > 0 ? 1 : -1;
        p.x += p.dir * 52 * DT;
        p.walkPhase += DT * 10;
      } else if (targetBunker.owner !== p.team && (targetBunker.owner === "neutral" || targetBunker.hp <= 0)) {
        targetBunker.owner = p.team;
        targetBunker.hp = targetBunker.maxHp;
        state.events.push({ type: "bunker_captured", bunkerId: targetBunker.id, team: p.team, tick: state.tick });
        state.paratroopers.splice(i, 1);
      }
    }
  }

  return state;
}
