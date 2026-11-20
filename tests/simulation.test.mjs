import assert from "node:assert/strict";
import test from "node:test";
import { SpriteBattlefieldRenderer } from "../public/js/renderer.mjs";
import {
  AIRCRAFT_CONFIG,
  AUTO_PRODUCTION_COOLDOWN_TICKS,
  AUTO_PRODUCTION_PATTERN,
  BASE_INCOME_PER_SEC,
  BASES,
  BUNKER_INCOME_PER_SEC,
  BURST_FIRE_INTERVAL,
  BURST_MAX_TICKS,
  BURST_RECHARGE_DELAY,
  CIVILIAN_KILL_PENALTY,
  DEFAULT_BUNKER_CONFIG,
  DEFAULT_GROUND_BEHAVIOR_CONFIG,
  DEFAULT_UNIT_CONFIG,
  DEFENSE_CONFIG,
  GROUND_BEHAVIOR_CONFIG,
  MISSILE_FUEL_DISTANCE,
  SLOW_FIRE_INTERVAL,
  STRATEGIC_CONFIG,
  UNIT_CONFIG
} from "../shared/constants.mjs";
import {
  addPlayer,
  calculateCivilianPayout,
  computeBotPilotInput,
  configureMatch,
  createInitialState,
  createNetworkSnapshot,
  getGroundConfigSnapshot,
  getGroundUnitFireCooldown,
  getGroundUnitSpeedMultiplier,
  handlePlayerRequisition,
  handlePlayerUtility,
  planSamInterception,
  reconcileClientState,
  removePlayer,
  resetMatch,
  returnToLobby,
  setAutoProduction,
  setPlayerLobbyChoice,
  spawnCivilian,
  spawnGroundUnit,
  spawnPlayerP47Test,
  startMatch,
  stepSimulation,
  swapPlayerAircraft,
  syncBotPlayers,
  updateGroundConfig,
  updateP47Config
} from "../shared/simulation.mjs";

test("Primary gun (A) burst reservoir fires 12/s for 90 ticks, drops to 1/0.5s, and recharges after 120 idle ticks", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "heli");
  player.y = 200; // airborne

  let burstShots = 0;
  for (let t = 0; t < BURST_MAX_TICKS; t++) {
    stepSimulation(state, { p1: { firePrimary: true } });
    if (state.events.some((e) => e.type === "primary_fired")) burstShots++;
  }
  assert.equal(player.burstReservoir, 0);
  // Fires on ticks 0, 5, 10, ..., 85 -> 90 / 5 = 18 rapid shots
  assert.equal(burstShots, BURST_MAX_TICKS / BURST_FIRE_INTERVAL);

  // Hold A for another 90 ticks while empty -> fires slow sustained rate (every 30 ticks)
  let slowShots = 0;
  for (let t = 0; t < 90; t++) {
    stepSimulation(state, { p1: { firePrimary: true } });
    if (state.events.some((e) => e.type === "primary_fired")) slowShots++;
  }
  assert.equal(slowShots, 90 / SLOW_FIRE_INTERVAL);

  // Release trigger for 119 ticks -> should not recharge yet
  for (let t = 0; t < BURST_RECHARGE_DELAY - 1; t++) {
    stepSimulation(state, { p1: { firePrimary: false } });
  }
  assert.equal(player.burstReservoir, 0);

  // Hold off for 31 more ticks -> triggers recharge after 120 idle ticks and fills to 90
  for (let t = 0; t < 31; t++) {
    stepSimulation(state, { p1: { firePrimary: false } });
  }
  assert.equal(player.burstReservoir, BURST_MAX_TICKS);
});

test("P-47 straight-trajectory missile flies straight for 4000m (1/3 map) before burning out and falling", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "p47");
  player.x = -5000;
  player.y = 500;
  player.vx = 440;
  player.pitch = 0;
  player.effectivePitch = 0;

  stepSimulation(state, { p1: { fireSecondary: true } });
  const missile = state.projectiles.find((p) => p.kind === "p47_missile");
  assert.ok(missile, "P-47 missile spawned");
  assert.equal(missile.fuelBurnedOut, false);
  assert.equal(missile.maxFuelDistance, MISSILE_FUEL_DISTANCE);

  const startX = missile.x;
  const startY = missile.y;
  const initVx = missile.vx;
  const initVy = missile.vy;
  let burnoutTick = -1;
  for (let t = 0; t < 400; t++) {
    stepSimulation(state, { p1: {} });
    if (missile.fuelBurnedOut && burnoutTick === -1) {
      burnoutTick = t;
      break;
    }
    assert.equal(missile.vx, initVx, "Missile preserves straight X velocity before fuel burnout");
    assert.equal(missile.vy, initVy, "Missile preserves straight Y velocity before fuel burnout");
    const slope = (missile.y - startY) / (missile.x - startX);
    assert.ok(Math.abs(slope - initVy / initVx) < 1e-9, "Missile follows exact straight line before burnout");
  }

  assert.ok(burnoutTick > 0, "Missile runs out of fuel after 1/3 map width");
  assert.ok(missile.distanceTraveled >= MISSILE_FUEL_DISTANCE);

  const vyAtBurnout = missile.vy;
  for (let t = 0; t < 20; t++) stepSimulation(state, { p1: {} });
  const projectedStraightY = startY + (initVy / initVx) * (missile.x - startX);
  assert.ok(missile.vy < vyAtBurnout, "Missile accelerates downward under gravity after fuel burnout");
  assert.ok(missile.y < projectedStraightY - 5, "Missile drops below straight trajectory line after fuel burnout");
});

test("P-47 has gentle vertical sine-wave cruise motion and wide U-turn horizontal momentum after braking to min speed", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "p47");
  player.x = -1000;
  player.y = 350;
  player.speed = 440;
  player.vx = 440;
  player.dir = 1;

  // Stage 1 throttle cruise for 1 second -> vertical sine-wave oscillates smoothly with zero passive sink
  const ys = [];
  for (let t = 0; t < 60; t++) {
    stepSimulation(state, { p1: { right: true } });
    ys.push(player.y);
  }
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  assert.ok(maxY - minY > 3, "P-47 gently oscillates vertically instead of flying flat");

  // Brake to minGlideSpeed using opposite key, then trigger wide U-turn at minGlideSpeed
  while (player.speed > AIRCRAFT_CONFIG.p47.minGlideSpeed + 1 && player.turnTimer === 0) {
    stepSimulation(state, { p1: { left: true } });
  }
  if (player.turnTimer === 0) {
    stepSimulation(state, { p1: {} });
    stepSimulation(state, { p1: { left: true } });
  }
  assert.ok(player.turnTimer > 0, "P-47 starts U-turn once slowed to minimum flight speed");

  // Early in U-turn, plane still carries forward momentum (+vx)
  const xAtTurnStart = player.x;
  for (let t = 0; t < 12; t++) stepSimulation(state, { p1: {} });
  assert.ok(player.x > xAtTurnStart, "P-47 carries forward horizontal momentum into the U-turn");
  assert.ok(player.vx > 0);

  // Finish U-turn (48 ticks total = 0.8s)
  for (let t = 0; t < 40; t++) stepSimulation(state, { p1: {} });
  assert.equal(player.turnTimer, 0);
  assert.equal(player.dir, -1);
  assert.ok(player.vx < 0, "P-47 accelerates out in the opposite direction");
});

test("Base landing auto-repairs/reloads without modal and manual Q->0 swaps aircraft only at Base", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "heli");

  // Airborne cannot swap aircraft
  player.y = 120;
  stepSimulation(state, { p1: {} });
  assert.equal(player.landedAtBase, false);
  assert.equal(swapPlayerAircraft(state, "p1"), false);

  // Landed on Base pad repairs, reloads, and allows manual swap via Q->0
  player.y = 0;
  player.vx = 0;
  player.vy = 0;
  player.hp = 200;
  player.secondaryAmmo = 2;
  player.flaresAmmo = 1;

  for (let t = 0; t < 60; t++) stepSimulation(state, { p1: {} });
  assert.equal(player.landedAtBase, true);
  assert.ok(player.hp > 280, "Base pad repairs HP");
  assert.equal(player.secondaryAmmo, 4, "Base pad reloads secondary ammo every 0.5s");
  assert.equal(player.flaresAmmo, 3, "Base pad reloads flares every 0.5s");

  assert.equal(swapPlayerAircraft(state, "p1"), true);
  assert.equal(player.aircraftType, "p47");
  assert.equal(swapPlayerAircraft(state, "p1"), true);
  assert.equal(player.aircraftType, "heli");
});

test("Helicopter E-key drops paratroopers that transition through chute collapse to capture bunkers", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "heli");
  player.x = -1800; // directly above neutral bunker 1
  player.y = 80;

  assert.equal(handlePlayerUtility(state, "p1"), true);
  assert.equal(player.passengers.length, 3);
  assert.equal(state.paratroopers.length, 1);
  assert.equal(state.paratroopers[0].phase, "descent");

  // Simulate until paratrooper lands, collapses chute, and captures bunker
  let sawCollapse = false;
  for (let t = 0; t < 180; t++) {
    stepSimulation(state, { p1: {} });
    if (state.paratroopers[0]?.phase === "collapse") sawCollapse = true;
  }
  assert.ok(sawCollapse, "Paratrooper enters chute-collapse transition upon landing");
  assert.equal(state.bunkers[1].owner, "allied", "Dropped paratrooper captures neutral bunker");
});

test("Helicopter free-drops bombs straight down when hovering and inherits exact chopper momentum when moving", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "heli");
  player.x = 0;
  player.y = 300;
  player.vx = 0;
  player.vy = 0;

  // Hovering bomb drop -> zero horizontal speed (drops straight down)
  stepSimulation(state, { p1: { fireSecondary: true } });
  const hoverBomb = state.projectiles.find((p) => p.kind === "heli_bomb");
  assert.ok(hoverBomb);
  assert.equal(hoverBomb.vx, 0, "Hovering chopper bomb has 0 horizontal velocity");

  // Moving forward bomb drop -> inherits helicopter momentum
  state.projectiles = [];
  player.secondaryCooldown = 0;
  player.vx = 240;
  player.vy = 15;
  stepSimulation(state, { p1: { right: true, up: true, fireSecondary: true } });
  const movingBomb = state.projectiles.find((p) => p.kind === "heli_bomb");
  assert.ok(movingBomb);
  assert.ok(movingBomb.vx > 200, "Moving chopper transfers forward horizontal momentum to bomb");
  assert.equal(movingBomb.vx, player.vx);
});

