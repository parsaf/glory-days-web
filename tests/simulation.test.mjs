import assert from "node:assert/strict";
import test from "node:test";
import { SpriteBattlefieldRenderer } from "../public/js/renderer.mjs";
import {
  AIRCRAFT_CONFIG,
  BASES,
  BURST_FIRE_INTERVAL,
  BURST_MAX_TICKS,
  BURST_RECHARGE_DELAY,
  MISSILE_FUEL_DISTANCE,
  SLOW_FIRE_INTERVAL
} from "../shared/constants.mjs";
import {
  addPlayer,
  createInitialState,
  handlePlayerUtility,
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

test("P-47 has gentle vertical sine-wave cruise motion and wide U-turn horizontal momentum", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "p47");
  player.x = -1000;
  player.y = 350;
  player.vx = 440;
  player.dir = 1;

  // Cruise with no input for 1 second -> vertical velocity oscillates smoothly (not zero)
  const ys = [];
  for (let t = 0; t < 60; t++) {
    stepSimulation(state, { p1: {} });
    ys.push(player.y);
  }
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  assert.ok(maxY - minY > 3, "P-47 gently oscillates vertically instead of flying flat");

  // Trigger wide U-turn by pressing Left while flying Right
  const xAtTurnStart = player.x;
  stepSimulation(state, { p1: { left: true } });
  assert.ok(player.turnTimer > 0, "P-47 starts U-turn");

  // Early in U-turn (first ~20 ticks), plane still moves forward (+vx) due to horizontal momentum
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

test("P-47 accelerates on Left/Right, changes pitch only on Up/Down, and stalls from glide into angled nose-dive (never vertical drop)", () => {
  const state = createInitialState({ includePracticeTargets: false });
  const player = addPlayer(state, "p1", "allied", "p47");
  player.x = -1000;
  player.y = 800;
  player.speed = 360;
  player.vx = 360;
  player.dir = 1;

  // Hold Right -> accelerates
  stepSimulation(state, { p1: { right: true } });
  const speedAfterThrust = player.speed;
  assert.ok(speedAfterThrust > 360, "Right arrow accelerates plane");

  // Release horizontal input, hold Down -> pitch becomes negative, scalar speed strictly decreases via drag
  for (let t = 0; t < 15; t++) stepSimulation(state, { p1: { down: true } });
  assert.ok(player.pitch < -0.2, "Down arrow pitches nose down");
  assert.ok(player.speed < speedAfterThrust, "Without Left/Right input, speed decelerates even when pitching");

  // Continue with no Left/Right input until below stallSpeed -> enters angled glide-to-nose-dive with forward momentum
  for (let t = 0; t < 140; t++) stepSimulation(state, { p1: {} });
  assert.ok(player.speed < AIRCRAFT_CONFIG.p47.stallSpeed, "Plane decelerates below stall lift threshold");
  assert.ok(player.pitch < -0.40 && player.pitch >= AIRCRAFT_CONFIG.p47.maxDivePitch - 0.01, "Nose enters angled dive rather than straight vertical fall");
  assert.ok(player.vx > 120, "Plane retains forward dive velocity instead of dropping straight out of the sky");
  assert.ok(player.vy < -50, "Plane loses altitude along the dive angle");
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

test("Dev P-47 config tuning, delay parameters (throttleReleaseDelay, stallGlideDelay), and test spawner work cleanly", () => {
  try {
    const updated = updateP47Config({
      throttleReleaseDelay: 0.40,
      stallGlideDelay: 0.50,
      glidePitch: -0.15,
      maxDivePitch: -0.70,
      cruiseSpeed: 440,
      ignoreUnknownKey: 999
    });
    assert.equal(updated.throttleReleaseDelay, 0.40);
    assert.equal(updated.stallGlideDelay, 0.50);
    assert.equal("ignoreUnknownKey" in updated, false);

    const state = createInitialState({ includePracticeTargets: false });
    const p1 = addPlayer(state, "p1", "allied", "heli");

    // 1. Spawn in Air switches aircraft from Heli -> P-47 at tuned cruiseSpeed
    assert.equal(spawnPlayerP47Test(state, "p1", "air"), true);
    assert.equal(p1.aircraftType, "p47");
    assert.equal(p1.speed, 440);
    assert.ok(p1.y > 200);

    // During throttleReleaseDelay (0.40s -> test 18 ticks = 0.30s), speed does not bleed yet
    for (let t = 0; t < 18; t++) stepSimulation(state, { p1: {} });
    assert.equal(p1.speed, 440, "Speed holds steady while inside throttleReleaseDelay grace window");

    // Past throttleReleaseDelay (another 18 ticks -> total 0.60s > 0.40s), drag reduces airspeed
    for (let t = 0; t < 18; t++) stepSimulation(state, { p1: {} });
    assert.ok(p1.speed < 440, "Aerodynamic drag engages once throttleReleaseDelay elapses");

    // 2. Test stallGlideDelay: enter below stallSpeed and check pitch stays shallow during glide window
    p1.speed = 180;
    p1.pitch = -0.14;
    for (let t = 0; t < 20; t++) stepSimulation(state, { p1: {} }); // 0.33s < 0.50s stallGlideDelay
    assert.ok(p1.pitch > -0.22, "Plane stays in shallow glide during stallGlideDelay window");

    for (let t = 0; t < 45; t++) stepSimulation(state, { p1: {} }); // well past 0.50s stallGlideDelay
    assert.ok(p1.pitch < -0.35, "Plane deepens into nose-dive after stallGlideDelay expires");

    // 3. Spawn on Runway places P-47 resting on friendly base pad at 0 speed
    assert.equal(spawnPlayerP47Test(state, "p1", "runway"), true);
    assert.equal(p1.x, BASES.allied.padCenterX);
    assert.equal(p1.y, 0);
    assert.equal(p1.speed, 0);
  } finally {
    const resetCfg = updateP47Config({ reset: true });
    assert.equal(resetCfg.throttleReleaseDelay, 0.20);
    assert.equal(resetCfg.stallGlideDelay, 0.30);
    assert.equal(resetCfg.cruiseSpeed, 420);
  }
});
