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
    maxSecondary: 8,
    secondaryCooldownTicks: 22,
    cabinCapacity: 8,
    turnDuration: 0.54,
    idleSinkSpeed: 24,
    primarySpeed: 1050,
    primaryAngleDeg: 0, // straight out front of cockpit (tilts with pitch)
    primaryDamage: 14,
    missileSpeed: 820,
    missileDamage: 160,
    secondaryDamage: 160,
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
    maxSecondary: 12,
    secondaryCooldownTicks: 18,
    cabinCapacity: 0,
    turnDuration: 0.70,
    sineOmega: 1.15,        // long horizontal wavelength
    sineAmpVel: 18,         // gentle vertical velocity wave
    sinePitchAmp: 0.032,    // subtle matching nose pitch
    primarySpeed: 1250,
    primaryDamage: 16,
    bombDamage: 145,
    secondaryDamage: 145,
    hitRadius: 30
  }
};

export const DEFAULT_P47_CONFIG = Object.freeze({ ...AIRCRAFT_CONFIG.p47 });

export const HELI_BOT_CONFIG = {
  // Air combat & pursuit
  airVisualRange: 950,            // Slant range to shift focus onto enemy aircraft
  airEngageHysteresisRange: 1150, // Keep tracking engaged air target slightly past visual range
  airMaxBehindFront: 800,         // Normal max distance behind frontline to chase healthy air targets
  airPursuitHpRatio: 0.20,        // Only pursue deep behind frontline if enemy HP <= 20%
  airPursuitMaxBehindFront: 1700, // Hard cap behind frontline even for <= 20% HP pursuit
  airPursuitMaxGap: 640,          // Max horizontal gap to chase a <= 20% HP enemy heli
  airPursuitMaxGapFastP47: 420,   // Max horizontal gap if chasing a fast-fleeing P-47 (vx > 290)
  enemyHqNoChaseDist: 1100,       // Never chase enemy aircraft into enemy HQ area
  aerialBattleRange: 850,         // Slant range defining active aerial battle (blocks ammo-only RTB)
  dogfightMinStandoff: 200,       // Preferred minimum horizontal distance in air combat
  dogfightMaxStandoff: 400,       // Preferred maximum horizontal distance in air combat

  // Strategic RTB & refit
  lowHpRetreatRatio: 0.35,        // Retreat even during combat when HP <= 35%
  pursuitMinHpRatio: 0.40,        // Do not pursue deep kills if own HP < 40%
  baseReadyHpRatio: 0.92,         // Repair threshold on pad before takeoff
  scrambleEnemyDist: 550,         // Scramble off pad early if enemy aircraft is right overhead

  // Frontline ground attack & bunker breaking
  groundMaxBehindFront: 1800,     // Focus on enemy frontline echelon
  bunkerMaxBehindFront: 2000,     // Break frontline bunkers & immediate support bunker, not deep rear
  strafeBreakDist: 135,           // Close-in distance to break off a gunship strafing pass
  strafeStandoffDist: 480,        // Pull-back distance on friendly side before re-attacking
  minCombatY: 52,                 // Stay above horizontal MBT/howitzer/infantry fire (y <= 38)
  maxCombatY: 175,                // Ceiling for ground strafe alignment

  // Opportunistic transport & rescue
  bunkerDetourMaxDist: 1300,      // Max distance for opportunistic bunker capture detour
  bunkerAaDangerDist: 500,        // Avoid capturing a bunker guarded by an AA truck within this range
  civDetourMaxDist: 950,          // Max distance for opportunistic civilian rescue detour
  civReturnDetourMaxDist: 420,    // Scoop safe civilian along return-to-base route
  civEnemyDangerDist: 520,        // Don't land for civilian if enemy ground combat unit is this close
  civAmbulanceClaimDist: 220,     // Let nearby friendly ambulance with cabin space handle it

  // Threat evasion
  evadeLookaheadSec: 1.35,        // Projectile CPA lookahead window
  evadeDangerRadius: 82,          // CPA threshold to trigger evasion
  evadeDropTicks: 32,             // Duration of dive/drop maneuver (~0.53s)
  evadeClimbTicks: 32,            // Duration of pop-up/climb maneuver (~0.53s)
  evadeBreakTurnTicks: 42,        // Duration of break-turn away from threat (~0.70s)
  evadeCooldownTicks: 18,         // Brief cooldown after maneuver unless imminent hit (< 0.45s)
  evadeFloorY: 48,                // Never dive below this altitude during evasion

  // Dynamic air-to-air tactics & humanization
  airPassThroughDist: 165,        // Base distance to fly past target before turning to re-engage
  airSlashOffsetY: 72,            // Altitude above target for high-speed downward nose-rake slash
  airUndercutOffsetY: 85,         // Altitude below target for defensive slip-under pass
  airWeaveAmpY: 58,               // Vertical weave amplitude during press_weave
  airPressMinRange: 170,          // Close-in press range during aggressive dogfighting
  airPressMaxRange: 340,          // Outer press range before surging closer
  airReactionMinTicks: 6,         // Min visual perception sample interval (~100ms)
  airReactionMaxTicks: 10,        // Max visual perception sample interval (~167ms)
  airAimWanderMaxY: 26,           // Max gentle vertical tracking imperfection (±px)
  airPrimaryAimTolerance: 95,     // Vertical tolerance (px) for air-to-air primary cannon bursts
  airSecondaryAimTolerance: 58,   // Vertical tolerance (px) for air-to-air missile shots
  airPrimaryBurstHoldTicks: 14,   // Follow-through burst duration (~0.23s) once primary fires at air
  airFireReactMinTicks: 1,        // Min trigger reaction delay on newly lined-up air target
  airFireReactMaxTicks: 4,        // Max trigger reaction delay
  airMissileReactBonusTicks: 2,   // Extra hesitation before launching air-to-air missiles
  airTacticMinTicks: 55,          // Min commitment to a chosen dogfight tactic (~0.9s)
  airTacticMaxTicks: 120          // Max commitment before re-scoring tactics (~2.0s)
};

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