test("Helicopter primary cannon shoots straight out front at 0 deg + pitch, and tilts nose-down when moving left or right", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "heli");
  player.x = 0;
  player.y = 300;
  player.vx = 0;
  player.vy = 0;
  player.pitch = 0;

  // Flat hover -> fires horizontally straight ahead (vy === 0)
  stepSimulation(state, { p1: { firePrimary: true } });
  const flatShot = state.projectiles.find((p) => p.kind === "bullet");
  assert.ok(flatShot);
  assert.ok(Math.abs(flatShot.vy) < 1e-6, "Flat chopper primary gun shoots straight ahead at 0 deg");

  // Tilted nose-down -> fires downward at exact same pitch angle
  state.projectiles = [];
  player.primaryCooldown = 0;
  player.vx = 240;
  player.pitch = -0.2;
  stepSimulation(state, { p1: { right: true, firePrimary: true } });
  const pitchedShot = state.projectiles.find((p) => p.kind === "bullet");
  assert.ok(pitchedShot);
  assert.ok(pitchedShot.vy < -50, "Pitched chopper shoots downward along cockpit pitch");

  // Left travel tilt verification in renderer: moving left must tilt nose-down (positive canvas angle inside flipped ctx)
  const renderer = new SpriteBattlefieldRenderer({ getContext: () => ({}) });
  const rightFrame = renderer.getAircraftFrame({ aircraftType: "heli", dir: 1, pitch: -0.22, rotorPhase: 0, turnTimer: 0 });
  const leftFrame = renderer.getAircraftFrame({ aircraftType: "heli", dir: -1, pitch: -0.22, rotorPhase: 0, turnTimer: 0 });
  assert.equal(rightFrame.flipX, false);
  assert.equal(leftFrame.flipX, true);
  assert.ok(rightFrame.angle > 0, "Right-moving chopper pitches nose down");
  assert.ok(leftFrame.angle > 0, "Left-moving chopper also pitches nose down in flipped canvas space");
});

test("Airborne idle helicopter gently sinks under gravity until landing", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "heli");
  player.x = BASES.allied.padCenterX;
  player.y = 60;
  player.vy = 0;

  for (let t = 0; t < 180; t++) {
    stepSimulation(state, { p1: {} });
  }
  assert.ok(player.y < 20, "Idle helicopter slowly sinks toward ground under gravity");
  assert.ok(player.vy <= 0);
});

test("P-47 speed reaches maxSpeed on throttle, drops to cruiseSpeed off-throttle, shaves on opposite taps, turns at min speed, and progresses through 4 speed-independent vertical stages", () => {
  const cfg = AIRCRAFT_CONFIG.p47;
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "p47");
  player.x = -2000;
  player.y = 850;
  player.speed = cfg.cruiseSpeed;
  player.vx = cfg.cruiseSpeed;
  player.dir = 1;

  // 1. Throttling accelerates up to maxSpeed (Stage 1)
  for (let t = 0; t < 60; t++) stepSimulation(state, { p1: { right: true } });
  assert.equal(player.flightStage, 1);
  assert.equal(Math.round(player.speed), cfg.maxSpeed, "Holding throttle reaches top speed");

  // 2. Releasing throttle drops speed from maxSpeed down to cruiseSpeed and stops at cruiseSpeed
  for (let t = 0; t < 120; t++) stepSimulation(state, { p1: {} });
  assert.equal(Math.round(player.speed), cfg.cruiseSpeed, "Off-throttle drops down to cruiseSpeed floor");

  // 3. Tapping opposite key shaves speed step-by-step down toward minGlideSpeed (below cruiseSpeed stays below cruiseSpeed)
  stepSimulation(state, { p1: { left: true } });
  const speedAfterOneTap = player.speed;
  assert.ok(speedAfterOneTap <= cfg.cruiseSpeed - cfg.brakeTapStep, "Opposite tap shaves off brakeTapStep");
  stepSimulation(state, { p1: {} }); // release -> should NOT climb back up to cruiseSpeed
  assert.equal(player.speed, speedAfterOneTap, "Speed already below cruiseSpeed stays below cruiseSpeed off-throttle");

  // Finish shaving/holding down to minGlideSpeed without overshooting into turn
  player.speed = cfg.minGlideSpeed + 25;
  stepSimulation(state, { p1: {} }); // release transition reset
  stepSimulation(state, { p1: { left: true } });
  stepSimulation(state, { p1: {} });
  assert.equal(Math.round(player.speed), cfg.minGlideSpeed, "Opposite braking bottoms out at minimum flight speed");
  assert.equal(player.turnTimer, 0, "Brief tap reaching minimum flight speed pauses before turning");

  // Now already at minGlideSpeed -> tapping opposite direction immediately triggers U-turn
  stepSimulation(state, { p1: { left: true } });
  assert.ok(player.turnTimer > 0, "Fresh opposite tap at minimum flight speed turns plane around");
  for (let t = 0; t < 55; t++) stepSimulation(state, { p1: {} });
  assert.equal(player.turnTimer, 0);
  assert.equal(player.dir, -1);

  // 4. Vertical 4-Stage Progression (independent of horizontal speed — tested at cruiseSpeed AND minGlideSpeed)
  for (const testSpeed of [cfg.cruiseSpeed, cfg.minGlideSpeed]) {
    player.dir = 1;
    player.speed = testSpeed;
    player.vx = testSpeed;
    player.y = 900;
    player.pitch = 0;
    player.throttleOffTime = 0;
    player.stallTime = 0;
    player.prevHInput = 0;

    // Stage 2: grace period lift off-throttle -> holding Up tilts up and gains elevation
    const yStage2Start = player.y;
    for (let t = 0; t < 25; t++) stepSimulation(state, { p1: { up: true } });
    assert.equal(player.flightStage, 2, `Off-throttle begins in Stage 2 grace period at speed=${testSpeed}`);
    assert.ok(player.pitch > 0.2, "Up arrow tilts up in Stage 2");
    assert.ok(player.y > yStage2Start + 10, "Up arrow still gains elevation during Stage 2 grace lift");

    // Advance past throttleReleaseDelay into Stage 3 (slow descent, slight nose-down tilt)
    while (player.flightStage < 3) stepSimulation(state, { p1: {} });
    assert.equal(player.flightStage, 3, `Enters Stage 3 slow descent at speed=${testSpeed}`);
    for (let t = 0; t < 35; t++) stepSimulation(state, { p1: {} });
    assert.ok(player.pitch < -0.10 && player.pitch >= cfg.glidePitch - 0.02, "Stage 3 tilts nose slightly down");
    const vyStage3NoUp = player.vy;
    assert.ok(vyStage3NoUp < -40, "Stage 3 descends slowly");

    // Holding Up in Stage 3 counteracts tilt slightly above level WITHOUT stopping descent
    for (let t = 0; t < 20; t++) stepSimulation(state, { p1: { up: true } });
    assert.ok(player.pitch > 0.04, "Up arrow in Stage 3 raises nose slightly above level");
    assert.equal(player.vy, -cfg.stallSinkGravity, "Counter-tilting with Up does NOT reduce Stage 3 descent rate");

    // Advance past stallGlideDelay into Stage 4 (faster descent, Down-arrow nose tilt)
    while (player.flightStage < 4) stepSimulation(state, { p1: {} });
    assert.equal(player.flightStage, 4, `Enters Stage 4 faster descent at speed=${testSpeed}`);
    for (let t = 0; t < 50; t++) stepSimulation(state, { p1: {} });
    assert.ok(player.pitch < -0.45, "Stage 4 tilts nose down steeply matching Down arrow");
    assert.equal(player.vy, -cfg.stage4SinkRate, "Stage 4 descends faster");

    // Holding Up in Stage 4 counteracts tilt toward level (0) WITHOUT stopping descent
    for (let t = 0; t < 40; t++) stepSimulation(state, { p1: { up: true } });
    assert.ok(Math.abs(player.pitch - cfg.stage4UpPitch) < 0.05, "Up arrow in Stage 4 levels the nose");
    assert.equal(player.vy, -cfg.stage4SinkRate, "Counter-tilting with Up does NOT reduce Stage 4 descent rate");

    // Only throttling restores Stage 1 full lift and stops passive descent!
    stepSimulation(state, { p1: { right: true } });
    assert.equal(player.flightStage, 1, "Throttling immediately restores Stage 1 full lift");
    assert.equal(player.stallVy, 0, "Throttling clears passive stall descent immediately");
    assert.ok(player.vy > -75, "Throttling breaks Stage 4 fast descent immediately");
    for (let t = 0; t < 45; t++) stepSimulation(state, { p1: { right: true } });
    assert.ok(player.vy >= -36, "Throttling stabilizes back into level sine-wave cruise");
  }
});

