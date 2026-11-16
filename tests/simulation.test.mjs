import assert from "node:assert/strict";
import test from "node:test";
import {
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
  stepSimulation,
  swapPlayerAircraft
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
