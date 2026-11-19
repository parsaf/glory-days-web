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
    cruiseSpeed: 380,
    maxSpeed: 540,
    accelRate: 260,
    throttleReleaseDelay: 1.10, // Stage 2 grace period lift duration (s)
    dragDecelRate: 160,
    brakeTapStep: 45,           // Speed shaved on each opposite-key tap (px/s)
    brakeDecelRate: 500,        // Continuous braking when holding opposite key (px/s^2)
    turnHoldThreshold: 0.14,    // Opposite-key hold at min speed before U-turn (s)
    stallSpeed: 220,
    minGlideSpeed: 230,         // Minimum flight speed & turnaround speed floor
    stallGlideDelay: 1.40,      // Stage 3 slow-descent duration before Stage 4 (s)
    glidePitch: -0.18,          // Stage 3 slight nose-down tilt (rad)
    maxDivePitch: -0.56,        // Stage 4 nose-down tilt matching -maxPitch (rad)
    stage3UpPitch: 0.12,        // Stage 3 Up-arrow counter-tilt slightly above level (rad)
    stage4UpPitch: 0.0,         // Stage 4 Up-arrow counter-tilt at level (rad)
    divePitchRate: 2.6,
    diveGravityAccel: 0,
    stallSinkGravity: 85,       // Stage 3 slow descent rate (px/s)
    stage4SinkRate: 195,        // Stage 4 faster descent rate (px/s)
    takeoffSpeed: 185,
    safeLandingVy: 45,
    safeLandingPitch: 0.26,
    bounceElasticity: 0.55,
    bounceBaseVy: 38,
    bounceSpeedRetention: 0.78,
    crashSlideTicks: 66,
    crashSlideDecel: 210,
    maxPitch: 0.56,
    pitchRate: 1.9,
    pitchLevelRate: 2.3,
    maxSecondary: 8,
    secondaryCooldownTicks: 22,
    maxFlares: 6,
    flareCooldownTicks: 45,
    cabinCapacity: 0,
    turnDuration: 0.70,
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

export const DEFAULT_P47_CONFIG = Object.freeze({ ...AIRCRAFT_CONFIG.p47 });