test("P-47 survivable ground touch bounces back up; fatal crash slides and destroys vehicles/troops in its path", () => {
  // 1. Moderate hard landing on friendly airstrip -> takes damage and bounces back up
  const state = createInitialState({ includePracticeTargets: false });
  const pStrip = addPlayer(state, "p1", "allied", "p47");
  pStrip.x = BASES.allied.padCenterX;
  pStrip.y = 1;
  pStrip.speed = 340;
  pStrip.vx = 340;
  pStrip.pitch = -0.34;
  stepSimulation(state, { p1: { down: true } });
  assert.equal(pStrip.alive, true, "Moderate hard landing survives with proportional damage");
  assert.ok(pStrip.hp < pStrip.maxHp, "Hard landing on airstrip inflicts proportional damage");
  assert.ok(pStrip.y > 1 && pStrip.vy > 40, "Survivable ground impact bounces plane back up");

  // 2. Survivable off-base ground touch -> takes proportional damage and bounces back up
  const stateOff = createInitialState({ includePracticeTargets: false });
  const pOff = addPlayer(stateOff, "pOff", "allied", "p47");
  pOff.x = 0; // middle of map, outside base
  pOff.y = 1;
  pOff.speed = 280;
  pOff.vx = 280;
  pOff.pitch = -0.18;
  for (let t = 0; t < 3; t++) {
    stepSimulation(stateOff, { pOff: { down: true } });
    if (pOff.hp < pOff.maxHp) break;
  }
  assert.ok(pOff.hp < pOff.maxHp && pOff.hp > 0, "Touching ground outside base deals proportional survivable damage");
  assert.ok(pOff.y > 1 && pOff.vy > 40, "Survivable off-base touch bounces plane back up");

  // 3. Fatal dive slam -> enters crash-landing slide, drags along ground, destroys vehicle + troop in path, then dies
  const stateCrash = createInitialState({ includePracticeTargets: false });
  stateCrash.targets.push({
    id: "victim_tank",
    kind: "main_battle_tank",
    team: "enemy",
    x: 110,
    y: 0,
    vx: 0,
    minX: 110,
    maxX: 110,
    hp: 650,
    maxHp: 650,
    dir: -1,
    respawnTimer: 0
  });
  stateCrash.paratroopers.push({
    id: "victim_troop",
    team: "enemy",
    kind: "infantry",
    x: 150,
    y: 0,
    vx: 0,
    vy: 0,
    dir: -1,
    phase: "march",
    collapseTimer: 0,
    walkPhase: 0,
    hp: 40
  });

  const pSlam = addPlayer(stateCrash, "p2", "allied", "p47");
  pSlam.x = 0;
  pSlam.y = 2;
  pSlam.hp = 60; // low enough that high-speed dive slam is fatal
  pSlam.speed = 520;
  pSlam.vx = 520;
  pSlam.pitch = -0.52;

  stepSimulation(stateCrash, { p2: { down: true } });
  assert.equal(pSlam.crashing, true, "Fatal impact begins crash-landing slide instead of instant vanish");
  assert.equal(pSlam.alive, true);

  const slideStartX = pSlam.x;
  for (let t = 0; t < 80; t++) {
    stepSimulation(stateCrash, { p2: {} });
  }
  assert.ok(pSlam.x > slideStartX + 80, "Crash-landing wreck drags forward along ground");
  assert.equal(stateCrash.targets[0].hp, 0, "Crash slide destroys ground vehicle in its path");
  assert.equal(stateCrash.paratroopers.length, 0, "Crash slide destroys ground troops in its path");
  assert.equal(pSlam.crashing, false);
  assert.equal(pSlam.alive, false, "Wreck detonates and starts respawn after slide completes");
});

test("Dev P-47 config tuning, 4-stage timers (throttleReleaseDelay, stallGlideDelay, brakeTapStep), and test spawner work cleanly", () => {
  try {
    const updated = updateP47Config({
      throttleReleaseDelay: 0.40,
      stallGlideDelay: 0.50,
      brakeTapStep: 60,
      glidePitch: -0.15,
      maxDivePitch: -0.60,
      cruiseSpeed: 400,
      maxSpeed: 560,
      ignoreUnknownKey: 999
    });
    assert.equal(updated.throttleReleaseDelay, 0.40);
    assert.equal(updated.stallGlideDelay, 0.50);
    assert.equal(updated.brakeTapStep, 60);
    assert.equal("ignoreUnknownKey" in updated, false);

    const state = createInitialState({ includePracticeTargets: false });
    const p1 = addPlayer(state, "p1", "allied", "heli");

    // 1. Spawn in Air switches aircraft from Heli -> P-47 at tuned maxSpeed, then coasts to cruiseSpeed off-throttle
    assert.equal(spawnPlayerP47Test(state, "p1", "air"), true);
    assert.equal(p1.aircraftType, "p47");
    assert.equal(p1.speed, 560);
    assert.ok(p1.y > 300);

    // 2. Test tuned Stage 2 grace period (0.40s) and Stage 3 slow-descent duration (0.50s)
    for (let t = 0; t < 18; t++) stepSimulation(state, { p1: {} }); // 0.30s < 0.40s Stage 2 grace
    assert.equal(p1.flightStage, 2, "Stays in Stage 2 grace period inside throttleReleaseDelay");

    for (let t = 0; t < 24; t++) stepSimulation(state, { p1: {} }); // 0.70s -> Stage 3 (stallTime = 0.30s < 0.50s)
    assert.equal(p1.flightStage, 3, "Transitions to Stage 3 slow descent after grace expires");
    assert.ok(p1.pitch > -0.22, "Stage 3 holds shallow glide pitch");

    for (let t = 0; t < 35; t++) stepSimulation(state, { p1: {} }); // past 0.40 + 0.50 = 0.90s -> Stage 4
    assert.equal(p1.flightStage, 4, "Transitions to Stage 4 faster descent after stallGlideDelay");
    assert.ok(p1.pitch < -0.35, "Stage 4 deepens nose-down tilt");

    // 3. Spawn on Runway places P-47 resting on friendly base pad at 0 speed
    assert.equal(spawnPlayerP47Test(state, "p1", "runway"), true);
    assert.equal(p1.x, BASES.allied.padCenterX);
    assert.equal(p1.y, 0);
    assert.equal(p1.speed, 0);
  } finally {
    const resetCfg = updateP47Config({ reset: true });
    assert.equal(resetCfg.throttleReleaseDelay, 1.10);
    assert.equal(resetCfg.stallGlideDelay, 1.40);
    assert.equal(resetCfg.cruiseSpeed, 380);
  }
});

test("Flight Lab scenarios (stall, brake, bounce, crash) and smooth wavePhase integration work seamlessly", () => {
  try {
    const state = createInitialState({ includePracticeTargets: true });
    const p1 = addPlayer(state, "p1", "allied", "heli");

    // 1. Stall scenario spawns at altitude and progresses Stage 2 -> Stage 3 -> Stage 4 off-throttle
    assert.equal(spawnPlayerP47Test(state, "p1", "stall"), true);
    assert.equal(p1.aircraftType, "p47");
    assert.ok(p1.y >= 450);
    for (let t = 0; t < 180; t++) stepSimulation(state, { p1: {} });
    assert.equal(Math.round(p1.speed), AIRCRAFT_CONFIG.p47.cruiseSpeed, "Off-throttle settles cleanly at cruiseSpeed");
    assert.equal(p1.flightStage, 4, "Hands-free progression reaches Stage 4");
    assert.ok(p1.pitch < -0.40, "Stage 4 nose tilts down");

    // 2. Brake scenario spawns at cruiseSpeed ready for opposite-key shaving & U-turn
    assert.equal(spawnPlayerP47Test(state, "p1", "brake"), true);
    assert.equal(p1.speed, AIRCRAFT_CONFIG.p47.cruiseSpeed);

    // 3. Bounce scenario hits ground hard enough to damage + rebound into air
    assert.equal(spawnPlayerP47Test(state, "p1", "bounce"), true);
    let bounced = false;
    for (let t = 0; t < 60; t++) {
      stepSimulation(state, { p1: {} });
      if (state.events.some((e) => e.type === "hard_landing" && e.bounced)) {
        bounced = true;
        break;
      }
    }
    assert.equal(bounced, true, "Bounce scenario triggers survivable ground bounce");
    assert.ok(p1.alive && p1.y > 0 && p1.vy > 20);

    // 4. Crash scenario triggers fatal slide and destroys spawned target in path
    assert.equal(spawnPlayerP47Test(state, "p1", "crash"), true);
    const startTargets = state.targets.filter((t) => t.hp > 0).length;
    let crashStarted = false;
    for (let t = 0; t < 120; t++) {
      stepSimulation(state, { p1: {} });
      if (state.events.some((e) => e.type === "crash_slide_start")) crashStarted = true;
    }
    assert.equal(crashStarted, true, "Crash scenario enters fatal crash slide");
    const remainingTargets = state.targets.filter((t) => t.hp > 0 && !t.respawnTimer).length;
    assert.ok(remainingTargets < startTargets || state.targets.some((t) => t.hp === 0), "Crash slide hits target ahead");

    // 5. Changing sineOmega mid-flight accumulates wavePhase incrementally with zero jump
    assert.equal(spawnPlayerP47Test(state, "p1", "air"), true);
    for (let t = 0; t < 60; t++) stepSimulation(state, { p1: { right: true } });
    const phaseBefore = p1.wavePhase;
    updateP47Config({ sineOmega: 2.4 });
    stepSimulation(state, { p1: { right: true } });
    const deltaPhase = p1.wavePhase - phaseBefore;
    assert.ok(Math.abs(deltaPhase - 2.4 / 60) < 1e-6, "wavePhase advances smoothly without teleporting on live sineOmega edit");
  } finally {
    updateP47Config({ reset: true });
  }
});

test("Phase 2: Shared Team War Funds income, bunker neutralization, HQ victory & rematch reset", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const p1 = addPlayer(state, "p1", "allied", "p47");

  // 1. Passive income tick at 60 ticks: $10 base with 0 bunkers
  const startAllied = state.teamFunds.allied;
  for (let t = 0; t < 60; t++) stepSimulation(state, { p1: {} });
  assert.equal(state.teamFunds.allied, startAllied + BASE_INCOME_PER_SEC);

  // Controlling 2 bunkers adds $6 each -> $22/sec
  state.bunkers[0].owner = "allied";
  state.bunkers[1].owner = "allied";
  const before2Bunkers = state.teamFunds.allied;
  for (let t = 0; t < 60; t++) stepSimulation(state, { p1: {} });
  assert.equal(state.teamFunds.allied, before2Bunkers + BASE_INCOME_PER_SEC + 2 * BUNKER_INCOME_PER_SEC);

  // 2. Enemy bunker neutralization (owner -> neutral when HP reaches 0)
  state.bunkers[2].owner = "enemy";
  state.bunkers[2].hp = 120;
  p1.x = -300;
  p1.y = 35;
  p1.dir = 1;
  p1.pitch = 0;
  p1.effectivePitch = 0;
  p1.speed = 420;
  p1.vx = 420;
  stepSimulation(state, { p1: { fireSecondary: true } });
  let neutralized = false;
  for (let t = 0; t < 45; t++) {
    stepSimulation(state, { p1: {} });
    if (state.events.some((e) => e.type === "bunker_neutralized")) neutralized = true;
  }
  assert.equal(neutralized, true, "Destroying enemy bunker emits bunker_neutralized");
  assert.equal(state.bunkers[2].owner, "neutral");
  assert.equal(state.bunkers[2].hp, 0);

  // 3. Destroying Enemy HQ declares Allied victory cleanly and resetMatch restores state
  state.hqs.enemy.hp = 100;
  p1.x = BASES.enemy.hqX - 350;
  p1.y = 45;
  p1.pitch = 0;
  p1.effectivePitch = 0;
  p1.secondaryCooldown = 0;
  stepSimulation(state, { p1: { fireSecondary: true } });
  for (let t = 0; t < 60; t++) {
    stepSimulation(state, { p1: {} });
    if (state.winner) break;
  }
  assert.equal(state.hqs.enemy.hp, 0);
  assert.equal(state.winner, "allied", "Destroying Enemy HQ sets state.winner = 'allied'");
  assert.equal(handlePlayerRequisition(state, "p1", "1"), false, "Cannot requisition after match ends");

  resetMatch(state);
  assert.equal(state.winner, null);
  assert.equal(state.hqs.enemy.hp, BASES.enemy.maxHp);
  assert.equal(state.teamFunds.allied, 500);
});