// Requisition Menu Catalog (Keys 1-6 & 0)
export const REQUISITION_MENU = [
  { key: "1", id: "infantry", name: "Infantry Squad", cost: 50, phase: 2, unlocked: true },
  { key: "2", id: "aa_truck", name: "AA Flak / SAM Truck", cost: 150, phase: 2, unlocked: true },
  { key: "3", id: "mbt", name: "Main Battle Tank", cost: 400, phase: 2, unlocked: true },
  { key: "4", id: "howitzer", name: "Self-Propelled Howitzer", cost: 650, phase: 2, unlocked: true },
  { key: "5", id: "ambulance", name: "Field Ambulance", cost: 120, phase: 2, unlocked: true },
  { key: "6", id: "supply_truck", name: "Supply / Ammo Truck", cost: 200, phase: 2, unlocked: true },
  { key: "0", id: "swap_aircraft", name: "Swap Aircraft (at Base)", cost: 0, phase: 1, unlocked: true }
];

// Phase 2 Economy & Village Sectors
export const BASE_INCOME_PER_SEC = 10;
export const BUNKER_INCOME_PER_SEC = 6;
export const CIVILIAN_KILL_PENALTY = 100;
export const VILLAGE_X_POSITIONS = [-2700, -900, 900, 2700];

// Special Weapon Unlock Goals (Z = B-52, X = V2; max 2 per game: 1 civilian rescue + 1 accuracy raid)
export const SPECIAL_WEAPON_CIV_GOAL_BASE = 10;
export const SPECIAL_WEAPON_CIV_GOAL_MULTI_HELI = 20;

// Ground Troop Auto-Production, Crossfire & Damage Degradation
export const AUTO_PRODUCTION_PATTERN = ["mbt", "infantry", "mbt", "aa_truck", "mbt"];
export const AUTO_PRODUCTION_COOLDOWN_TICKS = 30;
export const AUTO_PRODUCTION_GATE_CLEARANCE = 150;
export const AUTO_PRODUCTION_COLUMN_SIZE = 5;
export const AUTO_PRODUCTION_COLUMN_PAUSE_TICKS = 420;
export const AMBULANCE_CROSSFIRE_RATIO = 0.5;
export const GROUND_DAMAGE_MIN_SPEED_FACTOR = 0.45;
export const GROUND_DAMAGE_MAX_COOLDOWN_MULT = 2.0;

export const GROUND_BEHAVIOR_CONFIG = {
  damageDegradationEnabled: true,
  minDamagedSpeedFactor: 0.45,
  maxDamagedCooldownMult: 2.0,
  damagedAaSlowOnly: true,
  supplyReloadBoost: true,
  ambulanceTargetable: false,
  ambulanceCrossfireRatio: 0.5,
  rearHitMultiplier: 1.75
};

export const DEFAULT_GROUND_BEHAVIOR_CONFIG = Object.freeze({ ...GROUND_BEHAVIOR_CONFIG });