export const P47_TUNING_SCHEMA = [
  {
    group: "Speed, Thrust, Cruise & Opposite Braking",
    items: [
      { key: "maxSpeed", label: "Top Speed", min: 250, max: 900, step: 10, unit: "px/s", desc: "Top airspeed reached while holding throttle (Left/Right in direction of travel)." },
      { key: "cruiseSpeed", label: "Cruise Speed Floor", min: 200, max: 750, step: 10, unit: "px/s", desc: "Target cruise speed when coasting off-throttle (never drops speed below this unless braking)." },
      { key: "minGlideSpeed", label: "Minimum Flight Speed", min: 80, max: 320, step: 5, unit: "px/s", desc: "Minimum airspeed floor for braking; reaching this allows opposite key to turn around." },
      { key: "takeoffSpeed", label: "Takeoff Speed", min: 80, max: 350, step: 5, unit: "px/s", desc: "Runway speed needed before Up lifts off." },
      { key: "accelRate", label: "Throttle Accel", min: 50, max: 700, step: 10, unit: "px/s²", desc: "Forward acceleration while holding throttle." },
      { key: "dragDecelRate", label: "Off-Throttle Coast Drag", min: 10, max: 450, step: 5, unit: "px/s²", desc: "Deceleration from top speed down to cruiseSpeed when not throttling." },
      { key: "brakeTapStep", label: "Opposite Tap Shave", min: 10, max: 150, step: 5, unit: "px/s", desc: "Instant speed shaved off on each tap of the opposite direction arrow key." },
      { key: "brakeDecelRate", label: "Opposite Hold Brake Rate", min: 40, max: 700, step: 10, unit: "px/s²", desc: "Continuous deceleration while holding the opposite direction key." },
      { key: "turnHoldThreshold", label: "Turn Hold Threshold", min: 0.02, max: 0.5, step: 0.02, unit: "s", desc: "Seconds holding opposite key at min speed before continuous hold triggers U-turn." }
    ]
  },
  {
    group: "Pitch & Cruise Sine Wave",
    items: [
      { key: "pitchRate", label: "Pitch Rate", min: 0.4, max: 5.0, step: 0.1, unit: "rad/s", desc: "Nose rotation responsiveness on Up/Down." },
      { key: "maxPitch", label: "Max Manual Pitch", min: 0.2, max: 1.2, step: 0.02, unit: "rad", desc: "Steepest climb/dive angle commanded by Up/Down." },
      { key: "pitchLevelRate", label: "Auto-Level Damping", min: 0, max: 8.0, step: 0.1, unit: "1/s", desc: "How fast nose returns to level when Up/Down released in Stages 1–2." },
      { key: "sineOmega", label: "Sine Wave Freq", min: 0, max: 4.0, step: 0.05, unit: "rad/s", desc: "Frequency of the cruise vertical oscillation (lower = longer wavelength)." },
      { key: "sineAmpVel", label: "Sine Wave Vertical Vel", min: 0, max: 80, step: 1, unit: "px/s", desc: "Gentle vertical speed amplitude of cruise bobbing." },
      { key: "sinePitchAmp", label: "Sine Wave Pitch Bob", min: 0, max: 0.15, step: 0.004, unit: "rad", desc: "Nose tilt amplitude paired with the cruise sine wave." }
    ]
  },
  {
    group: "4-Stage Off-Throttle Lift & Descent",
    items: [
      { key: "throttleReleaseDelay", label: "Stage 2 Grace Lift Duration", min: 0.1, max: 4.0, step: 0.05, unit: "s", desc: "Time off-throttle with grace lift where Up still climbs before losing lift." },
      { key: "stallGlideDelay", label: "Stage 3 Slow-Descent Duration", min: 0.1, max: 4.0, step: 0.05, unit: "s", desc: "Duration of Stage 3 slow descent before transitioning into Stage 4 faster descent." },
      { key: "stallSinkGravity", label: "Stage 3 Descent Rate", min: 15, max: 240, step: 5, unit: "px/s", desc: "Constant downward sink rate in Stage 3 (tilt changes do not reduce this)." },
      { key: "stage4SinkRate", label: "Stage 4 Descent Rate", min: 40, max: 400, step: 5, unit: "px/s", desc: "Faster downward sink rate in Stage 4 (only throttle acceleration stops descent)." },
      { key: "glidePitch", label: "Stage 3 Nose-Down Tilt", min: -0.5, max: 0, step: 0.02, unit: "rad", desc: "Slight downward nose tilt during Stage 3 when Up is not held." },
      { key: "maxDivePitch", label: "Stage 4 Nose-Down Tilt", min: -1.2, max: -0.1, step: 0.02, unit: "rad", desc: "Steeper nose-down tilt during Stage 4 (matches Down-arrow angle by default)." },
      { key: "stage3UpPitch", label: "Stage 3 Up Counter-Tilt", min: 0, max: 0.4, step: 0.02, unit: "rad", desc: "Slightly-above-level pitch reachable with Up in Stage 3 (without stopping descent)." },
      { key: "stage4UpPitch", label: "Stage 4 Up Counter-Tilt", min: -0.2, max: 0.2, step: 0.02, unit: "rad", desc: "Level pitch reachable with Up in Stage 4 (without stopping descent)." },
      { key: "divePitchRate", label: "Stage Tilt Transition Rate", min: 0.3, max: 8.0, step: 0.1, unit: "1/s", desc: "How quickly the nose rotates toward Stage 3/4 angles when off-throttle." }
    ]
  },
  {
    group: "Turn, Bounce & Crash Slide",
    items: [
      { key: "turnDuration", label: "U-Turn Duration", min: 0.2, max: 2.0, step: 0.05, unit: "s", desc: "Time taken for a wide U-turn reversal arc." },
      { key: "safeLandingVy", label: "Safe Landing Max Sink", min: 10, max: 160, step: 5, unit: "px/s", desc: "Max vertical descent speed for zero-damage pad landing." },
      { key: "safeLandingPitch", label: "Safe Landing Max Tilt", min: 0.05, max: 0.7, step: 0.02, unit: "rad", desc: "Max pitch angle for zero-damage pad landing." },
      { key: "bounceElasticity", label: "Bounce Elasticity", min: 0, max: 1.2, step: 0.05, unit: "×", desc: "Vertical speed restitution multiplier on survivable impact." },
      { key: "bounceBaseVy", label: "Bounce Min Impulse", min: 0, max: 120, step: 2, unit: "px/s", desc: "Base upward kick added on survivable ground bounce." },
      { key: "bounceSpeedRetention", label: "Bounce Speed Kept", min: 0.2, max: 1.0, step: 0.02, unit: "×", desc: "Fraction of horizontal speed retained after bouncing." },
      { key: "crashSlideTicks", label: "Crash Slide Duration", min: 10, max: 180, step: 2, unit: "ticks", desc: "Max 60 Hz ticks the fatal wreck drags along the ground." },
      { key: "crashSlideDecel", label: "Crash Slide Friction", min: 40, max: 500, step: 10, unit: "px/s²", desc: "How fast the burning wreck slows while bulldozing units." }
    ]
  }
];

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
  { key: "1", id: "infantry", name: "Infantry Squad", cost: 50, phase: 2, unlocked: true },
  { key: "2", id: "aa_truck", name: "AA Flak / SAM Truck", cost: 150, phase: 2, unlocked: true },
  { key: "3", id: "apc", name: "Armored APC", cost: 225, phase: 2, unlocked: true },
  { key: "4", id: "mbt", name: "Main Battle Tank", cost: 400, phase: 2, unlocked: true },
  { key: "5", id: "howitzer", name: "Self-Propelled Howitzer", cost: 650, phase: 2, unlocked: true },
  { key: "6", id: "ambulance", name: "Field Ambulance", cost: 120, phase: 2, unlocked: true },
  { key: "7", id: "supply_truck", name: "Supply / Ammo Truck", cost: 200, phase: 2, unlocked: true },
  { key: "8", id: "b52_raid", name: "B-52 Carpet Raid", cost: 750, phase: 2, unlocked: true },
  { key: "9", id: "v2_missile", name: "Steerable V2 Missile", cost: 850, phase: 2, unlocked: true },
  { key: "0", id: "swap_aircraft", name: "Swap Aircraft (at Base)", cost: 0, phase: 1, unlocked: true }
];

