export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const WORLD_WIDTH = 12000;
export const MIN_X = -6000;
export const MAX_X = 6000;
export const GROUND_Y = 0;
export const CEILING_Y = 1200;

// P-47 straight missile fuel distance: exact 1/3 of map width
export const MISSILE_FUEL_DISTANCE = WORLD_WIDTH / 3; // 4000m
export const GRAVITY = 380;

// 60 Hz Primary Gun Burst-Fire Reservoir constants
export const BURST_MAX_TICKS = 90;         // 1.5s rapid fire buffer
export const BURST_FIRE_INTERVAL = 5;      // 12 shots/sec while reservoir > 0
export const SLOW_FIRE_INTERVAL = 30;      // 1 shot per 0.5s once empty
export const BURST_RECHARGE_DELAY = 120;   // 2.0s trigger-off wait before recharge
export const BURST_RECHARGE_RATE = 3;      // refills 90 ticks in 30 ticks (0.5s)

// Base & Map Landmarks
export const BASES = {
  allied: {
    team: "allied",
    hqX: -5400,
    padMinX: -5680,
    padMaxX: -5040,
    padCenterX: -5320,
    siloX: -5760,
    maxHp: 5000
  },
  enemy: {
    team: "enemy",
    hqX: 5400,
    padMinX: 5040,
    padMaxX: 5680,
    padCenterX: 5320,
    siloX: 5760,
    maxHp: 5000
  }
};

export const BUNKER_X_POSITIONS = [-3600, -1800, 0, 1800, 3600];

// Aircraft Stats & Physics Tuning
export const AIRCRAFT_CONFIG = {
  heli: {
    id: "heli",
    label: "Attack & Transport Helicopter",
    maxHp: 350,
    maxSpeedX: 280,
    maxSpeedY: 210,
    accelX: 520,
    accelY: 560,
    maxSecondary: 12,
    secondaryCooldownTicks: 18,
    maxFlares: 4,
    flareCooldownTicks: 45,
    cabinCapacity: 8,
    turnDuration: 0.54,
    idleSinkSpeed: 24,
    primarySpeed: 1050,
    primaryAngleDeg: 0, // straight out front of cockpit (tilts with pitch)
    primaryDamage: 14,
    secondaryDamage: 145,
    hitRadius: 34
  },
  p47: {
    id: "p47",
    label: "P-47 Thunderbolt",
    maxHp: 300,
    cruiseSpeed: 420,
    maxSpeed: 540,
    accelRate: 260,
    dragDecelRate: 135,
    stallSpeed: 220,
    minGlideSpeed: 175,
    maxDivePitch: -0.62,
    takeoffSpeed: 195,
    safeLandingVy: 45,
    safeLandingPitch: 0.26,
    crashSlideTicks: 66,
    maxPitch: 0.56,
    pitchRate: 1.9,
    maxSecondary: 8,
    secondaryCooldownTicks: 22,
    maxFlares: 6,
    flareCooldownTicks: 45,
    cabinCapacity: 0,
    turnDuration: 0.80,
    sineOmega: 1.15,        // long horizontal wavelength
    sineAmpVel: 18,         // gentle vertical velocity wave
    sinePitchAmp: 0.032,    // subtle matching nose pitch
    primarySpeed: 1250,
    primaryDamage: 16,
    missileSpeed: 820,
    missileDamage: 160,
    hitRadius: 30
  }
};

// Canonical Section 9 Render Pixel Heights at 1.0x Camera Zoom
export const RENDER_HEIGHTS = {
  infantry: 22,
  civilian: 22,
  civilianFlare: 26.4,
  paratrooper: 62,
  paraCollapse: 26,
  heliFly: 74,
  heliTurn: 70,
  p47Fly: 54,
  p47Turn1: 86,
  p47Turn2: 108,
  p47Turn3: 114,
  b52: 90,
  mbt: 46,
  howitzer: 68,
  apc: 50,
  aaTruck: 58,
  ambulance: 52,
  supplyTruck: 50,
  bunker: 96,
  baseHq: 155,
  v2Silo: 135
};

// Requisition Menu Catalog (Keys 1-9 & 0)
export const REQUISITION_MENU = [
  { key: "1", id: "infantry", name: "Infantry Squad", cost: 50, phase: 2 },
  { key: "2", id: "aa_truck", name: "AA Flak / SAM Truck", cost: 150, phase: 2 },
  { key: "3", id: "apc", name: "Armored APC", cost: 225, phase: 2 },
  { key: "4", id: "mbt", name: "Main Battle Tank", cost: 400, phase: 2 },
  { key: "5", id: "howitzer", name: "Self-Propelled Howitzer", cost: 650, phase: 2 },
  { key: "6", id: "ambulance", name: "Field Ambulance", cost: 120, phase: 2 },
  { key: "7", id: "supply_truck", name: "Supply / Ammo Truck", cost: 200, phase: 2 },
  { key: "8", id: "b52_raid", name: "B-52 Carpet Raid", cost: 750, phase: 2 },
  { key: "9", id: "v2_missile", name: "Steerable V2 Missile", cost: 850, phase: 2 },
  { key: "0", id: "swap_aircraft", name: "Swap Aircraft (at Base)", cost: 0, phase: 1 }
];
