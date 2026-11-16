import {
  AIRCRAFT_CONFIG,
  BASES,
  BUNKER_X_POSITIONS,
  BURST_FIRE_INTERVAL,
  BURST_MAX_TICKS,
  BURST_RECHARGE_DELAY,
  BURST_RECHARGE_RATE,
  CEILING_Y,
  DT,
  GRAVITY,
  GROUND_Y,
  MAX_X,
  MIN_X,
  MISSILE_FUEL_DISTANCE,
  SLOW_FIRE_INTERVAL,
  TICK_RATE
} from "./constants.mjs";

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createInitialState(opts = {}) {
  const bunkers = BUNKER_X_POSITIONS.map((x, idx) => ({
    id: `bunker_${idx}`,
    x,
    y: GROUND_Y,
    owner: "neutral", // 'neutral' | 'allied' | 'enemy'
    hp: 1000,
    maxHp: 1000,
    captureProgress: 0
  }));

  // Phase 1 sandbox ground practice targets (so shooting, bombing & paratrooper capture feel alive right away)
  const targets = opts.includePracticeTargets === false ? [] : [
    { id: "tgt_mbt_1", kind: "main_battle_tank", team: "enemy", x: 1100, y: 0, vx: -28, minX: 700, maxX: 2500, hp: 650, maxHp: 650, dir: -1, respawnTimer: 0 },
    { id: "tgt_sph_1", kind: "self_propelled_howitzer", team: "enemy", x: 2400, y: 0, vx: -18, minX: 1600, maxX: 3300, hp: 1000, maxHp: 1000, dir: -1, respawnTimer: 0 },
    { id: "tgt_aa_1", kind: "aa_flak_truck", team: "enemy", x: -950, y: 0, vx: 32, minX: -2200, maxX: -450, hp: 140, maxHp: 140, dir: 1, respawnTimer: 0 }
  ];

  return {
    tick: 0,
    time: 0,
    teamFunds: {
      allied: 500,
      enemy: 500
    },
    hqs: {
      allied: { team: "allied", x: BASES.allied.hqX, hp: BASES.allied.maxHp, maxHp: BASES.allied.maxHp },
      enemy: { team: "enemy", x: BASES.enemy.hqX, hp: BASES.enemy.maxHp, maxHp: BASES.enemy.maxHp }
    },
    players: {},
    bunkers,
    projectiles: [],
    paratroopers: [],
    flares: [],
    targets,
    events: [],
    nextEntityId: 1
  };
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
    rotorPhase: 0
  };
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

export function swapPlayerAircraft(state, playerId, nextType = null) {
  const player = state.players[playerId];
  if (!player || !player.alive || !player.landedAtBase) return false;

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
  player.turnTimer = 0;
  player.turnDuration = cfg.turnDuration;
  player.dir = player.team === "allied" ? 1 : -1;
  player.burstReservoir = BURST_MAX_TICKS;
  player.primaryCooldown = 0;
  player.primaryIdleTicks = 0;
  player.secondaryCooldown = 0;
  player.flareCooldown = 0;
  state.events.push({ type: "aircraft_swapped", playerId, aircraftType: targetType, tick: state.tick });
  return true;
}