test("Phase 2: Requisition [1] Infantry captures bunkers & fights; [3] APC deploys 2 infantry at neutral bunker & on death", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const p1 = addPlayer(state, "p1", "allied", "heli");
  state.teamFunds.allied = 1000;

  // Tank [4] rolls past neutral bunker without capturing it
  const tank = handlePlayerRequisition(state, "p1", "4");
  assert.ok(tank);
  assert.equal(state.teamFunds.allied, 600);
  tank.x = state.bunkers[0].x - 30;
  for (let t = 0; t < 90; t++) stepSimulation(state, { p1: {} });
  assert.equal(state.bunkers[0].owner, "neutral", "MBT cannot capture neutral bunkers");

  // Infantry [1] captures neutral/0-HP bunker and restores 1,000 HP
  state.bunkers[0].hp = 0;
  const inf = handlePlayerRequisition(state, "p1", "1");
  assert.ok(inf);
  inf.x = state.bunkers[0].x - 40;
  for (let t = 0; t < 90; t++) stepSimulation(state, { p1: {} });
  assert.equal(state.bunkers[0].owner, "allied", "Infantry [1] captures neutralized bunker");
  assert.equal(state.bunkers[0].hp, 1000);

  // Armored APC [3] deploys 2 friendly Infantry on reaching neutral bunker
  const apc = handlePlayerRequisition(state, "p1", "3");
  assert.ok(apc);
  apc.x = state.bunkers[1].x - 75;
  for (let t = 0; t < 60; t++) stepSimulation(state, { p1: {} });
  const deployedAtBunker = state.units.filter((u) => u.team === "allied" && u.kind === "infantry");
  assert.ok(deployedAtBunker.length >= 1, "APC deploys 2 friendly infantry upon reaching neutral bunker");

  // Wait until deployed infantry capture bunker 1
  for (let t = 0; t < 120; t++) stepSimulation(state, { p1: {} });
  assert.equal(state.bunkers[1].owner, "allied");

  // APC [3] destroyed before reaching neutral bunker also deploys 2 infantry
  const apcDoomed = spawnGroundUnit(state, "enemy", "3", 2500);
  apcDoomed.hp = 0;
  stepSimulation(state, { p1: {} });
  const enemyInf = state.units.filter((u) => u.team === "enemy" && u.kind === "infantry");
  assert.equal(enemyInf.length, 2, "Destroyed APC deploys 2 infantry");
});

test("Phase 2: [2] AA Flak/SAM Truck fires unguided predictive SAMs, while Base AA fires guided SAMs spoofed by Z Flares", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const allied = addPlayer(state, "p1", "allied", "p47");
  allied.x = 500;
  allied.y = 320;
  allied.speed = 420;
  allied.vx = 420;

  const aa = spawnGroundUnit(state, "enemy", "2", 950);
  assert.ok(aa);

  // Step until enemy AA launches unguided SAM + triggers incoming AA warning
  let aaSam = null;
  for (let t = 0; t < 20; t++) {
    stepSimulation(state, { p1: { right: true } });
    aaSam = state.projectiles.find((pr) => pr.kind === "sam_missile" && pr.guided === false);
    if (aaSam) break;
  }
  assert.ok(aaSam, "Enemy AA truck fires unguided straight-line SAM missile at airborne aircraft");
  assert.ok(allied.aaWarningTicks > 0, "Targeted aircraft receives incoming AA SAM warning");

  // Deploying Z flares does NOT spoof AA truck's unguided SAM
  stepSimulation(state, { p1: { fireFlare: true } });
  assert.equal(aaSam.spoofedByFlareId, null, "Unguided AA SAM cannot be spoofed by flares");

  // Enemy Base AA protects enemy HQ with guided SAMs that trigger SAM LOCK and are spoofed by Z flares
  const baseState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const intruder = addPlayer(baseState, "p2", "allied", "heli");
  intruder.x = BASES.enemy.hqX - 500;
  intruder.y = 260;
  stepSimulation(baseState, { p2: {} });
  assert.ok(
    baseState.projectiles.some((pr) => pr.team === "enemy" && pr.kind === "sam_missile" && pr.guided === true),
    "Base AA fires guided SAM at enemy aircraft approaching Base HQ"
  );
  assert.ok(intruder.samWarningTicks > 0, "Base AA guided SAM triggers SAM LOCK warning");

  const hpBeforeFlare = intruder.hp;
  stepSimulation(baseState, { p2: { fireFlare: true } });
  let spoofed = false;
  let maxSingleTickDrop = 0;
  for (let t = 0; t < 90; t++) {
    const prevHp = intruder.hp;
    stepSimulation(baseState, { p2: {} });
    maxSingleTickDrop = Math.max(maxSingleTickDrop, prevHp - intruder.hp);
    if (baseState.events.some((e) => e.type === "sam_spoofed")) spoofed = true;
  }
  assert.equal(spoofed, true, "Active Z flares spoof Base AA guided SAM missile");
  assert.ok(maxSingleTickDrop < 75, "Guided SAM (75 dmg) never struck aircraft after flare spoof");
  assert.ok(intruder.hp <= hpBeforeFlare);
});

test("Phase 2: [4] MBT, [5] Howitzer rear-hit 1.75x & standoff, [7] Supply Truck +25 HP/s aura, Bunker defense", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const p1 = addPlayer(state, "p1", "allied", "heli");
  state.teamFunds.allied = 2000;

  // Howitzer [5] outranges MBT [4] and fires splash shells
  const howitzer = handlePlayerRequisition(state, "p1", "5");
  howitzer.x = 0;
  const enemyTank = spawnGroundUnit(state, "enemy", "4", 650);
  const enemyHpBefore = enemyTank.hp;
  for (let t = 0; t < 160; t++) stepSimulation(state, { p1: {} });
  assert.ok(enemyTank.hp < enemyHpBefore, "Howitzer engages enemy MBT from standoff range (650m)");

  // Rear-hit 1.75x damage on MBT in state.units (enemy tank facing -X, helicopter sweeps -X from behind)
  const rearTank = spawnGroundUnit(state, "enemy", "4", -1200);
  p1.x = -1050;
  p1.y = 140;
  p1.dir = -1;
  p1.vx = -200; // moving -X -> bomb hits enemy tank (dir = -1) from behind!
  stepSimulation(state, { p1: { fireSecondary: true } });
  let sawRearHit = false;
  for (let t = 0; t < 90; t++) {
    stepSimulation(state, { p1: {} });
    if (state.events.some((e) => e.type === "explosion" && e.rearHit)) sawRearHit = true;
  }
  assert.equal(sawRearHit, true, "Bombing ground MBT from behind triggers 1.75x rearHit");
  assert.equal(rearTank.hp, rearTank.maxHp - Math.round(AIRCRAFT_CONFIG.heli.secondaryDamage * 1.75));

  // Supply Truck [7] heals damaged friendly MBT at +25 HP/s
  const damagedMbt = spawnGroundUnit(state, "allied", "4", -3000);
  damagedMbt.hp = 300;
  const supply = handlePlayerRequisition(state, "p1", "7");
  supply.x = -3100;
  for (let t = 0; t < 120; t++) stepSimulation(state, { p1: {} }); // 2s = +50 HP
  assert.ok(damagedMbt.hp >= 348 && damagedMbt.hp <= 360, "Supply truck heals nearby friendly armor at +25 HP/s");

  // Captured bunker fires defensive shots at approaching enemy infantry
  state.bunkers[2].owner = "allied";
  state.bunkers[2].hp = 1000;
  const intruderInf = spawnGroundUnit(state, "enemy", "1", 250);
  for (let t = 0; t < 120; t++) stepSimulation(state, { p1: {} });
  assert.ok(intruderInf.hp < 40, "Captured bunker shoots approaching enemy units");
});

test("Phase 2: Civilian distress, Helicopter & [6] Ambulance rescue payout ($40N + $15N^2) & -$100 kill penalty", () => {
  assert.equal(calculateCivilianPayout(1), 55);
  assert.equal(calculateCivilianPayout(4), 400);
  assert.equal(calculateCivilianPayout(8), 1280);

  // 1. Helicopter low hover rescue + E doesn't drop civilians + pad unload payout
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const heli = addPlayer(state, "p1", "allied", "heli");
  heli.passengers = ["infantry"];
  heli.x = -900;
  heli.y = 4;
  heli.vx = 0;

  spawnCivilian(state, -830);
  spawnCivilian(state, -810);
  assert.equal(state.civilians[0].state, "wave");

  let sawTurn = false;
  let sawRun = false;
  for (let t = 0; t < 180; t++) {
    stepSimulation(state, { p1: {} });
    if (state.civilians.some((c) => c.state === "turn")) sawTurn = true;
    if (state.civilians.some((c) => c.state === "run")) sawRun = true;
    if (state.civilians.length === 0) break;
  }
  assert.ok(sawTurn && sawRun, "Civilian plays turn -> run transition before boarding");
  assert.equal(heli.passengers.filter((p) => p === "civilian").length, 2);

  // Dropping paratrooper airborne drops infantry, never rescued civilians
  heli.y = 120;
  assert.equal(handlePlayerUtility(state, "p1"), true);
  assert.equal(handlePlayerUtility(state, "p1"), false, "E key cannot drop rescued civilians as paratroopers");

  // Land on friendly pad -> automatic payout = 40*2 + 15*4 = $140
  const fundsBeforeUnload = state.teamFunds.allied;
  heli.x = BASES.allied.padCenterX;
  heli.y = 0;
  heli.vx = 0;
  stepSimulation(state, { p1: {} });
  assert.equal(state.teamFunds.allied, fundsBeforeUnload + calculateCivilianPayout(2));
  assert.equal(heli.passengers.length, 0);

  // 2. Field Ambulance [6] drives to civilian, boards, and returns to HQ for payout
  const ambState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  addPlayer(ambState, "p1", "allied", "p47");
  ambState.teamFunds.allied = 500;
  const amb = handlePlayerRequisition(ambState, "p1", "6");
  assert.ok(amb);
  amb.x = -4200;
  spawnCivilian(ambState, -3800);
  const fundsAfterBuy = ambState.teamFunds.allied;

  let rescuedByAmb = false;
  for (let t = 0; t < 1800; t++) {
    stepSimulation(ambState, { p1: {} });
    if (ambState.events.some((e) => e.type === "civilians_rescued" && e.by === "ambulance")) {
      rescuedByAmb = true;
      break;
    }
  }
  assert.equal(rescuedByAmb, true, "Ambulance drives to civilian, boards, and returns to HQ for payout");
  assert.ok(ambState.teamFunds.allied >= fundsAfterBuy + calculateCivilianPayout(1));

  // 3. Friendly-fire civilian kill deducts $100
  const penState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const shooter = addPlayer(penState, "p1", "allied", "heli");
  shooter.x = -980;
  shooter.y = 12;
  shooter.dir = 1;
  penState.teamFunds.allied = 400;
  spawnCivilian(penState, -900);
  for (let t = 0; t < 20; t++) {
    stepSimulation(penState, { p1: { firePrimary: true } });
    if (penState.civilians.length === 0) break;
  }
  assert.equal(penState.civilians.length, 0);
  assert.equal(penState.teamFunds.allied, 400 - CIVILIAN_KILL_PENALTY);
});