// Phase 2 Economy & Village Sectors
export const BASE_INCOME_PER_SEC = 10;
export const BUNKER_INCOME_PER_SEC = 6;
export const CIVILIAN_KILL_PENALTY = 100;
export const VILLAGE_X_POSITIONS = [-2700, -900, 900, 2700];

// Ground Troop Auto-Production, Crossfire & Damage Degradation
export const AUTO_PRODUCTION_PATTERN = ["mbt", "mbt", "aa_truck", "mbt"];
export const AUTO_PRODUCTION_COOLDOWN_TICKS = 90;
export const AMBULANCE_CROSSFIRE_RATIO = 0.5;
export const GROUND_DAMAGE_MIN_SPEED_FACTOR = 0.45;
export const GROUND_DAMAGE_MAX_COOLDOWN_MULT = 2.0;

// Phase 2 Ground Unit Configurations
export const UNIT_CONFIG = {
  infantry: {
    key: "1",
    id: "infantry",
    kind: "infantry",
    sprite: "infantry",
    name: "Infantry Squad",
    cost: 50,
    hp: 40,
    maxHp: 40,
    speed: 52,
    range: 210,
    damage: 9,
    fireCooldownTicks: 26,
    projSpeed: 620,
    canCaptureBunker: true
  },
  aa_truck: {
    key: "2",
    id: "aa_truck",
    kind: "aa_flak_truck",
    sprite: "aa_flak_truck",
    name: "AA Flak / SAM Truck",
    cost: 150,
    hp: 140,
    maxHp: 140,
    speed: 78,
    visualRange: 750,
    samRange: 750,
    samDamage: 65,
    samCooldownTicks: 78,
    samMaxFlightTime: 2.6,
    samSpeeds: { slow: 320, medium: 520, fast: 760 },
    groundRange: 210,
    groundDamage: 9,
    groundFireCooldownTicks: 26,
    groundProjSpeed: 620
  },
  apc: {
    key: "3",
    id: "apc",
    kind: "armored_apc",
    sprite: "armored_apc",
    name: "Armored APC",
    cost: 225,
    hp: 300,
    maxHp: 300,
    speed: 66,
    range: 310,
    damage: 18,
    fireCooldownTicks: 20,
    projSpeed: 720,
    deployTroopCount: 2
  },
  mbt: {
    key: "4",
    id: "mbt",
    kind: "main_battle_tank",
    sprite: "main_battle_tank",
    name: "Main Battle Tank",
    cost: 400,
    hp: 650,
    maxHp: 650,
    speed: 48,
    range: 420,
    damage: 65,
    fireCooldownTicks: 54,
    projSpeed: 680,
    heavyArmor: true
  },
  howitzer: {
    key: "5",
    id: "howitzer",
    kind: "self_propelled_howitzer",
    sprite: "self_propelled_howitzer",
    name: "Self-Propelled Howitzer",
    cost: 650,
    hp: 1000,
    maxHp: 1000,
    speed: 32,
    range: 720,
    damage: 135,
    splashRadius: 65,
    fireCooldownTicks: 84,
    projSpeed: 560,
    heavyArmor: true
  },
  ambulance: {
    key: "6",
    id: "ambulance",
    kind: "ambulance",
    sprite: "ambulance",
    name: "Field Ambulance",
    cost: 120,
    hp: 150,
    maxHp: 150,
    speed: 82,
    cabinCapacity: 6
  },
  supply_truck: {
    key: "7",
    id: "supply_truck",
    kind: "supply_truck",
    sprite: "supply_truck",
    name: "Supply / Ammo Truck",
    cost: 200,
    hp: 180,
    maxHp: 180,
    speed: 56,
    auraRadius: 240,
    healRate: 25
  }
};