export const GROUND_UNIT_ORDER = [
  "infantry",
  "aa_truck",
  "mbt",
  "howitzer",
  "ambulance",
  "supply_truck"
];

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
  mbt: {
    key: "3",
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
    key: "4",
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
    key: "5",
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
    key: "6",
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

export const DEFAULT_UNIT_CONFIG = Object.freeze(
  Object.fromEntries(
    Object.entries(UNIT_CONFIG).map(([key, cfg]) => [
      key,
      Object.freeze({
        ...cfg,
        ...(cfg.samSpeeds ? { samSpeeds: Object.freeze({ ...cfg.samSpeeds }) } : {})
      })
    ])
  )
);

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

export const DEFAULT_BUNKER_CONFIG = Object.freeze({ ...DEFENSE_CONFIG.bunker });

export const GROUND_UNIT_TUNING_SCHEMA = {
  infantry: [
    {
      group: "Survivability & Mobility",
      items: [
        { key: "maxHp", label: "Max Health", min: 10, max: 300, step: 5, unit: "HP", desc: "Total squad hit points before elimination." },
        { key: "speed", label: "March Speed", min: 10, max: 180, step: 2, unit: "px/s", desc: "Forward advance speed when no enemy target is in range." },
        { key: "cost", label: "Requisition Cost", min: 10, max: 500, step: 5, unit: "$", desc: "War funds required to deploy an Infantry Squad." },
        { key: "canCaptureBunker", kind: "checkbox", label: "Can Capture Neutral Bunkers", desc: "When enabled, infantry capture neutral/0-HP bunkers on contact." }
      ]
    },
    {
      group: "Rifle Combat & Rate of Fire",
      items: [
        { key: "range", label: "Engagement Range", min: 60, max: 600, step: 10, unit: "m", desc: "Forward standoff distance where infantry halt to fire." },
        { key: "damage", label: "Damage Dealt", min: 1, max: 80, step: 1, unit: "dmg", desc: "Damage inflicted per rifle shot." },
        { key: "fireCooldownTicks", kind: "rate", label: "Rate of Fire", min: 0.3, max: 12, step: 0.1, unit: "shots/s", desc: "Rifle firing cadence (converted internally to 60 Hz cooldown ticks)." },
        { key: "projSpeed", label: "Bullet Speed", min: 200, max: 1400, step: 20, unit: "px/s", desc: "Muzzle velocity of infantry rounds." }
      ]
    }
  ],
  aa_truck: [
    {
      group: "Chassis & Economy",
      items: [
        { key: "maxHp", label: "Max Health", min: 20, max: 600, step: 10, unit: "HP", desc: "Hull durability before destruction." },
        { key: "speed", label: "Drive Speed", min: 10, max: 180, step: 2, unit: "px/s", desc: "Forward driving speed when not engaging ground threats." },
        { key: "cost", label: "Requisition Cost", min: 25, max: 600, step: 10, unit: "$", desc: "War funds required to deploy an AA Flak / SAM Truck." }
      ]
    },
    {
      group: "Anti-Air SAM Launcher",
      items: [
        { key: "visualRange", label: "SAM Visual / Lock Range", min: 200, max: 1400, step: 25, unit: "m", desc: "Slant-range dome within which airborne threats are tracked and engaged." },
        { key: "samDamage", label: "SAM Damage Dealt", min: 10, max: 250, step: 5, unit: "dmg", desc: "Damage dealt on direct unguided SAM air impact." },
        { key: "samCooldownTicks", kind: "rate", label: "SAM Rate of Fire", min: 0.2, max: 6, step: 0.1, unit: "shots/s", desc: "Missile launcher firing cadence against aircraft." },
        { key: "samMaxFlightTime", label: "Max Intercept Flight Time", min: 0.5, max: 6.0, step: 0.1, unit: "s", desc: "Maximum predicted time-to-intercept considered valid before firing." },
        { key: "samSpeeds.slow", label: "Slow SAM Speed Profile", min: 150, max: 600, step: 10, unit: "px/s", desc: "Missile speed used for slow/hovering targets (and damaged AA fallback)." },
        { key: "samSpeeds.medium", label: "Medium SAM Speed Profile", min: 250, max: 900, step: 10, unit: "px/s", desc: "Missile speed used for cruising aircraft." },
        { key: "samSpeeds.fast", label: "Fast SAM Speed Profile", min: 400, max: 1300, step: 20, unit: "px/s", desc: "High-velocity missile profile for fast jets and evading targets." }
      ]
    },
    {
      group: "Ground Defense Light Gun",
      items: [
        { key: "groundRange", label: "Ground Gun Range", min: 60, max: 500, step: 10, unit: "m", desc: "Forward engagement distance for the AA truck's light ground weapon." },
        { key: "groundDamage", label: "Ground Gun Damage", min: 1, max: 60, step: 1, unit: "dmg", desc: "Damage per shot against enemy ground troops and bunkers." },
        { key: "groundFireCooldownTicks", kind: "rate", label: "Ground Gun Rate of Fire", min: 0.3, max: 12, step: 0.1, unit: "shots/s", desc: "Light gun firing cadence against ground targets." },
        { key: "groundProjSpeed", label: "Ground Bullet Speed", min: 200, max: 1400, step: 20, unit: "px/s", desc: "Velocity of light ground defense rounds." }
      ]
    }
  ],
  mbt: [
    {
      group: "Armor & Mobility",
      items: [
        { key: "maxHp", label: "Max Health", min: 100, max: 2000, step: 25, unit: "HP", desc: "Heavy tank armor hit points." },
        { key: "speed", label: "Drive Speed", min: 10, max: 150, step: 2, unit: "px/s", desc: "Forward tank speed when advancing." },
        { key: "heavyArmor", kind: "checkbox", label: "Heavy Armor Plating", desc: "Marks MBT as heavy armor (eligible for rear-hit bonus and unarmored-only filtering)." },
        { key: "cost", label: "Requisition Cost", min: 100, max: 1200, step: 25, unit: "$", desc: "War funds required to deploy a Main Battle Tank." }
      ]
    },
    {
      group: "Main Cannon",
      items: [
        { key: "range", label: "Cannon Range", min: 100, max: 900, step: 10, unit: "m", desc: "Forward engagement distance for the main tank cannon." },
        { key: "damage", label: "Shell Damage Dealt", min: 10, max: 300, step: 5, unit: "dmg", desc: "Direct-hit kinetic damage per tank shell." },
        { key: "fireCooldownTicks", kind: "rate", label: "Rate of Fire", min: 0.2, max: 6, step: 0.1, unit: "shots/s", desc: "Main cannon reload cadence." },
        { key: "projSpeed", label: "Shell Speed", min: 250, max: 1400, step: 20, unit: "px/s", desc: "Velocity of fired tank shells." }
      ]
    }
  ],
  howitzer: [
    {
      group: "Heavy Chassis & Mobility",
      items: [
        { key: "maxHp", label: "Max Health", min: 150, max: 2500, step: 25, unit: "HP", desc: "Self-propelled artillery hull hit points." },
        { key: "speed", label: "Drive Speed", min: 8, max: 120, step: 2, unit: "px/s", desc: "Forward speed while moving into artillery range." },
        { key: "heavyArmor", kind: "checkbox", label: "Heavy Armor Plating", desc: "Marks Howitzer as heavy armor." },
        { key: "cost", label: "Requisition Cost", min: 150, max: 1500, step: 25, unit: "$", desc: "War funds required to deploy a Self-Propelled Howitzer." }
      ]
    },
    {
      group: "Ballistic Artillery & Splash",
      items: [
        { key: "range", label: "Standoff Range", min: 200, max: 1400, step: 20, unit: "m", desc: "Long-range firing distance ahead of frontline armor." },
        { key: "damage", label: "Shell Damage Dealt", min: 20, max: 500, step: 5, unit: "dmg", desc: "Base explosive damage at shell impact." },
        { key: "splashRadius", label: "Splash Radius", min: 0, max: 220, step: 5, unit: "m", desc: "Area-of-effect blast radius around shell detonation." },
        { key: "fireCooldownTicks", kind: "rate", label: "Rate of Fire", min: 0.15, max: 4, step: 0.05, unit: "shots/s", desc: "Artillery loading and firing cadence." },
        { key: "projSpeed", label: "Shell Ballistic Reference", min: 200, max: 1200, step: 20, unit: "px/s", desc: "Reference shell speed parameter stored for howitzer ordnance." }
      ]
    }
  ],
  ambulance: [
    {
      group: "Medevac Chassis & Capacity",
      items: [
        { key: "maxHp", label: "Max Health", min: 30, max: 600, step: 10, unit: "HP", desc: "Hull hit points (absorbs crossfire if fighting near combat units)." },
        { key: "speed", label: "Drive Speed", min: 15, max: 200, step: 2, unit: "px/s", desc: "Bidirectional travel speed toward stranded civilians and back to HQ." },
        { key: "cabinCapacity", label: "Civilian Cabin Capacity", min: 1, max: 12, step: 1, unit: "civs", desc: "Max stranded civilians carried before returning to HQ for payout." },
        { key: "cost", label: "Requisition Cost", min: 25, max: 500, step: 10, unit: "$", desc: "War funds required to deploy a Field Ambulance." }
      ]
    }
  ],
  supply_truck: [
    {
      group: "Logistics Chassis & Support Aura",
      items: [
        { key: "maxHp", label: "Max Health", min: 40, max: 800, step: 10, unit: "HP", desc: "Support truck hull hit points." },
        { key: "speed", label: "Drive Speed", min: 10, max: 160, step: 2, unit: "px/s", desc: "Forward speed while escorting frontline combat vehicles." },
        { key: "auraRadius", label: "Repair & Resupply Aura", min: 60, max: 600, step: 10, unit: "m", desc: "Horizontal radius around the truck where allies are repaired and reloaded." },
        { key: "healRate", label: "Repair Rate", min: 0, max: 150, step: 5, unit: "HP/s", desc: "Health restored per second to each friendly unit inside the aura." },
        { key: "cost", label: "Requisition Cost", min: 50, max: 600, step: 10, unit: "$", desc: "War funds required to deploy a Supply / Ammo Truck." }
      ]
    }
  ]
};

export const GROUND_BEHAVIOR_TUNING_SCHEMA = [
  {
    group: "Damage Degradation & Logistics Rules",
    items: [
      { key: "damageDegradationEnabled", kind: "checkbox", label: "Damage Degrades Speed & Fire Rate", desc: "Damaged ground units slow down and reload more slowly proportionally to missing HP." },
      { key: "minDamagedSpeedFactor", label: "Min Damaged Speed Floor", min: 0.1, max: 1.0, step: 0.05, unit: "×", desc: "Lowest speed multiplier at near-0 HP when degradation is enabled." },
      { key: "maxDamagedCooldownMult", label: "Max Damaged Reload Slowdown", min: 1.0, max: 4.0, step: 0.1, unit: "×", desc: "Longest fire-cooldown multiplier at near-0 HP when degradation is enabled." },
      { key: "damagedAaSlowOnly", kind: "checkbox", label: "Damaged AA Fires Slow SAMs Only", desc: "When damaged below max HP, AA trucks fall back strictly to slow SAM intercepts." },
      { key: "supplyReloadBoost", kind: "checkbox", label: "Supply Aura Boosts Weapon Reload", desc: "Friendly units inside Supply Truck aura reduce fire cooldowns twice as fast." },
      { key: "ambulanceTargetable", kind: "checkbox", label: "Ambulances Directly Targetable", desc: "Allow enemy ground units and weapons to directly target ambulances (normally exempt)." },
      { key: "ambulanceCrossfireRatio", label: "Ambulance Crossfire Ratio", min: 0, max: 1.0, step: 0.05, unit: "×", desc: "Fraction of damage shared with ambulances overlapping a struck target hitbox." },
      { key: "rearHitMultiplier", label: "Armor Rear-Hit Multiplier", min: 1.0, max: 3.0, step: 0.05, unit: "×", desc: "Damage multiplier when non-bullet ordnance strikes armored vehicles from behind." }
    ]
  }
];

export const BUNKER_TUNING_SCHEMA = [
  {
    group: "Defensive Bunker Parameters",
    items: [
      { key: "maxHp", label: "Bunker Max Health", min: 100, max: 3000, step: 50, unit: "HP", desc: "Hit points of a captured bunker before returning to neutral." },
      { key: "range", label: "Bunker Fire Range", min: 100, max: 900, step: 20, unit: "m", desc: "Horizontal/slant engagement radius for captured bunker turrets." },
      { key: "maxAirY", label: "Max Air Target Altitude", min: 50, max: 600, step: 10, unit: "m", desc: "Maximum aircraft height a bunker turret will engage." },
      { key: "damage", label: "Bunker Damage Dealt", min: 2, max: 100, step: 1, unit: "dmg", desc: "Damage per bunker defensive round." },
      { key: "fireCooldownTicks", kind: "rate", label: "Bunker Rate of Fire", min: 0.3, max: 12, step: 0.1, unit: "shots/s", desc: "Bunker turret firing cadence." },
      { key: "projSpeed", label: "Bunker Bullet Speed", min: 200, max: 1400, step: 20, unit: "px/s", desc: "Muzzle velocity of bunker defensive fire." }
    ]
  }
];

// Phase 3 Multiplayer Match Modes & 20 Hz Network Snapshots
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_TICKS = Math.round(TICK_RATE / SNAPSHOT_RATE); // 3 ticks (50ms)

export const MATCH_MODES = {
  "1v1": { id: "1v1", label: "1v1 Duel", teamSize: 1 },
  "2v2": { id: "2v2", label: "2v2 Wingmen", teamSize: 2 },
  "3v3": { id: "3v3", label: "3v3 Total War", teamSize: 3 }
};