test("Phase 2: [8] B-52 Carpet Raid drops 24 bombs & is interceptable; [9] V2 Missile steers via arrows & deals AoE", () => {
  // 1. B-52 Carpet Bombing Raid drops 24 bombs across 1,500m target strip
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const p1 = addPlayer(state, "p1", "allied", "p47");
  state.teamFunds.allied = 1500;

  const b52 = handlePlayerRequisition(state, "p1", "8", { targetX: 1200 });
  assert.ok(b52);
  assert.equal(state.teamFunds.allied, 1500 - STRATEGIC_CONFIG.b52_raid.cost);
  b52.x = 380; // start just ahead of strip [450 .. 1950]

  let bombsDropped = 0;
  for (let t = 0; t < 320; t++) {
    stepSimulation(state, { p1: {} });
    bombsDropped += state.events.filter((e) => e.type === "b52_bomb_dropped").length;
  }
  assert.equal(bombsDropped, 24, "B-52 drops exact 24 carpet bombs across target zone");

  // Enemy P-47 can intercept and shoot down a B-52 mid-flight
  const b52Target = handlePlayerRequisition(state, "p1", "8", { targetX: 0 });
  b52Target.x = 0;
  b52Target.hp = 120;
  const interceptor = addPlayer(state, "e1", "enemy", "p47");
  interceptor.x = 260;
  interceptor.y = b52Target.y;
  interceptor.dir = -1;
  interceptor.vx = -420;
  interceptor.speed = 420;
  stepSimulation(state, { e1: { fireSecondary: true } });
  let shotDown = false;
  for (let t = 0; t < 45; t++) {
    stepSimulation(state, {});
    if (state.events.some((e) => e.type === "b52_destroyed")) shotDown = true;
  }
  assert.equal(shotDown, true, "Climbing P-47 can intercept and destroy B-52 mid-flight");

  // 2. Steerable V2 Cruise Missile transfers steering control & deals massive AoE
  const v2State = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const launcher = addPlayer(v2State, "p1", "allied", "heli");
  v2State.teamFunds.allied = 1000;
  const targetTank = spawnGroundUnit(v2State, "enemy", "4", 1200);
  targetTank.vx = 0;

  const v2 = handlePlayerRequisition(v2State, "p1", "9");
  assert.ok(v2);
  assert.equal(launcher.controllingV2Id, v2.id);
  assert.equal(v2State.teamFunds.allied, 1000 - STRATEGIC_CONFIG.v2_missile.cost);

  // Climb slightly then pitch down via ArrowDown to verify steering control
  for (let t = 0; t < 25; t++) stepSimulation(v2State, { p1: {} });
  const pitchBeforeSteer = v2.pitch;
  for (let t = 0; t < 18; t++) stepSimulation(v2State, { p1: { down: true, right: true } });
  assert.ok(v2.pitch < pitchBeforeSteer, "ArrowDown pitches V2 nose downward");
  assert.ok(v2.speed > STRATEGIC_CONFIG.v2_missile.speed, "ArrowRight accelerates V2 missile");

  // Place V2 above enemy tank diving down -> detonates and destroys tank with AoE
  v2.x = 1140;
  v2.y = 75;
  v2.pitch = -0.7;
  let detonated = false;
  for (let t = 0; t < 40; t++) {
    stepSimulation(v2State, { p1: { down: true } });
    if (v2State.events.some((e) => e.type === "v2_detonated")) {
      detonated = true;
      break;
    }
  }
  assert.equal(detonated, true, "Steerable V2 detonates on enemy armor");
  assert.equal(launcher.controllingV2Id, null, "Camera/control returns to player after V2 detonation");
  assert.equal(v2State.units.filter((u) => u.id === targetTank.id && u.hp > 0).length, 0);

  // V2 Cruise Missile is interceptable in mid-air
  v2State.teamFunds.allied = 1000;
  const v2Victim = handlePlayerRequisition(v2State, "p1", "9");
  v2Victim.x = 0;
  v2Victim.y = 400;
  v2Victim.pitch = 0;
  const defender = addPlayer(v2State, "e1", "enemy", "p47");
  defender.x = 240;
  defender.y = 400;
  defender.dir = -1;
  defender.vx = -420;
  defender.speed = 420;
  stepSimulation(v2State, { e1: { fireSecondary: true } });
  let intercepted = false;
  for (let t = 0; t < 35; t++) {
    stepSimulation(v2State, {});
    if (v2State.events.some((e) => e.type === "v2_intercepted")) intercepted = true;
  }
  assert.equal(intercepted, true, "Enemy aircraft can intercept launched V2 missile mid-flight");
});

test("Phase 3: Match modes (1v1, 2v2, 3v3) & dynamic bot slot auto-fill", () => {
  const state = createInitialState({ includePracticeTargets: false, matchMode: "1v1", botsEnabled: true });
  addPlayer(state, "h1", "allied", "heli", { isBot: false, callsign: "H1" });
  syncBotPlayers(state);

  const countTeam = (team) => Object.values(state.players).filter((p) => p.team === team).length;
  assert.equal(countTeam("allied"), 1);
  assert.equal(countTeam("enemy"), 1);
  assert.equal(Object.values(state.players).filter((p) => p.team === "enemy" && p.isBot).length, 1);

  configureMatch(state, { matchMode: "2v2" });
  assert.equal(countTeam("allied"), 2);
  assert.equal(countTeam("enemy"), 2);

  configureMatch(state, { matchMode: "3v3" });
  assert.equal(countTeam("allied"), 3);
  assert.equal(countTeam("enemy"), 3);

  // Adding a second human on allied replaces one allied bot slot cleanly
  addPlayer(state, "h2", "allied", "p47", { isBot: false, callsign: "H2" });
  syncBotPlayers(state);
  assert.equal(countTeam("allied"), 3);
  assert.equal(Object.values(state.players).filter((p) => p.team === "allied" && p.isBot).length, 1);

  // Removing h2 restores the bot slot; disabling bots removes all bots
  removePlayer(state, "h2");
  syncBotPlayers(state);
  assert.equal(countTeam("allied"), 3);
  assert.equal(Object.values(state.players).filter((p) => p.team === "allied" && p.isBot).length, 2);

  configureMatch(state, { botsEnabled: false });
  assert.equal(Object.values(state.players).filter((p) => p.isBot).length, 0);
});

test("Phase 3: AI Bot Commanders spend funds & AI pilots take off, fly sorties, and flare SAM locks", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false, matchMode: "2v2", botsEnabled: true });
  addPlayer(state, "h1", "allied", "heli", { isBot: false });
  syncBotPlayers(state);

  state.teamFunds.allied = 1000;
  state.teamFunds.enemy = 1000;

  // Step 120 ticks (2 seconds): bots should requisition units and take off from pads
  for (let t = 0; t < 120; t++) {
    stepSimulation(state, { h1: {} });
  }

  assert.ok(state.units.some((u) => u.team === "allied"), "Allied AI commander buys ground units");
  assert.ok(state.units.some((u) => u.team === "enemy"), "Enemy AI commander buys ground units");

  const bots = Object.values(state.players).filter((p) => p.isBot);
  assert.ok(bots.length >= 2);
  assert.ok(bots.some((b) => b.y > 20), "AI pilots lift off and fly airborne sorties");

  // SAM warning reflex triggers bot flare deployment
  const targetBot = bots[0];
  targetBot.y = 200;
  targetBot.samWarningTicks = 60;
  targetBot.flareCooldown = 0;
  const flaresBefore = targetBot.flaresAmmo;
  stepSimulation(state, { h1: {} });
  assert.equal(targetBot.flaresAmmo, flaresBefore - 1, "Bot pilot automatically deploys flare on SAM lock");
});

test("Phase 3: 20 Hz compact network snapshots and client-side prediction reconciliation", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const p1 = addPlayer(state, "p1", "allied", "p47");
  p1.x = -1234.56789;
  p1.y = 321.98765;
  p1.vx = 412.3456;

  const snap = createNetworkSnapshot(state, [{ type: "income_tick", team: "allied", income: 10, tick: 1 }]);
  assert.equal(snap.players.p1.x, -1234.57);
  assert.equal(snap.players.p1.y, 321.99);
  assert.equal(snap.players.p1.vx, 412.35);
  assert.equal(snap.events.length, 1);

  // Small discrepancy (< 180m) blends smoothly instead of hard snapping
  const localState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const localP = addPlayer(localState, "p1", "allied", "p47");
  localP.x = 100;
  localP.y = 200;
  localP.vx = 400;

  const serverState = createNetworkSnapshot(localState);
  serverState.players.p1.x = 140;
  serverState.players.p1.y = 220;

  const reconciled = reconcileClientState(localState, serverState, "p1");
  assert.ok(reconciled.players.p1.x > 100 && reconciled.players.p1.x < 140, "Blends small horizontal prediction drift");
  assert.ok(reconciled.players.p1.y > 200 && reconciled.players.p1.y < 220, "Blends small vertical prediction drift");

  // Large discrepancy (>= 180m) snaps directly to authoritative server state
  serverState.players.p1.x = 500;
  const snapped = reconcileClientState(localState, serverState, "p1");
  assert.equal(snapped.players.p1.x, 500, "Large discrepancy snaps cleanly to server position");
});

