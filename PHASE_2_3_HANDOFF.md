# Glory Days Web — Phase 2 & Phase 3 Handoff Context

> **Origin Thread:** [Phase 1 & P-47 Flight Lab Thread](conversation://25680ef1-3320-49b9-bc1d-e022d7a73900)  
> **Primary Design Doc:** [`GAME_DESIGN_SPEC.md`](file:///Users/parsa/Documents/antigravity/glory%20days/GAME_DESIGN_SPEC.md)  
> **Baseline Commit at Handoff:** `03209f5` (`master`)  
> **Verified Baseline Checks:** 12 / 12 tests passing in [`tests/simulation.test.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/tests/simulation.test.mjs)

This document captures the full technical state, architecture, constraints, sprite catalog, and Phase 2 + Phase 3 implementation plan so work on **Phase 2 (RTS Ground War, Civilians & Strategic Call-Ins)** and **Phase 3 (Multiplayer Rooms, AI Commanders & Polish)** can proceed in a parallel thread without colliding with ongoing P-47 flight tuning in `/flight-lab`.

---

## 1. Parallel Thread Isolation Contract

The P-47 flight mechanics test lab lives separately at `http://localhost:3000/flight-lab` so you can build Phase 2 & Phase 3 in parallel while the flight model is tuned there.

To avoid merge conflicts or regressions:
- **Do NOT modify or remove** [`public/flight-lab.html`](file:///Users/parsa/Documents/antigravity/glory%20days/public/flight-lab.html) or [`public/js/flight_lab.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/flight_lab.mjs).
- **Preserve the `P47_TUNING_SCHEMA` & `updateP47Config` contract** in [`shared/constants.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/shared/constants.mjs) and [`shared/simulation.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/shared/simulation.mjs).
- **Avoid rewriting core P-47 aerodynamic equations** (`updateP47` and `updateCrashSlide` in `shared/simulation.mjs`) except when integrating tuned numeric presets or Phase 2/3 interaction hooks (e.g., SAM lock warnings, B-52/V2 collision, bunker/HQ damage).

---

## 2. Environment & Engineering Constraints

- **Node Binary:** `/Users/parsa/.nvm/versions/node/v22.14.0/bin/node` (v22.14.0).
- **Zero External npm Dependencies:** Do not assume `npm install`, `vite`, `ws`, or `three` exist in `node_modules`. The project intentionally runs pure ES Modules (`.mjs`), native `node:http` + RFC 6455 `node:crypto` WebSockets in [`server/index.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/server/index.mjs), HTML5 2D Canvas sprite rendering, and `node:test` + `node:assert/strict` for testing.
- **Dual Browser + Node ESM Import Paths:** Modules in `public/js/*.mjs` MUST import shared modules using `../../shared/...` (never `/shared/...`) so both the HTTP server (`server/index.mjs` maps `/shared/...` to `shared/...`) and `node --test` resolve the exact same files without a bundler.
- **Strictly Keyboard Game Controls:** Main game flight, weapons, utility (`E`), and requisition (`Q` -> `1`–`9` & `0`) must remain 100% keyboard-driven (`public/js/input.mjs`) with zero mandatory mouse aiming or blocking popups on base landing.
- **World Coordinate System:**
  - Horizontal battlefield: `MIN_X = -6000` to `MAX_X = +6000` (`WORLD_WIDTH = 12000`).
  - Vertical altitude: `GROUND_Y = 0` to `CEILING_Y = 1200`.
  - Fixed simulation timestep: `TICK_RATE = 60` (`DT = 1 / 60`).
  - Bases:
    - `allied`: `hqX: -5400`, `padMinX: -5680`, `padMaxX: -5040`, `padCenterX: -5320`, `siloX: -5760`, `maxHp: 5000`.
    - `enemy`: `hqX: 5400`, `padMinX: 5040`, `padMaxX: 5680`, `padCenterX: 5320`, `siloX: 5760`, `maxHp: 5000`.
  - Checkpoints (`BUNKER_X_POSITIONS`): `[-3600, -1800, 0, 1800, 3600]`.

---

## 3. Existing Codebase Inventory

| File | Purpose & Key Symbols |
| :--- | :--- |
| [`shared/constants.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/shared/constants.mjs) | `TICK_RATE`, `DT`, `WORLD_WIDTH`, `MIN_X`, `MAX_X`, `GROUND_Y`, `CEILING_Y`, `MISSILE_FUEL_DISTANCE` (`4000`), `GRAVITY` (`380`), burst reservoir constants, `BASES`, `BUNKER_X_POSITIONS`, `AIRCRAFT_CONFIG` (`heli` & `p47`), `DEFAULT_P47_CONFIG`, `P47_TUNING_SCHEMA`, `RENDER_HEIGHTS`, `REQUISITION_MENU` (`1`–`9` & `0`, currently `1`–`9` marked `phase: 2`). |
| [`shared/simulation.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/shared/simulation.mjs) | `createInitialState`, `createPlayer`, `addPlayer`, `removePlayer`, `isOnFriendlyPad`, `updateP47Config`, `spawnPlayerP47Test`, `swapPlayerAircraft`, `handlePlayerUtility`, `updateP47`, `updateCrashSlide`, `stepSimulation` (Helicopter flight/free-drop bombs/cockpit 0° cannon/idle sink, P-47 flight/stall glide-to-dive/bounce/crash slide, Burst-Fire Reservoir `A`, straight 4,000m P-47 missiles `S`, flares `Z`, paratrooper drop `E` -> collapse -> bunker capture, ground target patrol & damage including `1.75x` rear hit). |
| [`server/index.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/server/index.mjs) | Static server (`/` -> `public/index.html`, `/flight-lab` -> `public/flight-lab.html`, `/shared/*` -> `shared/*`), RFC 6455 WS server on `/ws`, 60 Hz simulation loop broadcasting full `{ type: "snapshot", state }`, handles `input`, `utility`, `swapAircraft`, `updateP47Config`, `spawnP47Test`. Note `PORT` defaults to `3000` (a background server is already running for `/flight-lab`—when testing changes in the new thread, either restart cleanly or run tests on a custom `PORT`). |
| [`public/index.html`](file:///Users/parsa/Documents/antigravity/glory%20days/public/index.html) | Main game viewport, top HQ/funds/bunker bar, `#base-banner`, `#q-drawer`, `#flight-lab-link`, bottom DS-style `#command-deck` (craft status + radar + keyboard legend). |
| [`public/js/main.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/main.mjs) | Main game client loop; loads `glory_days_p47_config` from `localStorage` if saved; connects `/ws` with offline sandbox fallback; handles `toggleMenu`, `utility`, `menuKey`. |
| [`public/js/renderer.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/renderer.mjs) | `SpriteBattlefieldRenderer`: preloads all 42 transparent PNG sprites, generates enemy hue-shifted canvases (`getEnemyCanvas`), smooth look-ahead/zoom camera, parallax clouds & mountains, ground distance markers, bases/pads/silos/bunkers/targets/paratroopers/aircraft/projectiles/smoke/explosions. Note: aircraft angle uses `-(player.effectivePitch ?? player.pitch)` for P-47 and `-player.pitch` for Heli; exposes `lastViewW`, `lastViewH`, `lastGroundScreenY`. |
| [`public/js/hud.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/hud.mjs) | `TacticalHud`: renders `REQUISITION_MENU` (`#q-drawer`), updates HQ health bars, team funds, bunker ownership pips, burst reservoir meter, ordnance/flare pips, cabin readout, and the 12,000m bottom radar strip (`drawRadar`). |
| [`public/js/input.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/input.mjs) | `KeyboardInput`: tracks `ArrowLeft/Right/Up/Down`, `KeyA`, `KeyS`, `KeyZ`, fires `onAction` for `KeyQ`, `KeyE`, `Digit0..9`, `Backquote`, and ignores hotkeys while focus is in form inputs (`Enter`/`Escape` blurs). |
| [`public/js/dev_tuner.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/dev_tuner.mjs) | Unused legacy drawer module kept for reference; superseded by standalone `flight_lab.mjs`. |
| [`public/flight-lab.html`](file:///Users/parsa/Documents/antigravity/glory%20days/public/flight-lab.html) & [`public/js/flight_lab.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/flight_lab.mjs) | Standalone P-47 Test Gym (do not alter in Phase 2/3 thread). |
| [`tests/simulation.test.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/tests/simulation.test.mjs) | 12 unit tests covering burst fire, 4,000m missiles, sine cruise & U-turn, base auto-resupply & `Q->0`, paratrooper drop & bunker capture, Heli free-drop bombs & cockpit cannon & left-tilt & idle sink, P-47 throttle/stall/bounce/crash slide, dev config & scenarios. |

---

## 4. Available Sprite Assets (`public/assets/sprites/*.png`)

All **42 transparent PNG sprites** are already generated, cleaned, canvas-locked where animated, and preloaded in [`public/js/renderer.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/renderer.mjs#L10-L19). **No new sprite generation is required for Phase 2.**

- **Static Vehicles & Structures (`RENDER_HEIGHTS`):**
  - `aa_flak_truck.png` (`aaTruck: 58`), `ambulance.png` (`ambulance: 52`), `armored_apc.png` (`apc: 50`), `main_battle_tank.png` (`mbt: 46`), `self_propelled_howitzer.png` (`howitzer: 68`), `supply_truck.png` (`supplyTruck: 50`)
  - `b52_bomber.png` (`b52: 90`), `v2_missile.png`, `v2_silo.png` (`v2Silo: 135`), `bunker.png` (`bunker: 96`), `base_hq.png` (`baseHq: 155`)
  - Static fallbacks (unused directly when animated): `helicopter.png`, `p47_thunderbolt.png`, `infantry.png`, `paratrooper.png`, `civilian.png`
- **Helicopter Animation (`424×266` fly, `430×284` turn — uniform canvas anchor eliminates jitter):**
  - `heli_fly_1.png`, `heli_fly_2.png`, `heli_fly_3.png` (`heliFly: 74`)
  - `heli_turn_1.png`, `heli_turn_2.png`, `heli_turn_3.png` (`heliTurn: 70`)
- **P-47 Animation (`442×190` fly — uniform canvas anchor):**
  - `p47_fly_1.png`, `p47_fly_2.png`, `p47_fly_3.png` (`p47Fly: 54`)
  - `p47_turn_1.png` (`86`), `p47_turn_2.png` (`108`), `p47_turn_3.png` (`114`)
- **Paratrooper → Infantry Animation (`22px` human height scale):**
  - `para_sway_1.png`, `para_sway_2.png` (`paratrooper: 62`)
  - `para_land_collapse.png` (`paraCollapse: 26`)
  - `inf_turn.png`, `inf_run_1.png`, `inf_run_2.png`, `inf_run_3.png`, `inf_run_4.png` (`infantry: 22`)
- **Civilian Animation (`22px` body, `26.4px` with distress wave flare):**
  - `civ_wave_1.png`, `civ_wave_2.png` (`civilianFlare: 26.4`)
  - `civ_turn.png`, `civ_run_1.png`, `civ_run_2.png`, `civ_run_3.png` (`civilian: 22`)

*(Enemy team variants are auto-tinted via `renderer.getEnemyCanvas(name)` using `hue-rotate(-88deg) saturate(1.24)`.)*

---

## 5. Phase 2 Scope — RTS Ground War, Economy, Civilians & Strategic Call-Ins

Everything below comes directly from [`GAME_DESIGN_SPEC.md`](file:///Users/parsa/Documents/antigravity/glory%20days/GAME_DESIGN_SPEC.md) Sections 2, 5, 6, 7, 8, and 9:

### A. Shared Team War Funds & Bunker Economy
- Every `1.0s` (`60` ticks):
  $$\text{Team Income/sec} = \$10 + (\$6 \times \text{Controlled Bunkers})$$
- **Friendly-fire civilian penalty:** `- $100` from team funds.
- **Aircraft loss replacement cost:** Currently `- $100` on crash (`stepSimulation` & `updateCrashSlide`).
- **Base HQ Destruction Win Condition:** Each HQ has `5,000 HP`. When `hqs[team].hp <= 0`, end/declare match victory cleanly in `state.winner` and render victory overlay/rematch flow.

### B. Requisition System (`Q` -> `[1]`–`[9]`)
- Unlock `[1]`–`[9]` in `REQUISITION_MENU` (`phase: 2` items can either move to active or lose `phase2-locked` dimming once implemented).
- Wire `requisition` command in [`public/js/main.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/public/js/main.mjs) (both WS `{ type: "requisition", key }` and offline local simulation handler) + [`server/index.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/server/index.mjs).
- Replace/augment Phase 1 `state.targets` (or transition `includePracticeTargets` into optional sandbox targets vs full lane AI ground units spawned from HQ/runway exit!). Preserve `includePracticeTargets` behavior expected by existing unit tests in [`tests/simulation.test.mjs`](file:///Users/parsa/Documents/antigravity/glory%20days/tests/simulation.test.mjs).

### C. Ground Unit Classes & Combat AI (`[1]`–`[7]`)
1. **`[1]` Infantry Squad (`$50`, `40 HP`, slow march):**
   - Spawns at friendly HQ (multiple soldiers or unified infantry entity—note helicopters also load friendly base infantry with `E`!).
   - **Only unit class able to capture `Neutral` or `Neutralized (0 HP)` bunkers**, restoring bunker to `1,000 HP`.
   - Fires small arms at enemy infantry & unarmored targets.
2. **`[2]` AA Flak / SAM Truck (`$150`, `140 HP`, fast):**
   - Targets enemy aircraft (`heli`, `p47`, high-alt `b52`, `v2_missile`) with upward flak bursts and locking SAM missiles.
   - Trigger `SAM LOCK` tracking state so aircraft HUD warns pilot to deploy `Z` **Flares**; active `state.flares` spoof nearby incoming SAM missiles!
3. **`[3]` Armored APC (`$225`, `300 HP`, med-fast):**
   - Engages enemy infantry & light/AA vehicles.
   - Upon reaching a `neutral`/`0 HP` bunker **or** upon destruction, deploys **2 friendly Infantry**!
4. **`[4]` Main Battle Tank (`$400`, `650 HP`, medium):**
   - Fires heavy armor-piercing shells at ground vehicles, bunkers, and enemy HQ.
   - Already supports `1.75x` rear-hit bonus damage in projectile hit logic (`rearHit`—make sure ground shells & bombs/rockets keep this bonus!).
5. **`[5]` Self-Propelled Howitzer (`$650`, `1,000 HP`, slow):**
   - Longer standoff artillery range firing high-explosive shells against tanks, bunkers, and HQ.
6. **`[6]` Field Ambulance (`$120`, `150 HP`, fast, unarmed):**
   - Drives automatically toward the nearest stranded Civilian(s), boards up to **6** civilians, then returns to friendly Base HQ to cash them out.
7. **`[7]` Supply / Ammo Truck (`$200`, `180 HP`, medium):**
   - Follows behind friendly frontline column and projects a **`+25 HP/s` repair aura** + ammo resupply for nearby friendly ground armor.

### D. Defensive Structures (Bunkers & Base AA)
- **Captured Bunkers (`1,000 HP`):** Fire defensive bursts at approaching enemy ground/low-air units; turn `neutral` (or `neutralized`, `0 HP`) when destroyed so infantry must enter to recapture.
- **Base AA Battery:** Automated flak/SAM turret protecting `BASES[team]` HQ & Helipad/Runway against spawn-camping.

### E. Civilian Villages & Rescue Loop
- Spawn stranded Civilians in sectors between bunkers (e.g., near `±2700`, `±900`), cycling `civ_wave_1 ↔ civ_wave_2`.
- When a friendly Helicopter touches down or hovers low (`< 15m`) nearby **or** a friendly Ambulance reaches them, civilians play `civ_turn` -> `civ_run_1..3` toward the extractor and board up to capacity (`8` total mixed passengers in Heli, `6` in Ambulance).
- Returning $N$ civilians to friendly Base awards:
  $$\text{Payout} = \$40 \times N + \$15 \times N^2$$
- Killing civilians deals a `-$100` War Funds penalty.

### F. Strategic Call-Ins (`[8]` B-52 Carpet Raid & `[9]` V2 Cruise Missile)
- **`[8]` B-52 Carpet Bombing Raid (`$750`, `900 HP`):**
  - Pressing `8` with `Q` menu open enters radar targeting mode: move target strip center `targetX` along `X` with `ArrowLeft` / `ArrowRight`, confirm with `S` or `Enter` (`Esc`/`Q` cancels).
  - Spawns high-altitude `b52_bomber` flying across the chosen `1,500m` strip, dropping **24 heavy carpet bombs** evenly across the target zone.
  - Can be shot down mid-flight by a climbing P-47 or high-alt SAMs!
- **`[9]` Steerable V2 Cruise Missile (`$850`, `120 HP`):**
  - Launches vertically/arched from `BASES[team].siloX`.
  - Transfers camera focus and `Arrow Keys` steering control of the launching player directly to the V2 missile until detonation against ground units/bunkers/HQ or shoot-down interception (interceptable by enemy bullets, missiles, and AA)!

---

## 6. Phase 3 Scope — Multiplayer, AI Bots, Prediction & HUD Polish

1. **Lobby & Match Modes (1v1, 2v2, 3v3 + Rooms):**
   - Support room/lobby selection or auto-fill teams up to configured size (`1v1`, `2v2`, `3v3`) with **Shared Team War Funds**, shared HQ, shared bunkers.
2. **AI Bot Commanders:**
   - Fill empty slots with AI pilots/commanders that launch sorties (Heli paratrooper drops/rescues & P-47 bombing/strafing/interception) and spend shared team funds wisely via the requisition system.
3. **Network Bandwidth & Client-Side Prediction:**
   - Move from full unthrottled 60 Hz JSON snapshot broadcasts to **20 Hz compact snapshots / deltas** alongside **60 Hz server tick** + smooth client-side local aircraft prediction/reconciliation (`main.mjs`) so flight stays 60 fps silky over real latency.
4. **Diegetic HUD Warnings & Audio/Polish:**
   - On-screen tactical warnings: `SAM LOCK — PRESS Z`, `LOW ALT / STALL`, `REAR HIT x1.75`, `CIVILIAN RESCUED +$...`, V2 steering indicator, B-52 radar reticle overlay, match victory/defeat scoreboard & rematch flow.
   - Render all new Phase 2 entities cleanly on both `SpriteBattlefieldRenderer` (`renderer.mjs`) and `TacticalHud.drawRadar` (`hud.mjs`).

---

## 7. Quick Verification Commands

```bash
# Syntax check shared, server & main game client modules
for f in shared/constants.mjs shared/simulation.mjs server/index.mjs public/js/main.mjs public/js/input.mjs public/js/renderer.mjs public/js/hud.mjs; do
  /Users/parsa/.nvm/versions/node/v22.14.0/bin/node --check "$f" || exit 1
done

# Run simulation test suite (must stay 100% passing)
/Users/parsa/.nvm/versions/node/v22.14.0/bin/node --test tests/simulation.test.mjs

# Run an isolated test server instance without colliding with Flight Lab on :3000
PORT=3001 /Users/parsa/.nvm/versions/node/v22.14.0/bin/node server/index.mjs
```