export function handlePlayerUtility(state, playerId) {
  const player = state.players[playerId];
  if (!player || !player.alive || player.aircraftType !== "heli") return false;

  // On ground at base: manually load/unload infantry troops
  if (player.y <= 3 && isOnFriendlyPad(player)) {
    if (player.passengers.length < player.cabinCapacity) {
      player.passengers.push("infantry");
      state.events.push({ type: "troop_loaded", playerId, count: player.passengers.length, tick: state.tick });
      return true;
    }
    return false;
  }

  // Airborne: drop 1 paratrooper from cabin
  if (player.y > 10 && player.passengers.length > 0) {
    const unitKind = player.passengers.pop();
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

function updateP47(state, player, input, dt) {
  const cfg = AIRCRAFT_CONFIG.p47;
  const hInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const vInput = (input.up ? 1 : 0) - (input.down ? 1 : 0);

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
    player.airborneTime = 0;

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
      if (player.hp <= 0) return "crash";
    }

    player.vx = player.dir * player.speed;
    player.x = clamp(player.x + player.vx * dt, MIN_X + 80, MAX_X - 80);

    // Liftoff once above takeoff speed and pulling Up
    if (vInput > 0 && player.speed >= cfg.takeoffSpeed) {
      player.y = 4;
      player.pitch = 0.22;
      player.vy = player.speed * Math.sin(player.pitch);
    }
    player.rotorPhase += dt * (player.speed > 20 ? 22 : 10);
    return "ok";
  }

  // Airborne flight!
  player.airborneTime += dt;
  player.rotorPhase += dt * 24;

  // Wide U-turn with continuous horizontal momentum: vx(p) = startDir * startSpeed * cos(pi * p)
  if (player.turnTimer > 0) {
    player.turnTimer += dt;
    const p = Math.min(1, player.turnTimer / cfg.turnDuration);
    const speed = Math.max(cfg.stallSpeed, player.turnStartSpeed);
    player.vx = player.turnStartDir * speed * Math.cos(Math.PI * p);
    // Gentle banking altitude arc through the U-turn
    player.vy = 26 * Math.PI * Math.cos(Math.PI * p) / cfg.turnDuration;
    player.pitch = 0;
    player.x = clamp(player.x + player.vx * dt, MIN_X + 80, MAX_X - 80);
    player.y = clamp(player.y + player.vy * dt, 18, CEILING_Y);
    if (player.turnTimer >= cfg.turnDuration) {
      player.turnTimer = 0;
      player.dir = -player.turnStartDir;
      player.speed = speed;
      player.vx = player.dir * speed;
    }
    return "ok";
  }

  // Left/Right controls horizontal thrust & U-turn; no Left/Right decelerates via drag
  if (hInput === player.dir) {
    player.speed = Math.min(cfg.maxSpeed, player.speed + cfg.accelRate * dt);
  } else if (hInput === -player.dir) {
    if (player.speed >= cfg.stallSpeed * 0.75) {
      player.turnTimer = dt;
      player.turnStartDir = player.dir;
      player.turnStartSpeed = player.speed;
      return "ok";
    }
    // Too slow for a high-speed bank -> keep decelerating or flip when near zero
    player.speed = Math.max(0, player.speed - cfg.dragDecelRate * 1.5 * dt);
    if (player.speed < 20) player.dir = hInput;
  } else {
    player.speed = Math.max(0, player.speed - cfg.dragDecelRate * dt);
  }

  // Up/Down ONLY changes pitch & vertical direction without changing scalar airspeed
  if (vInput !== 0) {
    player.pitch = clamp(player.pitch + vInput * cfg.pitchRate * dt, -cfg.maxPitch, cfg.maxPitch);
  } else {
    player.pitch *= Math.pow(0.10, dt);
  }

  // Aerodynamic lift vs stall gravity sink when speed drops below stallSpeed
  const lift = clamp(player.speed / cfg.stallSpeed, 0, 1);
  if (lift < 1) {
    player.stallVy = Math.max(-420, (player.stallVy || 0) - GRAVITY * (1 - lift * lift) * dt);
    player.pitch = Math.max(-cfg.maxPitch, player.pitch - 0.5 * (1 - lift) * dt);
  } else {
    player.stallVy = (player.stallVy || 0) * Math.pow(0.02, dt);
  }

  // Shallow, long-wavelength vertical sine-wave cruise oscillation (scaled by lift)
  const waveVelY = Math.cos(player.airborneTime * cfg.sineOmega) * cfg.sineAmpVel * lift;
  const wavePitch = Math.cos(player.airborneTime * cfg.sineOmega) * cfg.sinePitchAmp * lift;
  const effectivePitch = clamp(player.pitch + (vInput === 0 ? wavePitch : 0), -cfg.maxPitch, cfg.maxPitch);

  player.vx = player.dir * player.speed * Math.cos(effectivePitch);
  player.vy = player.speed * Math.sin(effectivePitch) + player.stallVy + (vInput === 0 ? waveVelY : 0);

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // Auto U-turn softly at world edges
  if (player.x >= MAX_X - 180 && player.dir === 1) {
    player.x = MAX_X - 180;
    player.turnTimer = dt;
    player.turnStartDir = 1;
    player.turnStartSpeed = Math.max(cfg.stallSpeed, player.speed);
  } else if (player.x <= MIN_X + 180 && player.dir === -1) {
    player.x = MIN_X + 180;
    player.turnTimer = dt;
    player.turnStartDir = -1;
    player.turnStartSpeed = Math.max(cfg.stallSpeed, player.speed);
  }

  if (player.y <= 0) {
    const impactVy = Math.max(0, -player.vy);
    const impactVx = Math.abs(player.vx);
    const momentumSpeed = Math.hypot(impactVx, impactVy);
    const onStrip = isOnFriendlyPad(player);

    if (onStrip) {
      if (impactVy > cfg.safeLandingVy || Math.abs(player.pitch) > cfg.safeLandingPitch) {
        const excessVy = Math.max(0, impactVy - cfg.safeLandingVy);
        const excessPitch = Math.max(0, Math.abs(player.pitch) - cfg.safeLandingPitch);
        const dmg = (excessVy * 0.75 + excessPitch * 90) * (0.6 + momentumSpeed / 320);
        player.hp = Math.max(0, player.hp - dmg);
        state.events.push({ type: "hard_landing", playerId: player.id, x: player.x, damage: dmg, onStrip: true, tick: state.tick });
        if (player.hp <= 0) return "crash";
      }
      player.y = 0;
      player.vy = 0;
      player.stallVy = 0;
      player.pitch = 0;
      player.speed = impactVx;
    } else {
      // Touching ground outside friendly airstrip deals proportional impact & momentum damage
      const dmg = (24 + impactVy * 0.95) * (0.55 + momentumSpeed / 280);
      player.hp = Math.max(0, player.hp - dmg);
      state.events.push({ type: "hard_landing", playerId: player.id, x: player.x, damage: dmg, onStrip: false, tick: state.tick });
      if (player.hp <= 0) return "crash";
      player.y = 0;
      player.vy = 0;
      player.stallVy = 0;
      player.pitch = 0;
      player.speed = impactVx * 0.7;
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

export function stepSimulation(state, inputsByPlayer = {}) {
  state.tick += 1;
  state.time = state.tick * DT;
  state.events = [];

  // 1. Update Players
  for (const player of Object.values(state.players)) {
    if (!player.alive) {
      player.respawnTicks -= 1;
      if (player.respawnTicks <= 0) {
        const base = BASES[player.team];
        const cfg = AIRCRAFT_CONFIG[player.aircraftType];
        player.alive = true;
        player.x = base.padCenterX;
        player.y = 0;
        player.vx = 0;
        player.vy = 0;
        player.speed = 0;
        player.stallVy = 0;
        player.pitch = 0;
        player.dir = player.team === "allied" ? 1 : -1;
        player.hp = cfg.maxHp;
        player.secondaryAmmo = cfg.maxSecondary;
        player.flaresAmmo = cfg.maxFlares;
        player.burstReservoir = BURST_MAX_TICKS;
        player.turnTimer = 0;
        player.landedAtBase = true;
        if (player.aircraftType === "heli") {
          player.passengers = ["infantry", "infantry", "infantry", "infantry"];
        }
        state.events.push({ type: "player_respawned", playerId: player.id, tick: state.tick });
      }
      continue;
    }

    const input = inputsByPlayer[player.id] || {};
    const status = player.aircraftType === "heli"
      ? updateHeli(player, input, DT)
      : updateP47(state, player, input, DT);

    if (status === "crash") {
      player.alive = false;
      player.hp = 0;
      player.respawnTicks = 180; // 3s respawn
      state.teamFunds[player.team] = Math.max(0, state.teamFunds[player.team] - 100);
      state.events.push({ type: "player_crashed", playerId: player.id, x: player.x, y: player.y, tick: state.tick });
      continue;
    }

    player.landedAtBase = player.y <= 0.5 && isOnFriendlyPad(player) && Math.abs(player.vx) < 25;
    if (player.landedAtBase) {
      // Auto-repair & silent ammo/flare reload (no popup!)
      if (player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + 100 * DT);
      }
      player.resupplyTicks += 1;
      if (player.resupplyTicks >= 30) {
        player.resupplyTicks = 0;
        if (player.secondaryAmmo < player.maxSecondary) player.secondaryAmmo += 1;
        if (player.flaresAmmo < player.maxFlares) player.flaresAmmo += 1;
      }
    } else {
      player.resupplyTicks = 0;
    }

    updateWeapons(state, player, input);
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

  // 3. Update Projectiles (straight-line fuel tracking, gravity cutoff & hit detection)
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
    } else if (pr.kind === "heli_bomb") {
      pr.vy -= GRAVITY * DT;
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
    } else {
      // bullet
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
    }

    let hit = false;

    // Unified air-or-ground collision for bullets & P-47 missiles
    if (pr.kind === "bullet" || pr.kind === "p47_missile") {
      for (const other of Object.values(state.players)) {
        if (!other.alive || other.team === pr.team) continue;
        const dx = pr.x - other.x;
        const dy = pr.y - (other.y + 22);
        if (dx * dx + dy * dy <= 34 * 34) {
          other.hp = Math.max(0, other.hp - pr.damage);
          hit = true;
          state.events.push({ type: "explosion", x: pr.x, y: pr.y, size: pr.kind === "p47_missile" ? 1.2 : 0.4, tick: state.tick });
          break;
        }
      }
    }

    if (!hit) {
      for (const t of state.targets) {
        if (t.hp <= 0 || t.team === pr.team) continue;
        if (Math.abs(pr.x - t.x) <= 58 && pr.y >= 0 && pr.y <= 52) {
          // Rear-armor bonus check for tanks when struck from behind
          const hitFromBehind = (t.dir === 1 && pr.vx > 0) || (t.dir === -1 && pr.vx < 0);
          const dmg = hitFromBehind && pr.kind !== "bullet" ? Math.round(pr.damage * 1.75) : pr.damage;
          t.hp = Math.max(0, t.hp - dmg);
          if (t.hp === 0) t.respawnTimer = 6;
          hit = true;
          state.events.push({
            type: "explosion",
            x: pr.x,
            y: Math.max(12, pr.y),
            size: pr.kind === "bullet" ? 0.35 : 1.3,
            rearHit: hitFromBehind && pr.kind !== "bullet",
            tick: state.tick
          });
          break;
        }
      }
    }

    if (!hit && pr.y <= 0) {
      hit = true;
      state.events.push({
        type: "explosion",
        x: pr.x,
        y: 6,
        size: pr.kind === "bullet" ? 0.25 : 1.0,
        tick: state.tick
      });
    }

    if (hit || pr.lifeTicks <= 0 || pr.x < MIN_X - 300 || pr.x > MAX_X + 300 || pr.y > CEILING_Y + 400) {
      state.projectiles.splice(i, 1);
    }
  }

  // 4. Update Flares
  for (let i = state.flares.length - 1; i >= 0; i--) {
    const fl = state.flares[i];
    fl.lifeTicks -= 1;
    fl.vy -= 45 * DT;
    fl.x += fl.vx * DT;
    fl.y = Math.max(0, fl.y + fl.vy * DT);
    if (fl.lifeTicks <= 0) state.flares.splice(i, 1);
  }

  // 5. Update Paratroopers (Descent -> Chute Collapse -> March to nearest Bunker)
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
