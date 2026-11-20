# AGENT.md — Project Context & Engineering Contracts

This file captures the architecture, file map, invariants, and verification commands for **Glory Days Web** (`/Users/parsa/Documents/antigravity/glory days`) so new agent sessions have full context immediately.

---

## 1. Project Goals & Architecture

- **Concept:** 2.5D side-scrolling arcade air-combat + lane-based RTS multiplayer game (*Glory Days 2*-inspired) built as a lightweight browser app.
- **Tech Stack (Lean Dependencies — Prefer Built-Ins):**
  - **Runtime:** Node.js ESM (`>= 22.0.0`, `/Users/parsa/.nvm/versions/node/v22.14.0/bin/node`). Prefer built-in Node/browser APIs and pure `.mjs` where practical; adding external `npm` packages is allowed when there is clear payoff.
  - **Server (`server/index.mjs`):** Native `node:http` static file server + custom RFC 6455 WebSockets over `node:crypto` (`upgrade` on `/ws`). Runs a fixed **60 Hz** (`DT = 1/60`) authoritative simulation loop across rooms (`ALPHA`, `BRAVO`, `CHARLIE`, plus custom rooms) and broadcasts **20 Hz** (`SNAPSHOT_INTERVAL_TICKS = 3`) compact snapshots.
  - **Shared Core (`shared/`):** Identical deterministic simulation & constants imported by both Node (`server/index.mjs`, `tests/simulation.test.mjs`) and the browser (`public/js/*.mjs`).
  - **Client (`public/`):** HTML5 2D Canvas layered parallax sprite renderer using 42 transparent PNG sprites (`public/assets/sprites/*.png`) and layered desert warfare landscape assets (`public/assets/landscape/*.png`) with cached hue-shifted enemy sprites, DS-inspired bottom command deck HUD, 12,000m tactical radar strip, procedural Web Audio SFX, and 60 Hz client-side prediction + snapshot reconciliation.
- **Design Reference Docs:**
  - `GAME_DESIGN_SPEC.md` — Canonical gameplay mechanics, weapon rules, economy, units, and UI spec.
  - `PHASE_2_3_HANDOFF.md` — Sprite catalog, coordinate conventions, and Flight Lab isolation details.

---

## 2. Hard Invariants & Non-Negotiable Constraints

1. **Flight Lab Isolation (Do Not Break P-47 Tuning):**
   - **Never modify** `public/flight-lab.html` or `public/js/flight_lab.mjs` unless explicitly tasked with Flight Lab work.
   - **Preserve** `P47_TUNING_SCHEMA`, `DEFAULT_P47_CONFIG` (`shared/constants.mjs`), and `updateP47Config`, `updateP47`, `updateCrashSlide` (`shared/simulation.mjs`).
2. **Lean Dependency Policy:**
   - Prefer doing the most with existing Node/browser built-ins (`node:http`, `node:crypto`, `node:test`, `node:assert/strict`) and pure ES modules, but adding external `npm` packages to `package.json` is acceptable when there is clear payoff.
3. **Dual Browser + Node Relative Import Paths:**
   - Modules under `public/js/*.mjs` **must** import shared files using relative `../../shared/...` paths (never `/shared/...`). `server/index.mjs` resolves `/shared/*` requests to `shared/*` for the browser, while Node tests resolve `../../shared/...` directly on disk.
4. **Strict Keyboard Gameplay & Non-Blocking Base Landing:**
   - In-match flight, weapons (`A`, `S`, `Z`), utility (`E`), and requisitions (`Q` -> `1–9` / `0`) are keyboard-driven.
   - Touching down on the friendly base pad repairs, re-arms, and evacuates civilians passively with **zero** modal popups. Aircraft swapping (`Q` -> `0`) is strictly manual.
5. **Network Snapshot Completeness:**
   - Because `public/js/main.mjs` runs `stepSimulation()` locally on server-provided snapshots (`welcome` / `snapshot`) for client-side prediction, `createNetworkSnapshot()` in `shared/simulation.mjs` **must** include every top-level state field read by `stepSimulation()` (including `baseAa`, `nextEntityId`, and `botThinkCooldown`).
6. **Flight Lab WebSocket Clients Stay Out of Match Rooms:**
   - `flight_lab.mjs` connects to `/ws` solely to sync `updateP47Config` presets (`Referer` includes `/flight-lab` or `?tuner=1`). `server/index.mjs` treats those connections as `tunerOnly` so they do not occupy slots in `ALPHA`.

---

## 3. Commands & Local Runtime

```bash
# Syntax-check all JS/MJS modules
/Users/parsa/.nvm/versions/node/v22.14.0/bin/node --check \
  shared/constants.mjs shared/simulation.mjs server/index.mjs \
  public/js/audio.mjs public/js/hud.mjs public/js/input.mjs \
  public/js/main.mjs public/js/renderer.mjs tests/simulation.test.mjs

# Run unit & simulation test suite (node:test)
/Users/parsa/.nvm/versions/node/v22.14.0/bin/node --test tests/simulation.test.mjs
# or: npm test

# Start server on default port 3000 (or custom port for isolated checks)
npm start
PORT=3001 /Users/parsa/.nvm/versions/node/v22.14.0/bin/node server/index.mjs
```

- Note on port `3000`: Check `lsof -nP -i :3000` before launching a new server; use `PORT=3001` for automated smoke checks if `:3000` is already running the user's live session.

---

## 4. Codebase File & Symbol Map

