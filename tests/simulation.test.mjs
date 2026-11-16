import assert from "node:assert/strict";
import test from "node:test";
import { SpriteBattlefieldRenderer } from "../public/js/renderer.mjs";
import {
  AIRCRAFT_CONFIG,
  BASE_INCOME_PER_SEC,
  BASES,
  BUNKER_INCOME_PER_SEC,
  BURST_FIRE_INTERVAL,
  BURST_MAX_TICKS,
  BURST_RECHARGE_DELAY,
  CIVILIAN_KILL_PENALTY,
  MISSILE_FUEL_DISTANCE,
  SLOW_FIRE_INTERVAL,
  STRATEGIC_CONFIG
} from "../shared/constants.mjs";
import {
  addPlayer,
  calculateCivilianPayout,
  createInitialState,
  handlePlayerRequisition,
  handlePlayerUtility,
  resetMatch,
  spawnCivilian,
  spawnGroundUnit,
  spawnPlayerP47Test,
  stepSimulation,
  swapPlayerAircraft,
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

test("Phase 2: [2] AA Flak/SAM Truck triggers SAM LOCK, Z Flares spoof SAMs, and Base AA defends HQ", () => {
  const state = createInitialState({ includePracticeTargets: false, includeCivilians: false });
  const allied = addPlayer(state, "p1", "allied", "p47");
  allied.x = 500;
  allied.y = 320;
  allied.speed = 420;
  allied.vx = 420;

  const aa = spawnGroundUnit(state, "enemy", "2", 950);
  assert.ok(aa);

  // Step until enemy AA launches SAM + triggers SAM warning
  let samFired = false;
  for (let t = 0; t < 20; t++) {
    stepSimulation(state, { p1: { right: true } });
    if (state.projectiles.some((pr) => pr.kind === "sam_missile")) {
      samFired = true;
      break;
    }
  }
  assert.equal(samFired, true, "Enemy AA truck fires homing SAM missile at airborne aircraft");
  assert.ok(allied.samWarningTicks > 0, "Targeted aircraft receives SAM LOCK warning");

  // Deploy Z flares -> SAM locks onto decoy flare and detonates harmlessly
  const hpBeforeFlare = allied.hp;
  stepSimulation(state, { p1: { fireFlare: true } });
  let spoofed = false;
  for (let t = 0; t < 90; t++) {
    stepSimulation(state, { p1: { right: true } });
    if (state.events.some((e) => e.type === "sam_spoofed")) spoofed = true;
  }
  assert.equal(spoofed, true, "Active Z flares spoof incoming SAM missile");
  assert.ok(allied.hp >= hpBeforeFlare - 15, "SAM never struck aircraft after flare spoof");

  // Enemy Base AA protects enemy HQ against loitering allied aircraft
  const intruder = addPlayer(state, "p2", "allied", "heli");
  intruder.x = BASES.enemy.hqX - 500;
  intruder.y = 260;
  stepSimulation(state, { p2: {} });
  assert.ok(
    state.projectiles.some((pr) => pr.team === "enemy" && (pr.kind === "sam_missile" || pr.kind === "flak_shell")),
    "Base AA fires SAM/Flak at enemy aircraft approaching Base HQ"
  );
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