// Phase 2 Strategic Call-Ins
export const STRATEGIC_CONFIG = {
  b52_raid: {
    id: "b52_raid",
    cost: 750,
    hp: 900,
    maxHp: 900,
    altitude: 1020,
    speed: 340,
    stripWidth: 1500,
    bombCount: 24,
    bombDamage: 185,
    bombSplashRadius: 95
  },
  v2_missile: {
    id: "v2_missile",
    cost: 850,
    hp: 120,
    maxHp: 120,
    speed: 520,
    maxSpeed: 640,
    minSpeed: 360,
    pitchRate: 2.1,
    damage: 650,
    splashRadius: 180,
    maxFuelTicks: 600
  }
};

// Phase 2 Defensive Structures
export const DEFENSE_CONFIG = {
  bunker: {
    maxHp: 1000,
    range: 440,
    maxAirY: 250,
    damage: 14,
    fireCooldownTicks: 24,
    projSpeed: 680
  },
  baseAa: {
    flakRange: 1050,
    flakDamage: 15,
    flakCooldownTicks: 20,
    flakSpeed: 780,
    samRange: 1100,
    samDamage: 75,
    samCooldownTicks: 120,
    samSpeed: 470
  }
};

// Phase 3 Multiplayer Match Modes & 20 Hz Network Snapshots
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_TICKS = Math.round(TICK_RATE / SNAPSHOT_RATE); // 3 ticks (50ms)

export const MATCH_MODES = {
  "1v1": { id: "1v1", label: "1v1 Duel", teamSize: 1 },
  "2v2": { id: "2v2", label: "2v2 Wingmen", teamSize: 2 },
  "3v3": { id: "3v3", label: "3v3 Total War", teamSize: 3 }
};