test("Phase 3 Lobby: holds match clock in lobby, applies team/aircraft/callsign choices, launches and returns cleanly", () => {
  const state = createInitialState({ phase: "lobby", roomId: "BRAVO", matchMode: "2v2", botsEnabled: true });
  addPlayer(state, "p1", "allied", "heli", { isBot: false, callsign: "P1" });
  syncBotPlayers(state);

  assert.equal(state.phase, "lobby");
  assert.equal(state.roomId, "BRAVO");

  // Stepping simulation in lobby phase must hold tick, funds, and units frozen
  for (let t = 0; t < 120; t++) {
    stepSimulation(state, { p1: { firePrimary: true, right: true } });
  }
  assert.equal(state.tick, 0, "Simulation tick stays paused at 0 during pre-match lobby");
  assert.equal(state.teamFunds.allied, 500);
  assert.equal(state.units.length, 0);

  // Player switches to Enemy team, P-47 Thunderbolt, callsign "ACE", and marks Ready
  const updated = setPlayerLobbyChoice(state, "p1", {
    team: "enemy",
    aircraftType: "p47",
    callsign: "ACE",
    ready: true
  });
  assert.equal(updated.team, "enemy");
  assert.equal(updated.aircraftType, "p47");
  assert.equal(updated.callsign, "ACE");
  assert.equal(updated.ready, true);
  assert.equal(updated.x, BASES.enemy.padCenterX);

  const alliedCount = Object.values(state.players).filter((p) => p.team === "allied").length;
  const enemyCount = Object.values(state.players).filter((p) => p.team === "enemy").length;
  assert.equal(alliedCount, 2, "Allied bots rebalance to 2 when p1 switches to Enemy");
  assert.equal(enemyCount, 2, "Enemy roster stays 2 total (1 human + 1 bot)");

  // Start match -> enters playing phase preserving choices and resumes simulation
  startMatch(state);
  assert.equal(state.phase, "playing");
  assert.equal(state.players.p1.team, "enemy");
  assert.equal(state.players.p1.aircraftType, "p47");
  assert.equal(state.players.p1.callsign, "ACE");

  stepSimulation(state, { p1: { left: true } });
  assert.equal(state.tick, 1, "Simulation advances normally once match starts");

  // Return to lobby -> resets match back to lobby phase
  returnToLobby(state);
  assert.equal(state.phase, "lobby");
  assert.equal(state.tick, 0);
  assert.equal(state.players.p1.ready, false);
});

test("Single-arrow takeoff assists & liftoff reconciliation allow immediate takeoff on P-47 and Helicopter", () => {
  // 1. P-47 takes off when holding ArrowUp alone from standstill on pad
  const sUp = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const pUp = addPlayer(sUp, "p1", "allied", "p47");
  for (let i = 0; i < 60; i++) {
    stepSimulation(sUp, { p1: { up: true } });
  }
  assert.ok(pUp.speed >= AIRCRAFT_CONFIG.p47.takeoffSpeed, "P-47 builds speed when holding Up alone");
  assert.ok(pUp.y > 4, "P-47 lifts off runway when holding Up alone");
  assert.ok(pUp.x > BASES.allied.padCenterX + 40, "P-47 moves forward during Up-only takeoff");

  // 2. P-47 auto-lifts off when holding ArrowRight alone once takeoffSpeed is reached
  const sRight = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const pRight = addPlayer(sRight, "p1", "allied", "p47");
  for (let i = 0; i < 60; i++) {
    stepSimulation(sRight, { p1: { right: true } });
  }
  assert.ok(pRight.y > 4, "P-47 automatically lifts off when holding Right past takeoffSpeed");

  // 3. Helicopter lifts into hover and moves horizontally when pressing ArrowRight alone on pad
  const sHeli = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const pHeli = addPlayer(sHeli, "p1", "allied", "heli");
  for (let i = 0; i < 30; i++) {
    stepSimulation(sHeli, { p1: { right: true } });
  }
  assert.ok(pHeli.y > 4, "Helicopter lifts off pad when pressing Right alone");
  assert.ok(pHeli.x > BASES.allied.padCenterX + 10, "Helicopter moves forward when pressing Right alone");

  // 4. Stale grounded server snapshot does not pull just-launched local client back to y = 0
  const localSt = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const lp = addPlayer(localSt, "p1", "allied", "p47");
  lp.y = 8;
  lp.vy = 60;
  lp.speed = 210;
  lp.flightStage = 1;
  const srvSt = createNetworkSnapshot(localSt);
  srvSt.players.p1.y = 0;
  srvSt.players.p1.vy = 0;
  srvSt.players.p1.flightStage = 2;
  const rec = reconcileClientState(localSt, srvSt, "p1");
  assert.equal(rec.players.p1.y, 8, "Just-launched client altitude is preserved against grounded server snapshot");
  assert.equal(rec.players.p1.flightStage, 1, "Local flightStage is preserved during reconciliation");
});

test("Network snapshots carry all state stepSimulation needs so client-side prediction never throws", () => {
  const server = createInitialState({ phase: "lobby", roomId: "ALPHA", matchMode: "1v1", botsEnabled: true });
  addPlayer(server, "p1", "allied", "heli", { isBot: false, callsign: "P1" });
  syncBotPlayers(server);
  startMatch(server);

  const wire = () => JSON.parse(JSON.stringify(createNetworkSnapshot(server)));
  let client = wire();
  for (const key of ["baseAa", "nextEntityId", "botThinkCooldown", "autoProduction", "autoProdCooldown", "autoProdCounter"]) {
    assert.ok(key in client, `snapshot includes ${key}`);
  }

  const inp = { right: true, up: true };
  for (let t = 0; t < 120; t++) {
    stepSimulation(server, { p1: inp });
    assert.doesNotThrow(() => stepSimulation(client, { p1: inp }), `client prediction tick ${t} must not throw`);
    if (t % 3 === 0) client = reconcileClientState(client, wire(), "p1");
  }
  assert.ok(client.players.p1.y > 20, "Predicted helicopter climbs on client");
  assert.ok(client.players.p1.x > BASES.allied.padCenterX + 50, "Predicted helicopter moves forward on client");
});

test("Auto troop production spawns primarily tanks and some AA flaks, works without bots, and toggles off", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false, botsEnabled: false });
  addPlayer(state, "p1", "allied", "heli");
  state.teamFunds.allied = 2500;

  // Off by default -> zero auto spawns
  for (let t = 0; t < 120; t++) stepSimulation(state, { p1: {} });
  assert.equal(state.units.length, 0, "No auto-produced units spawn when autoProduction is off");

  // Enable auto production for allied -> follows AUTO_PRODUCTION_PATTERN (3:1 tanks to AA)
  assert.equal(setAutoProduction(state, "allied", true), true);
  assert.ok(state.events.some((e) => e.type === "auto_production_toggled" && e.team === "allied" && e.enabled === true));

  const spawnedKinds = [];
  for (let t = 0; t < 3 * AUTO_PRODUCTION_COOLDOWN_TICKS + 10; t++) {
    stepSimulation(state, { p1: {} });
    for (const ev of state.events) {
      if (ev.type === "unit_requisitioned" && ev.auto && ev.team === "allied") {
        spawnedKinds.push(ev.unitKind);
      }
    }
  }

  assert.equal(spawnedKinds.length, 4, "Produces 4 units across 4 cooldown cycles");
  assert.deepEqual(spawnedKinds, ["main_battle_tank", "main_battle_tank", "aa_flak_truck", "main_battle_tank"]);
  assert.equal(spawnedKinds.filter((k) => k === "main_battle_tank").length, 3);
  assert.equal(spawnedKinds.filter((k) => k === "aa_flak_truck").length, 1);

  // Disable auto production -> stops spawning even with remaining funds
  const countBeforeOff = state.units.length;
  state.teamFunds.allied = 2500;
  assert.equal(setAutoProduction(state, "allied", false), false);
  for (let t = 0; t < 180; t++) stepSimulation(state, { p1: {} });
  assert.equal(state.units.length, countBeforeOff, "Stopping auto production halts automatic spawning");
});

test("AA Flak Truck SAMs respect visual range, travel in strict straight lines, predict intercepts, and select 3 speed profiles", () => {
  // 1. Visual range cutoff (> 750m -> no launch)
  const outState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const outHeli = addPlayer(outState, "p1", "allied", "heli");
  outHeli.x = -500;
  outHeli.y = 300;
  spawnGroundUnit(outState, "enemy", "2", 500); // dist > 1000m > 750m
  for (let t = 0; t < 90; t++) stepSimulation(outState, { p1: {} });
  assert.equal(outState.projectiles.filter((p) => p.kind === "sam_missile").length, 0, "No SAM launched outside visual LOS range");

  // 2. Profile selection across slow / medium / fast targets
  const slowTarget = { x: -300, y: 220, vx: 60, vy: 0, ref: { turnTimer: 0 } };
  const slowPlan = planSamInterception(0, 34, slowTarget, null, { damaged: false });
  assert.ok(slowPlan);
  assert.equal(slowPlan.profile, "slow");
  assert.equal(slowPlan.speed, UNIT_CONFIG.aa_truck.samSpeeds.slow);

  const medTarget = { x: -350, y: 260, vx: 280, vy: 0, ref: { turnTimer: 0 } };
  const medPlan = planSamInterception(0, 34, medTarget, null, { damaged: false });
  assert.ok(medPlan);
  assert.equal(medPlan.profile, "medium");
  assert.equal(medPlan.speed, UNIT_CONFIG.aa_truck.samSpeeds.medium);

  const fastTarget = { x: -450, y: 300, vx: 520, vy: 0, ref: { turnTimer: 0 } };
  const fastPlan = planSamInterception(0, 34, fastTarget, null, { damaged: false });
  assert.ok(fastPlan);
  assert.equal(fastPlan.profile, "fast");
  assert.equal(fastPlan.speed, UNIT_CONFIG.aa_truck.samSpeeds.fast);

  // 3. Straight-line trajectory & predictive intercept hit on moving helicopter
  const hitState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const movingHeli = addPlayer(hitState, "p1", "allied", "heli");
  movingHeli.x = -420;
  movingHeli.y = 220;
  movingHeli.vx = 95;
  movingHeli.vy = 0;
  const enemyAa = spawnGroundUnit(hitState, "enemy", "2", 120);
  enemyAa.speed = 0; // hold position to test pure intercept geometry

  stepSimulation(hitState, { p1: {} });
  const sam = hitState.projectiles.find((p) => p.kind === "sam_missile");
  assert.ok(sam, "AA truck launches predictive SAM inside visual range");
  assert.equal(sam.guided, false);
  const initVx = sam.vx;
  const initVy = sam.vy;
  const startX = sam.x;
  const startY = sam.y;
  const hpStart = movingHeli.hp;

  // Keep helicopter moving steadily at vx=95, vy=0 (bypass idle sink by tiny collective) and confirm straight line & hit
  let hitHeli = false;
  for (let t = 0; t < 150; t++) {
    movingHeli.vx = 95;
    movingHeli.vy = 0;
    movingHeli.y = 220;
    stepSimulation(hitState, { p1: {} });
    if (movingHeli.hp < hpStart) {
      hitHeli = true;
      break;
    }
    if (hitState.projectiles.includes(sam)) {
      assert.equal(sam.vx, initVx, "Unguided SAM keeps constant vx (straight line)");
      assert.equal(sam.vy, initVy, "Unguided SAM keeps constant vy (straight line)");
      const cross = (sam.x - startX) * initVy - (sam.y - startY) * initVx;
      assert.ok(Math.abs(cross) < 1e-4, "Unguided SAM moves along exact straight ray");
    }
  }
  assert.equal(hitHeli, true, "Predictive straight-line SAM intercepts steadily moving aircraft");
});

