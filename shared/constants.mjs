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
    throttleReleaseDelay: 0.20,
    dragDecelRate: 135,
    stallSpeed: 220,
    minGlideSpeed: 175,
    stallGlideDelay: 0.30,
    glidePitch: -0.18,
    maxDivePitch: -0.62,
    divePitchRate: 2.8,
    diveGravityAccel: 55,
    stallSinkGravity: 35,
    takeoffSpeed: 195,
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

export const DEFAULT_P47_CONFIG = Object.freeze({ ...AIRCRAFT_CONFIG.p47 });

export const P47_TUNING_SCHEMA = [
  {
    group: "Speed, Thrust & Drag",
    items: [
      { key: "maxSpeed", label: "Max Airspeed", min: 250, max: 900, step: 10, unit: "px/s", desc: "Top horizontal speed under full thrust." },
      { key: "cruiseSpeed", label: "Cruise / Air-Spawn Speed", min: 200, max: 750, step: 10, unit: "px/s", desc: "Initial speed when spawning the P-47 in mid-air." },
      { key: "takeoffSpeed", label: "Takeoff Speed", min: 80, max: 350, step: 5, unit: "px/s", desc: "Runway speed needed before Up lifts off." },
      { key: "accelRate", label: "Thrust Accel", min: 50, max: 700, step: 10, unit: "px/s²", desc: "Forward acceleration while holding Left/Right." },
      { key: "throttleReleaseDelay", label: "Throttle Release Delay", min: 0, max: 1.5, step: 0.02, unit: "s", desc: "Coast grace time after releasing Left/Right before drag acts." },
      { key: "dragDecelRate", label: "Aerodynamic Drag", min: 10, max: 450, step: 5, unit: "px/s²", desc: "Speed bleed per second after release delay expires." }
    ]
  },
  {
    group: "Pitch & Cruise Sine Wave",
    items: [
      { key: "pitchRate", label: "Pitch Rate", min: 0.4, max: 5.0, step: 0.1, unit: "rad/s", desc: "Nose rotation responsiveness on Up/Down." },
      { key: "maxPitch", label: "Max Manual Pitch", min: 0.2, max: 1.2, step: 0.02, unit: "rad", desc: "Steepest climb/dive angle commanded by Up/Down." },
      { key: "pitchLevelRate", label: "Auto-Level Damping", min: 0, max: 8.0, step: 0.1, unit: "1/s", desc: "How fast nose returns to level when Up/Down released." },
      { key: "sineOmega", label: "Sine Wave Freq", min: 0, max: 4.0, step: 0.05, unit: "rad/s", desc: "Frequency of the cruise vertical oscillation (lower = longer wavelength)." },
      { key: "sineAmpVel", label: "Sine Wave Vertical Vel", min: 0, max: 80, step: 1, unit: "px/s", desc: "Gentle vertical speed amplitude of cruise bobbing." },
      { key: "sinePitchAmp", label: "Sine Wave Pitch Bob", min: 0, max: 0.15, step: 0.004, unit: "rad", desc: "Nose tilt amplitude paired with the cruise sine wave." }
    ]
  },
  {
    group: "Stall, Glide & Gravity",
    items: [
      { key: "stallSpeed", label: "Stall Lift Threshold", min: 100, max: 420, step: 5, unit: "px/s", desc: "Speed below which wing lift begins dropping off." },
      { key: "minGlideSpeed", label: "Zero-Lift Speed Floor", min: 40, max: 320, step: 5, unit: "px/s", desc: "Speed where lift reaches 0% and drag floor stabilizes." },
      { key: "stallGlideDelay", label: "Stall Glide Delay", min: 0, max: 2.0, step: 0.05, unit: "s", desc: "Grace window holding shallow glide before deepening to nose-dive." },
      { key: "glidePitch", label: "Initial Glide Pitch", min: -0.5, max: 0, step: 0.02, unit: "rad", desc: "Shallow downward angle at onset of stall." },
      { key: "maxDivePitch", label: "Max Stall Dive Pitch", min: -1.2, max: -0.1, step: 0.02, unit: "rad", desc: "Deepest nose-dive angle after lift loss (never vertical drop)." },
      { key: "divePitchRate", label: "Dive Nose-Over Rate", min: 0.3, max: 8.0, step: 0.1, unit: "1/s", desc: "How quickly the nose rotates into the stall dive." },
      { key: "diveGravityAccel", label: "Dive Gravity Accel", min: 0, max: 250, step: 5, unit: "px/s²", desc: "Forward speed sustained by gravity along the dive angle." },
      { key: "stallSinkGravity", label: "Stall Gravity Sink", min: 0, max: 220, step: 5, unit: "px/s", desc: "Extra downward sink speed added as lift drops to 0%." }
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