| File | Responsibility & Key Symbols |
| :--- | :--- |
| `shared/constants.mjs` | `TICK_RATE` (`60`), `DT` (`1/60`), `WORLD_WIDTH` (`12000`), `MIN_X` (`-6000`), `MAX_X` (`6000`), `GROUND_Y` (`0`), `CEILING_Y` (`1200`), `MISSILE_FUEL_DISTANCE` (`4000`), `GRAVITY` (`380`), Burst Reservoir constants, `BASES` (`allied` HQ `-5400`, `enemy` HQ `+5400`), `BUNKER_X_POSITIONS`, `VILLAGE_X_POSITIONS`, `AIRCRAFT_CONFIG`, `DEFAULT_P47_CONFIG`, `P47_TUNING_SCHEMA`, `RENDER_HEIGHTS`, `REQUISITION_MENU`, `UNIT_CONFIG`, `STRATEGIC_CONFIG`, `DEFENSE_CONFIG`, `SNAPSHOT_RATE` (`20`), `MATCH_MODES` (`1v1`, `2v2`, `3v3`). |
| `shared/simulation.mjs` | `createInitialState`, `createPlayer`, `addPlayer`, `removePlayer`, `syncBotPlayers`, `configureMatch`, `resetMatch`, `setPlayerLobbyChoice`, `startMatch`, `returnToLobby`, `isOnFriendlyPad`, `updateP47Config`, `spawnPlayerP47Test`, `swapPlayerAircraft`, `spawnGroundUnit`, `handlePlayerRequisition`, `handlePlayerUtility`, `updateP47`, `updateCrashSlide`, `computeBotPilotInput`, `createNetworkSnapshot`, `reconcileClientState`, `stepSimulation` (Heli & P-47 physics, ground unit AIs, bunker & base AA, SAMs & flare spoofing, civilian rescue/penalties, B-52 raid, steerable V2, AI Bot Commanders). |
| `server/index.mjs` | HTTP static server (`/`, `/flight-lab`, `/shared/*`, `Cache-Control: no-store`), WS upgrade (`/ws`), `rooms` map (`ALPHA`, `BRAVO`, `CHARLIE`, custom), `attachClientToRoom`, `broadcastRoomSnapshot`, 60 Hz loop & 20 Hz snapshot dispatch. |
| `public/index.html` | Game viewport canvas, top HQ/funds/bunker HUD bar, `#base-banner`, `#tactical-alert`, `#victory-banner`, `#lobby-overlay`, `#q-drawer`, `#command-deck`. |
| `public/js/main.mjs` | Client bootstrap (`localStorage` key `glory_days_p47_config_v2`), `/ws` lifecycle with offline sandbox fallback, lobby/HUD callbacks, `dispatchEvents` dedup (`seenEventKeys`), 60 Hz prediction `loop(now)`. |
| `public/js/input.mjs` | `KeyboardInput`: lobby hotkeys (`Enter`/`Space`, `ArrowLeft`/`ArrowRight`, `1`/`2`, `M`, `B`, `N`) and gameplay controls (`Arrow*`, `A`, `S`, `Z`, `E`, `Q`, `0–9`, `R`, `L`, `M`, `B`, `N`, `Escape`), `resolveCode(e)`, `getSnapshot()`. |
| `public/js/hud.mjs` | `TacticalHud`: lobby UI sync, HQ bars, funds, bunker pips, `Q` drawer cards, burst/ammo/flare/cabin readouts, victory scoreboard, `drawRadar` 12,000m minimap. |
| `public/js/renderer.mjs` | `SpriteBattlefieldRenderer`: preloads 42 sprites and layered Option 3 desert warfare landscape (`public/assets/landscape/*.png`), `getEnemyCanvas` hue-shift cache, smooth camera look-ahead & zoom, gradient light-blue sky with clouds, distant sea horizon, parallax dunes/ground cutaway & sparse desert fortifications, ground entities, B-52 aiming overlay, projectiles, flares, smoke/explosions/floating labels. |
| `public/js/audio.mjs` | `BattlefieldAudio`: procedural Web Audio API SFX synthesizer driven by simulation events (`primary_fired`, `secondary_fired`, `flare_deployed`, `sam_launched`, `explosion`, `civilians_rescued`, `bunker_captured`, `b52_raid_called`, `v2_launched`, `match_won`). |
| `public/flight-lab.html` & `public/js/flight_lab.mjs` | Standalone P-47 physics tuning & test scenario gym (off-limits unless requested). |
| `public/js/dev_tuner.mjs` | Legacy unused tuner drawer module kept for reference. |
| `tests/simulation.test.mjs` | Automated `node:test` suite covering flight physics, weapons, Phase 2 RTS/civilians/strategic call-ins, Phase 3 bots/network snapshots/reconciliation, and lobby state transitions. |

---

## 5. WebSocket Protocol (`/ws`)

- **Server → Client:**
  - `welcome`: `{ type: "welcome", playerId, team, roomId, state, rooms, p47Config }`
  - `snapshot`: `{ type: "snapshot", state, rooms }` (at 20 Hz + immediate on `match_won`, `match_reset`, `match_configured`, lobby changes)
  - `p47Config`: `{ type: "p47Config", config }`
- **Client → Server:**
  - Lobby/Room: `joinRoom` (`roomId`, `team`, `aircraftType`, `callsign`), `lobbySelect` (`team`, `aircraftType`, `callsign`, `ready`), `configureMatch` (`matchMode`, `botsEnabled`), `startMatch`, `returnToLobby`, `restartMatch`
  - Gameplay: `input` (`{ left, right, up, down, firePrimary, fireSecondary, fireFlare }`), `requisition` (`key`, optional `targetX`), `swapAircraft`, `utility`
  - Flight Lab Tuner Bridge: `updateP47Config` (`patch`, `persist`), `spawnP47Test` (`mode`)