test("All ground troops except ambulances progress strictly forward toward enemy base without ever retreating", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  // Place enemy unit BEHIND allied spawn position and keep neutral bunkers behind
  spawnGroundUnit(state, "enemy", "1", -450);

  const alliedUnits = [
    spawnGroundUnit(state, "allied", "1", 100),
    spawnGroundUnit(state, "allied", "2", 100),
    spawnGroundUnit(state, "allied", "3", 100),
    spawnGroundUnit(state, "allied", "4", 100),
    spawnGroundUnit(state, "allied", "5", 100),
    spawnGroundUnit(state, "allied", "7", 100)
  ];
  // Landed allied paratrooper at x=100 (with neutral bunker_2 at 0 and bunker_1 at -1800 behind it!)
  state.paratroopers.push({
    id: "para_test_1",
    team: "allied",
    kind: "infantry",
    x: 100,
    y: 0,
    vx: 0,
    vy: 0,
    dir: 1,
    phase: "march",
    collapseTimer: 0,
    walkPhase: 0,
    hp: 40,
    maxHp: 40,
    fireCooldown: 0
  });

  const prevX = new Map(alliedUnits.map((u) => [u.id, u.x]));
  let prevParaX = 100;

  for (let t = 0; t < 180; t++) {
    stepSimulation(state, {});
    for (const u of alliedUnits) {
      if (u.hp <= 0 || !state.units.includes(u)) continue;
      assert.ok(u.x >= prevX.get(u.id) - 1e-9, `${u.kind} never moves backwards`);
      assert.ok(u.vx >= 0, `${u.kind} velocity is never negative`);
      assert.equal(u.dir, 1, `${u.kind} always faces toward enemy base`);
      prevX.set(u.id, u.x);
    }
    const para = state.paratroopers.find((p) => p.id === "para_test_1");
    if (para) {
      assert.ok(para.x >= prevParaX - 1e-9, "Marching paratrooper never retreats toward behind bunker");
      assert.equal(para.dir, 1);
      prevParaX = para.x;
    }
  }
  assert.ok(alliedUnits.every((u) => u.x > 150), "All allied non-ambulance units advance forward toward enemy HQ");

  // Ambulance CAN move in both directions (west to pick up civilian, east/west to return to HQ)
  const ambState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const amb = spawnGroundUnit(ambState, "allied", "6", -1000);
  spawnCivilian(ambState, -1200);
  for (let t = 0; t < 90; t++) stepSimulation(ambState, {});
  assert.ok(amb.x < -1050, "Ambulance is permitted to drive backwards (-X) to rescue stranded civilians");
});

test("Ambulances pass obstacles without stopping, are never targeted directly, and take shared crossfire damage inside hitboxes", () => {
  // 1. Obstacle-free movement & non-targeting by tanks, bunkers, infantry, and AI bots
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  state.bunkers[2].owner = "enemy";
  state.bunkers[2].hp = 1000;
  const enemyTank = spawnGroundUnit(state, "enemy", "4", -120);
  const enemyInf = spawnGroundUnit(state, "enemy", "1", -60);
  const amb = spawnGroundUnit(state, "allied", "6", -240);
  spawnCivilian(state, 350);

  for (let t = 0; t < 300; t++) {
    stepSimulation(state, {});
  }
  assert.ok(amb.x > 100, "Ambulance drives right past enemy tank, enemy infantry, and enemy bunker without stopping");
  assert.equal(amb.hp, amb.maxHp, "Enemy tanks, infantry, and bunkers do not target or damage lone ambulance");

  // Direct player cannon fire over an ambulance does not hit ambulance directly
  const heli = addPlayer(state, "p1", "enemy", "heli");
  heli.x = amb.x + 120;
  heli.y = 20;
  heli.dir = -1;
  for (let t = 0; t < 15; t++) stepSimulation(state, { p1: { firePrimary: true } });
  assert.equal(amb.hp, amb.maxHp, "Direct gunfire ignores ambulance when no combat target is hit");

  // AI bot aircraft does not fire at lone enemy ambulance
  const botHeli = addPlayer(state, "bot1", "enemy", "heli", { isBot: true });
  botHeli.x = amb.x + 150;
  botHeli.y = 125;
  botHeli.dir = -1;
  const botState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  spawnGroundUnit(botState, "allied", "6", 0);
  const botInput = computeBotPilotInput(botState, botHeli);
  assert.equal(botInput.firePrimary, false);
  assert.equal(botInput.fireSecondary, false);

  // 2. Tank duel crossfire: ambulance inside enemy tank's hitbox gets 50% shared damage; outside takes 0
  const duelState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const alliedTank = spawnGroundUnit(duelState, "allied", "4", -150);
  const rivalTank = spawnGroundUnit(duelState, "enemy", "4", 150);
  const ambInside = spawnGroundUnit(duelState, "allied", "6", 165); // within 52m hitbox of rivalTank at 150
  ambInside.passengers = []; // idle stationary
  const ambOutside = spawnGroundUnit(duelState, "allied", "6", 300); // outside hitbox

  let sawCrossfire = false;
  for (let t = 0; t < 80; t++) {
    ambInside.x = rivalTank.x + 15; // keep inside enemy tank hitbox during duel
    ambOutside.x = rivalTank.x + 150;
    stepSimulation(duelState, {});
    if (duelState.events.some((e) => e.type === "ambulance_crossfire" && e.unitId === ambInside.id)) {
      sawCrossfire = true;
      break;
    }
  }
  assert.equal(sawCrossfire, true, "Ambulance inside tank hitbox receives crossfire damage event");
  assert.equal(ambInside.hp, ambInside.maxHp - Math.round(UNIT_CONFIG.mbt.damage * 0.5), "Ambulance receives 50% shared crossfire damage");
  assert.equal(ambOutside.hp, ambOutside.maxHp, "Ambulance outside tank hitbox takes zero crossfire damage");
});

test("Ground units stop to shoot enemy troops/bunkers and AA flak trucks deal infantry damage to ground targets", () => {
  // 1. Infantry vs infantry encounter -> stop & shoot each other, survivor resumes
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const infA = spawnGroundUnit(state, "allied", "1", -160);
  const infE = spawnGroundUnit(state, "enemy", "1", 160);
  infE.hp = 18; // allied infantry wins in 2 hits

  let stoppedDuringFight = false;
  for (let t = 0; t < 180; t++) {
    stepSimulation(state, {});
    if (infA.hp > 0 && infE.hp > 0 && infA.vx === 0 && infE.vx === 0 && Math.abs(infE.x - infA.x) <= UNIT_CONFIG.infantry.range) {
      stoppedDuringFight = true;
    }
  }
  assert.equal(stoppedDuringFight, true, "Opposing infantry stop and shoot each other upon encountering");
  assert.equal(infE.hp, 0, "Enemy infantry destroyed in firefight");
  assert.ok(infA.hp > 0 && infA.vx > 0, "Surviving infantry resumes forward progression");

  // 2. AA Flak Truck engaging ground target deals exact infantry damage with light guns
  const aaState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const aa = spawnGroundUnit(aaState, "allied", "2", 0);
  const bunker = aaState.bunkers[2]; // at x = 0, give enemy ownership or place bunker ahead
  aaState.bunkers[2].owner = "neutral";
  const enemyTargetTank = spawnGroundUnit(aaState, "enemy", "4", 160);
  const hpBefore = enemyTargetTank.hp;

  stepSimulation(aaState, {});
  const aaBullet = aaState.projectiles.find((p) => p.ownerId === aa.id && p.kind === "bullet");
  assert.ok(aaBullet, "AA truck fires light gun bullet at ground enemy");
  assert.equal(aaBullet.damage, UNIT_CONFIG.infantry.damage, "AA truck ground light gun deals exact infantry damage (9)");
  assert.equal(aa.fireCooldown, UNIT_CONFIG.infantry.fireCooldownTicks, "AA truck uses infantry fire cooldown on ground guns");

  for (let t = 0; t < 25; t++) stepSimulation(aaState, {});
  assert.equal(enemyTargetTank.hp, hpBefore - UNIT_CONFIG.infantry.damage, "AA light gun inflicts exact infantry damage on impact");
});

