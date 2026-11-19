# Glory Days Web

**Glory Days Web** is a browser-based 2.5D side-scrolling arcade air-combat and lane-based RTS multiplayer game inspired by *Glory Days 2* (Nintendo DS) and *Super Army War* (GBA).

Pilot either an **Attack & Transport Helicopter** or a **P-47 Thunderbolt** across a 12,000m battlefield, capture checkpoint bunkers with troops, rescue stranded civilians, spend shared team War Funds on ground units and strategic call-ins, and destroy the enemy HQ.

---

## Quick Start

**Requirements:** Node.js `>= 22.0.0` (zero external `npm` packages required).

```bash
# Start the authoritative game & static server (default port 3000)
npm start

# Or run on a custom port
PORT=3001 npm start

# Run the simulation unit test suite
npm test
```

Then open:
- **Main Game & Lobby:** `http://localhost:3000/`
- **P-47 Physics Flight Lab:** `http://localhost:3000/flight-lab` (standalone physics test gym)

---

## Pre-Match Lobby & Multiplayer

When you connect, you start in the **Pre-Match Lobby**:
- **Rooms:** Join preset rooms (`ALPHA`, `BRAVO`, `CHARLIE`) or enter any custom room ID.
- **Modes (`M`):** `1v1 Duel`, `2v2 Wingmen`, or `3v3 Total War`.
- **AI Bots (`B`):** Toggle AI wingmen/opponents and AI ground commanders on or off (missing human slots auto-fill with bots when enabled).
- **Teams & Aircraft:** Pick **Allied (West HQ)** or **Enemy (East HQ)** (`←` / `→`), callsign, and starting aircraft (`[1]` Helicopter or `[2]` P-47 Thunderbolt).
- **Launch:** Click **LAUNCH SORTIE** (or press `Enter` / `Space`). In multi-player rooms, clicking **READY** on every connected human also starts the match automatically.

---

## Controls (100% Keyboard)

| Key | Helicopter | P-47 Thunderbolt |
| :--- | :--- | :--- |
| **`←` / `→`** | Lateral thrust & turn around | Throttle forward / opposite-key brake & U-turn |
| **`↑` / `↓`** | Collective climb / descend | Pitch climb / dive (takes off above `185 u/s`) |
| **`A`** | Forward cockpit autocannon (Burst Reservoir) | Wing autocannons (Burst Reservoir) |
| **`S`** | Drop free-fall bomb (`12` max) | Fire straight 4,000m rocket (`8` max) |
| **`Z`** | Deploy countermeasure flare (`4` max) | Deploy countermeasure flare (`6` max) |
| **`E`** | Load troops on base pad / drop paratrooper in air | — |
| **`Q`** | Open / close Requisition & Base menu | Open / close Requisition & Base menu |
| **`Q` → `1–9`** | Purchase ground unit / call-in | Purchase ground unit / call-in |
| **`Q` → `0`** | Swap to P-47 (while landed on Base Pad) | Swap to Helicopter (while landed on Base Pad) |

**Match & Utility Hotkeys:**
- **`M`:** Cycle match mode (`1v1` / `2v2` / `3v3`)
- **`B`:** Toggle AI bots
- **`N`:** Mute / unmute procedural Web Audio SFX
- **`L`:** Return to room lobby
- **`R`:** Rematch after victory / defeat

---

## Core Gameplay & Units

- **Bases & Resupply:** Allied HQ sits at `-5400m` and Enemy HQ at `+5400m` (`5,000 HP` each). Landing smoothly on your base pad automatically repairs HP, reloads secondary ammo and flares, and cashes in rescued civilians—with no modal popups.
- **Checkpoints & Income:** Five bunkers sit at `-3600m`, `-1800m`, `0m`, `+1800m`, and `+3600m`. Only **Infantry** (marching or airdropped as paratroopers) can capture neutral or destroyed bunkers. Teams start with `$500` and earn `$10/s + $6/s` per owned bunker.
- **Civilian Rescue:** Civilians periodically appear in warzone villages (`±900m`, `±2700m`). Evacuating a batch of `N` civilians via Helicopter or Field Ambulance pays `$(40N + 15N²)` (killing a civilian penalizes `$100`).
- **Requisition Menu (`Q` → `1–9`):**
  1. `[1]` **Infantry Squad** (`$50`) — Captures bunkers & fights lightly armored targets
  2. `[2]` **AA Flak / SAM Truck** (`$150`) — Flak bursts + homing SAMs (spoofable with `Z` flares)
  3. `[3]` **Armored APC** (`$225`) — Escorts front line & deploys 2 infantry at neutral bunkers or on destruction
  4. `[4]` **Main Battle Tank** (`$400`) — Heavy armor & direct cannon (`1.75×` damage on rear hits)
  5. `[5]` **Self-Propelled Howitzer** (`$650`) — Long-range splash artillery (`1,000 HP`)
  6. `[6]` **Field Ambulance** (`$120`) — Drives to villages, loads up to 6 civilians, and returns them to HQ
  7. `[7]` **Supply / Ammo Truck** (`$200`) — +25 HP/s area repair aura for nearby ground units
  8. `[8]` **B-52 Carpet Raid** (`$750`) — Aims a 1,500m bombing strip (`←`/`→`, confirm with `S`/`Enter`); bomber is interceptable mid-air
  9. `[9]` **Steerable V2 Cruise Missile** (`$850`) — Launches from Base Silo; arrow keys steer speed and pitch directly into targets

---

## Project Structure

```text
glory days/
├── package.json            # Pure Node ESM scripts (start, test); zero dependencies
├── server/
│   └── index.mjs           # Static HTTP server, RFC 6455 WebSockets (/ws), multi-room 60 Hz loop & 20 Hz snapshots
├── shared/
│   ├── constants.mjs       # World bounds, bases, aircraft/unit/defense stats, P47_TUNING_SCHEMA, match modes
│   └── simulation.mjs      # Authoritative 60 Hz simulation, AI bots/commanders, lobby helpers, snapshot/reconciliation
├── public/
│   ├── index.html          # Main game viewport, DS-style bottom command deck & pre-match lobby UI
│   ├── flight-lab.html     # Standalone P-47 physics test gym UI
│   ├── assets/sprites/     # 42 transparent side-profile PNG sprites
│   └── js/
│       ├── main.mjs        # Client entry point, WS sync & local 60 Hz prediction loop
│       ├── input.mjs       # Keyboard-only controller
│       ├── hud.mjs         # HUD telemetry, lobby bindings, requisition drawer & 12,000m radar
│       ├── renderer.mjs    # Layered 2.5D parallax Canvas sprite renderer & enemy hue-tint cache
│       ├── audio.mjs       # Procedural Web Audio API SFX synthesizer
│       └── flight_lab.mjs  # Standalone P-47 tuning & scenario simulator
├── tests/
│   └── simulation.test.mjs # Unit & simulation tests (node:test)
├── GAME_DESIGN_SPEC.md     # Full design & gameplay specification
└── PHASE_2_3_HANDOFF.md    # Technical reference for Phase 2/3 & P-47 Flight Lab contracts
```