test("Damaged ground units move slower, fire slower, and damaged AA fires only slow SAMs until repaired", () => {
  // 1. Damaged MBT moves slower and fires slower than healthy MBT
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const healthyMbt = spawnGroundUnit(state, "allied", "4", -3000);
  const damagedMbt = spawnGroundUnit(state, "allied", "4", -3000);
  damagedMbt.hp = Math.round(damagedMbt.maxHp * 0.2); // 20% HP

  assert.ok(getGroundUnitSpeedMultiplier(damagedMbt) < 1);
  assert.ok(getGroundUnitFireCooldown(UNIT_CONFIG.mbt.fireCooldownTicks, damagedMbt) > UNIT_CONFIG.mbt.fireCooldownTicks);

  for (let t = 0; t < 60; t++) stepSimulation(state, {});
  const healthyDist = healthyMbt.x - -3000;
  const damagedDist = damagedMbt.x - -3000;
  assert.ok(damagedDist > 0 && damagedDist < healthyDist * 0.75, "Damaged MBT advances noticeably slower than healthy MBT");

  // Fire rate comparison against enemy bunkers
  const fireState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  fireState.bunkers[1].owner = "enemy"; // x = -1800
  fireState.bunkers[1].hp = 5000;
  const hTank = spawnGroundUnit(fireState, "allied", "4", -2050);
  const dTank = spawnGroundUnit(fireState, "allied", "4", -2050);
  dTank.hp = Math.round(dTank.maxHp * 0.25);
  stepSimulation(fireState, {});
  assert.ok(dTank.fireCooldown > hTank.fireCooldown, "Damaged MBT has longer fire cooldown (slower rate of fire)");

  // 2. Damaged AA Flak Truck fires ONLY slow SAMs even vs fast P-47, and restores fast SAMs when repaired by Supply Truck
  const aaState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const fastJet = addPlayer(aaState, "p1", "allied", "p47");
  fastJet.x = -550;
  fastJet.y = 300;
  fastJet.speed = 520;
  fastJet.vx = 520;

  const damagedAa = spawnGroundUnit(aaState, "enemy", "2", 0);
  damagedAa.hp = 60; // damaged (< 140 maxHp)

  stepSimulation(aaState, { p1: { right: true } });
  const slowSam = aaState.projectiles.find((p) => p.kind === "sam_missile");
  assert.ok(slowSam, "Damaged AA still launches SAM within visual range");
  assert.equal(slowSam.samProfile, "slow", "Damaged AA fires ONLY slow SAM missiles even at fast P-47");
  assert.equal(slowSam.speed, UNIT_CONFIG.aa_truck.samSpeeds.slow);
  assert.ok(damagedAa.samCooldown > UNIT_CONFIG.aa_truck.samCooldownTicks, "Damaged AA reloads SAMs more slowly");

  // Repair AA back to full HP with Supply Truck aura -> fast SAM capability returns
  const supply = spawnGroundUnit(aaState, "enemy", "7", 50);
  assert.ok(supply);
  for (let t = 0; t < 240; t++) {
    fastJet.x = -550;
    fastJet.y = 300;
    fastJet.vx = 520;
    fastJet.speed = 520;
    damagedAa.x = 0;
    stepSimulation(aaState, { p1: { right: true } });
    if (damagedAa.hp >= damagedAa.maxHp) break;
  }
  assert.equal(damagedAa.hp, damagedAa.maxHp, "Supply truck heals damaged AA back to full HP");
  aaState.projectiles = [];
  damagedAa.samCooldown = 0;
  fastJet.x = -550;
  fastJet.y = 300;
  fastJet.vx = 520;
  fastJet.speed = 520;
  stepSimulation(aaState, { p1: { right: true } });
  const restoredSam = aaState.projectiles.find((p) => p.kind === "sam_missile");
  assert.ok(restoredSam, "Repaired AA fires SAM");
  assert.equal(restoredSam.samProfile, "fast", "Repaired AA regains fast SAM capability against fast targets");
});

test("Ground Troops Lab config patching (updateGroundConfig), HP/range sync, and selective resets work cleanly", () => {
  try {
    const updated = updateGroundConfig({
      units: {
        infantry: { maxHp: 85, damage: 15, canCaptureBunker: false, bogusKey: 999 },
        aa_truck: { visualRange: 920, samSpeeds: { slow: 350, fast: 900 } },
        apc: { deployTroopCount: 3 }
      },
      behavior: {
        damageDegradationEnabled: false,
        ambulanceTargetable: true,
        rearHitMultiplier: 2.25,
        unknownRule: true
      },
      bunker: {
        maxHp: 1400,
        damage: 22
      }
    });

    assert.equal(updated.units.infantry.maxHp, 85);
    assert.equal(updated.units.infantry.hp, 85, "maxHp syncs hp");
    assert.equal(updated.units.infantry.damage, 15);
    assert.equal(updated.units.infantry.canCaptureBunker, false);
    assert.equal("bogusKey" in updated.units.infantry, false);

    assert.equal(updated.units.aa_truck.visualRange, 920);
    assert.equal(updated.units.aa_truck.samRange, 920, "visualRange syncs samRange");
    assert.equal(updated.units.aa_truck.samSpeeds.slow, 350);
    assert.equal(updated.units.aa_truck.samSpeeds.medium, DEFAULT_UNIT_CONFIG.aa_truck.samSpeeds.medium);
    assert.equal(updated.units.aa_truck.samSpeeds.fast, 900);

    assert.equal(updated.units.apc.deployTroopCount, 3);
    assert.equal(updated.behavior.damageDegradationEnabled, false);
    assert.equal(updated.behavior.ambulanceTargetable, true);
    assert.equal(updated.behavior.rearHitMultiplier, 2.25);
    assert.equal("unknownRule" in updated.behavior, false);
    assert.equal(updated.bunker.maxHp, 1400);
    assert.equal(updated.bunker.damage, 22);

    // resetUnit restores only that unit
    const afterUnitReset = updateGroundConfig({ resetUnit: "infantry" });
    assert.equal(afterUnitReset.units.infantry.maxHp, DEFAULT_UNIT_CONFIG.infantry.maxHp);
    assert.equal(afterUnitReset.units.infantry.canCaptureBunker, true);
    assert.equal(afterUnitReset.units.aa_truck.visualRange, 920, "resetUnit keeps other unit overrides intact");

    // Full reset restores everything
    const afterFullReset = updateGroundConfig({ reset: true });
    assert.equal(afterFullReset.units.aa_truck.visualRange, DEFAULT_UNIT_CONFIG.aa_truck.visualRange);
    assert.equal(afterFullReset.units.aa_truck.samSpeeds.fast, DEFAULT_UNIT_CONFIG.aa_truck.samSpeeds.fast);
    assert.equal(afterFullReset.units.apc.deployTroopCount, DEFAULT_UNIT_CONFIG.apc.deployTroopCount);
    assert.equal(afterFullReset.behavior.damageDegradationEnabled, DEFAULT_GROUND_BEHAVIOR_CONFIG.damageDegradationEnabled);
    assert.equal(afterFullReset.behavior.ambulanceTargetable, DEFAULT_GROUND_BEHAVIOR_CONFIG.ambulanceTargetable);
    assert.equal(afterFullReset.bunker.maxHp, DEFAULT_BUNKER_CONFIG.maxHp);
  } finally {
    updateGroundConfig({ reset: true });
  }
});

test("Ground Troops Lab tunable rules, compact arena bounds, and dummy flags control ground unit behavior", () => {
  try {
    // 1. Disabling infantry bunker capture keeps neutral bunker neutral
    updateGroundConfig({ units: { infantry: { canCaptureBunker: false } } });
    const capState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
    const inf = spawnGroundUnit(capState, "allied", "1", capState.bunkers[2].x - 10);
    for (let t = 0; t < 30; t++) stepSimulation(capState, {});
    assert.equal(capState.bunkers[2].owner, "neutral", "Infantry does not capture bunker when canCaptureBunker=false");
    assert.ok(inf.x > capState.bunkers[2].x, "Infantry marches past neutral bunker when capture is disabled");

    // 2. Tunable APC deployTroopCount deploys 3 infantry on destruction
    updateGroundConfig({ units: { apc: { deployTroopCount: 3 } } });
    const apcState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
    const apc = spawnGroundUnit(apcState, "allied", "3", 0);
    assert.equal(apc.troopsCarried, 3);
    apc.hp = 0;
    stepSimulation(apcState, {});
    assert.equal(apcState.units.filter((u) => u.team === "allied" && u.kind === "infantry").length, 3);

    // 3. Disabling damageDegradationEnabled removes speed & cooldown penalties on damaged units
    updateGroundConfig({ behavior: { damageDegradationEnabled: false } });
    const degState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
    const damagedTank = spawnGroundUnit(degState, "allied", "4", 0);
    damagedTank.hp = 100;
    assert.equal(getGroundUnitSpeedMultiplier(damagedTank), 1);
    assert.equal(getGroundUnitFireCooldown(UNIT_CONFIG.mbt.fireCooldownTicks, damagedTank), UNIT_CONFIG.mbt.fireCooldownTicks);

    // 4. Enabling ambulanceTargetable lets enemy troops target and damage ambulances
    updateGroundConfig({ behavior: { ambulanceTargetable: true } });
    const ambTargetState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
    const amb = spawnGroundUnit(ambTargetState, "allied", "6", -100);
    amb.holdPosition = true;
    const enemyInf = spawnGroundUnit(ambTargetState, "enemy", "1", 40);
    enemyInf.holdPosition = true;
    for (let t = 0; t < 40; t++) stepSimulation(ambTargetState, {});
    assert.ok(amb.hp < amb.maxHp, "Enemy unit targets and damages ambulance when ambulanceTargetable=true");

    // 5. Compact arena bounds & compact HQ position allow quick ambulance rescue & unit clamping
    updateGroundConfig({ reset: true });
    const compactState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
    compactState.worldBounds = { minX: -1000, maxX: 1000 };
    compactState.bunkers = [];
    compactState.hqs.allied.x = -860;
    compactState.hqs.enemy.x = 860;

    const rescueAmb = spawnGroundUnit(compactState, "allied", "6", -600);
    spawnCivilian(compactState, 0, 0);
    const runner = spawnGroundUnit(compactState, "allied", "2", 850);
    let rescued = false;
    for (let t = 0; t < 1600; t++) {
      stepSimulation(compactState, {});
      assert.ok(runner.x <= 1000 - 60 + 1e-6, "Units clamp inside compact arena maxX");
      if (compactState.events.some((e) => e.type === "civilians_rescued" && e.by === "ambulance")) {
        rescued = true;
        break;
      }
    }
    assert.equal(rescued, true, "Ambulance rescues midfield civilian and delivers to compact Allied HQ");
    assert.ok(rescueAmb.x <= -600, "Ambulance returned near compact Allied HQ");

    // 6. holdPosition and passiveDummy keep enemy dummy stationary and non-firing
    const dummyState = createInitialState({ includePracticeTargets: false, includeCivilians: false });
    dummyState.bunkers = [];
    const dummy = spawnGroundUnit(dummyState, "enemy", "4", 200);
    dummy.holdPosition = true;
    dummy.passiveDummy = true;
    const alliedScout = spawnGroundUnit(dummyState, "allied", "1", 0);
    alliedScout.holdPosition = true;
    for (let t = 0; t < 90; t++) stepSimulation(dummyState, {});
    assert.equal(dummy.x, 200, "holdPosition dummy remains stationary");
    assert.equal(alliedScout.hp, alliedScout.maxHp, "passiveDummy never fires at opposing units");
  } finally {
    updateGroundConfig({ reset: true });
  }
});
