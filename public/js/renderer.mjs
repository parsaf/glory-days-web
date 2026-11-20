import {
  AIRCRAFT_CONFIG,
  BASES,
  MAX_X,
  MIN_X,
  MISSILE_FUEL_DISTANCE,
  RENDER_HEIGHTS,
  STRATEGIC_CONFIG,
  UNIT_CONFIG,
  WORLD_WIDTH
} from "../../shared/constants.mjs";

const SPRITE_NAMES = [
  "aa_flak_truck", "ambulance", "b52_bomber", "base_hq", "bunker",
  "civilian", "helicopter", "infantry", "main_battle_tank", "p47_thunderbolt",
  "paratrooper", "self_propelled_howitzer", "supply_truck", "v2_missile", "v2_silo",
  "heli_fly_1", "heli_fly_2", "heli_fly_3", "heli_turn_1", "heli_turn_2", "heli_turn_3",
  "p47_fly_1", "p47_fly_2", "p47_fly_3", "p47_turn_1", "p47_turn_2", "p47_turn_3",
  "para_sway_1", "para_sway_2", "para_land_collapse", "inf_turn",
  "inf_run_1", "inf_run_2", "inf_run_3", "inf_run_4",
  "civ_wave_1", "civ_wave_2", "civ_turn", "civ_run_1", "civ_run_2", "civ_run_3"
];

const LANDSCAPE_ASSET_NAMES = [
  "sea_horizon_tile",
  "far_dunes_tile",
  "mid_desert_tile",
  "ground_strip_tile",
  "cloud_1",
  "cloud_2",
  "cloud_3",
  "prop_tank_traps",
  "prop_barbed_wire"
];

// Intentionally sparse roadside desert fortification accents across the 12,000m front
const DESERT_PROPS = [
  { key: "prop_tank_traps", x: -4780, y: 5, height: 46, flipX: false },
  { key: "prop_barbed_wire", x: -3430, y: 6, height: 36, flipX: false },
  { key: "prop_tank_traps", x: -1985, y: 5, height: 46, flipX: true },
  { key: "prop_barbed_wire", x: -940, y: 6, height: 36, flipX: false },
  { key: "prop_tank_traps", x: 185, y: 5, height: 46, flipX: false },
  { key: "prop_tank_traps", x: 1985, y: 5, height: 46, flipX: false },
  { key: "prop_barbed_wire", x: 3430, y: 6, height: 36, flipX: true },
  { key: "prop_tank_traps", x: 4780, y: 5, height: 46, flipX: true }
];

export class SpriteBattlefieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sprites = new Map();
    this.landscape = new Map();
    this.enemyTinted = new Map();
    this.explosions = [];
    this.smokeTrail = [];
    this.floatingLabels = [];
    this.camX = BASES.allied.padCenterX + 180;
    this.camY = 180;
    this.camZoom = 1.0;
    this.ready = false;
    this.showHealthBars = true;
    this.showUnitHealthBars = false;
    this.showHealthText = false;
    this.colorHealthBarsByHp = false;
  }

  clearEffects() {
    this.explosions.length = 0;
    this.smokeTrail.length = 0;
    this.floatingLabels.length = 0;
  }

  async loadAll() {
    const loadBatch = (names, map, basePath) =>
      names.map(
        (name) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              map.set(name, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = `${basePath}/${name}.png`;
          })
      );
    await Promise.all([
      ...loadBatch(SPRITE_NAMES, this.sprites, "/assets/sprites"),
      ...loadBatch(LANDSCAPE_ASSET_NAMES, this.landscape, "/assets/landscape")
    ]);
    this.ready = true;
  }

  getEnemyCanvas(name) {
    if (this.enemyTinted.has(name)) return this.enemyTinted.get(name);
    const img = this.sprites.get(name);
    if (!img) return null;
    const off = document.createElement("canvas");
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const octx = off.getContext("2d");
    octx.filter = "hue-rotate(-88deg) saturate(1.24)";
    octx.drawImage(img, 0, 0);
    this.enemyTinted.set(name, off);
    return off;
  }

  ingestEvents(events) {
    for (const ev of events) {
      if (ev.type === "explosion") {
        this.explosions.push({
          x: ev.x,
          y: ev.y,
          radius: 14 * (ev.size || 1),
          life: 0.42,
          maxLife: 0.42,
          rearHit: ev.rearHit
        });
      } else if (ev.type === "hard_landing") {
        this.explosions.push({
          x: ev.x,
          y: 8,
          radius: 14,
          life: 0.35,
          maxLife: 0.35,
          rearHit: false
        });
      } else if (ev.type === "civilians_rescued") {
        this.floatingLabels.push({
          x: BASES[ev.team]?.padCenterX || 0,
          y: 100,
          text: `+$${ev.payout} RESCUED!`,
          color: "#86efac",
          life: 1.5,
          maxLife: 1.5
        });
      }
    }
  }

  updateCamera(focusPlayer, dt) {
    if (!focusPlayer) return;
    const lookAheadX = focusPlayer.vx * 0.42 + focusPlayer.dir * 130;
    const targetX = Math.max(MIN_X + 380, Math.min(MAX_X - 380, focusPlayer.x + lookAheadX));
    const targetY = Math.max(150, Math.min(760, focusPlayer.y + 90));
    const speedNorm = Math.min(1, Math.abs(focusPlayer.vx) / Math.max(1, AIRCRAFT_CONFIG.p47.maxSpeed));
    const targetZoom = focusPlayer.aircraftType === "p47" ? 0.92 - speedNorm * 0.14 : 1.05 - speedNorm * 0.10;

    const lerp = Math.min(1, dt * 6);
    this.camX += (targetX - this.camX) * lerp;
    this.camY += (targetY - this.camY) * lerp;
    this.camZoom += (targetZoom - this.camZoom) * Math.min(1, dt * 3);
  }

  worldToScreen(wx, wy, w, groundScreenY) {
    return {
      sx: w * 0.5 + (wx - this.camX) * this.camZoom,
      sy: groundScreenY - wy * this.camZoom
    };
  }

  drawWorldImage(src, worldX, worldY, targetHeightWorld, opts = {}, w, groundScreenY) {
    if (!src) return;
    const natW = src.naturalWidth || src.width;
    const natH = src.naturalHeight || src.height;
    if (!natW || !natH) return;

    const h = targetHeightWorld * this.camZoom;
    const width = h * (natW / natH);
    const { sx, sy } = this.worldToScreen(worldX, worldY, w, groundScreenY);
    const anchorBottom = opts.anchorBottom !== false;
    const flipX = Boolean(opts.flipX);
    const angle = opts.angle || 0;

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, anchorBottom ? sy - h * 0.5 : sy);
    if (flipX) ctx.scale(-1, 1);
    if (angle) ctx.rotate(angle);
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.crashing) ctx.filter = "brightness(0.55) saturate(0.65)";
    ctx.drawImage(src, -width * 0.5, -h * 0.5, width, h);
    ctx.restore();
  }

  drawSprite(name, worldX, worldY, targetHeightWorld, opts = {}, w, groundScreenY) {
    const src = opts.team === "enemy" ? this.getEnemyCanvas(name) : this.sprites.get(name);
    this.drawWorldImage(src, worldX, worldY, targetHeightWorld, opts, w, groundScreenY);
  }

  drawLandscapeProp(name, worldX, worldY, targetHeightWorld, opts = {}, w, groundScreenY) {
    const src = this.landscape.get(name);
    this.drawWorldImage(src, worldX, worldY, targetHeightWorld, opts, w, groundScreenY);
  }

  getAircraftFrame(player) {
    const isHeli = player.aircraftType === "heli";
    const spin = (Math.floor(player.rotorPhase) % 3) + 1;
    const prefix = isHeli ? "heli" : "p47";

    if (player.turnTimer > 0) {
      const p = player.turnTimer / player.turnDuration;
      let frameKey = `${prefix}_turn_1`;
      let flipX = player.turnStartDir < 0;
      if (p < 0.2) { frameKey = `${prefix}_turn_1`; flipX = player.turnStartDir < 0; }
      else if (p < 0.4) { frameKey = `${prefix}_turn_2`; flipX = player.turnStartDir < 0; }
      else if (p < 0.6) { frameKey = `${prefix}_turn_3`; flipX = player.turnStartDir < 0; }
      else if (p < 0.8) { frameKey = `${prefix}_turn_2`; flipX = player.turnStartDir > 0; }
      else { frameKey = `${prefix}_turn_1`; flipX = player.turnStartDir > 0; }

      const hMap = isHeli
        ? { heli_turn_1: RENDER_HEIGHTS.heliTurn, heli_turn_2: RENDER_HEIGHTS.heliTurn, heli_turn_3: RENDER_HEIGHTS.heliTurn }
        : { p47_turn_1: RENDER_HEIGHTS.p47Turn1, p47_turn_2: RENDER_HEIGHTS.p47Turn2, p47_turn_3: RENDER_HEIGHTS.p47Turn3 };
      return { key: frameKey, flipX, height: hMap[frameKey], angle: 0 };
    }

    // Canvas rotate sign flips relative to world Y because screen Y increases downward;
    // when flipX is active, ctx.scale(-1, 1) already mirrors local X, so rotate(-pitch) tilts nose down for both dirs
    const angle = isHeli ? -player.pitch : -(player.effectivePitch ?? player.pitch);
    return {
      key: `${prefix}_fly_${spin}`,
      flipX: player.dir < 0,
      height: isHeli ? RENDER_HEIGHTS.heliFly : RENDER_HEIGHTS.p47Fly,
      angle
    };
  }

  render(state, localPlayerId, dt, b52Aiming = null, cameraOverride = null) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const focusPlayer = state.players[localPlayerId] || Object.values(state.players)[0];
    let camTarget = focusPlayer;
    if (focusPlayer?.controllingV2Id) {
      const v2 = (state.v2s || []).find((v) => v.id === focusPlayer.controllingV2Id && v.alive);
      if (v2) {
        camTarget = { x: v2.x, y: v2.y, vx: v2.vx, dir: v2.dir, aircraftType: "p47" };
      }
    }
    if (cameraOverride) {
      if (!cameraOverride.manual) {
        const tx = cameraOverride.x ?? this.camX;
        const ty = cameraOverride.y ?? this.camY;
        const tz = cameraOverride.zoom ?? this.camZoom;
        if (cameraOverride.snap) {
          this.camX = tx;
          this.camY = ty;
          this.camZoom = tz;
        } else {
          const lerpPos = Math.min(1, dt * 8);
          const lerpZoom = Math.min(1, dt * 6);
          this.camX += (tx - this.camX) * lerpPos;
          this.camY += (ty - this.camY) * lerpPos;
          this.camZoom += (tz - this.camZoom) * lerpZoom;
        }
      }
    } else {
      this.updateCamera(camTarget, dt);
    }

    // Keep ground visible cleanly near lower fifth while climbing
    const groundScreenY = Math.min(h - 54, Math.max(h * 0.72, h * 0.82 + (this.camY - 150) * 0.35 * this.camZoom));
    this.lastViewW = w;
    this.lastViewH = h;
    this.lastGroundScreenY = groundScreenY;

    const getHpColor = (hp, maxHp, defaultColor) => {
      if (!this.colorHealthBarsByHp) return defaultColor;
      const ratio = maxHp > 0 ? hp / maxHp : 0;
      return ratio > 0.6 ? "#22c55e" : ratio > 0.3 ? "#f59e0b" : "#ef4444";
    };

    const z = this.camZoom;
    const scaleZ = Math.max(0.76, z);
    const simTime = state.time || 0;
    const seaHorizonY = Math.max(
      h * 0.34,
      Math.min(groundScreenY - 120 * scaleZ, groundScreenY - 196 * scaleZ)
    );

    // 1. Option 3 Sun-Bleached Desert Coastal Front Backdrop
    this.drawDesertSky(w, h, seaHorizonY);
    this.drawDesertClouds(w, seaHorizonY, simTime, scaleZ);
    this.drawDistantSea(w, groundScreenY, seaHorizonY, simTime, scaleZ);
    this.drawDesertDunes(w, groundScreenY, scaleZ, z);

    // 2. Desert Combat War-Road, Sandstone Strata Cutaway & Sparse Props
    this.drawDesertGround(w, h, groundScreenY, z);

    // World Distance Markers (every 200m in compact arenas, 1,000m on full map)
    const worldMinX = state.worldBounds?.minX ?? MIN_X;
    const worldMaxX = state.worldBounds?.maxX ?? MAX_X;
    const markerStep = (worldMaxX - worldMinX) <= 4000 ? 200 : 1000;
    const firstMark = Math.ceil(worldMinX / markerStep) * markerStep;
    const groundScale = Math.max(0.875, z);
    ctx.font = "700 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (let wx = firstMark; wx <= worldMaxX; wx += markerStep) {
      const { sx } = this.worldToScreen(wx, 0, w, groundScreenY);
      if (sx < -60 || sx > w + 60) continue;
      ctx.fillStyle = "rgba(66, 42, 20, 0.55)";
      ctx.fillRect(sx - 1, groundScreenY + 26 * groundScale, 2, 7);
      this.drawOutlinedText(`${wx}m`, sx, groundScreenY + 44 * groundScale, "rgba(255, 245, 224, 0.9)", "rgba(42, 24, 12, 0.85)", 2.4);
    }
    if (state.worldBounds) {
      ctx.save();
      ctx.strokeStyle = "rgba(92, 68, 44, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      for (const edgeX of [worldMinX, worldMaxX]) {
        const { sx } = this.worldToScreen(edgeX, 0, w, groundScreenY);
        if (sx >= -10 && sx <= w + 10) {
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, groundScreenY);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    ctx.textAlign = "left";

    // Sparse roadside fortification props (drawn behind active HQs, bunkers, and combat units)
    this.drawDesertProps(state, w, groundScreenY);

    // 3. Bases & Landing Pads
    for (const side of ["allied", "enemy"]) {
      const hq = state.hqs?.[side];
      if (hq?.hidden) continue;
      const base = BASES[side];
      const hqX = hq?.x ?? base.hqX;
      const dx = hqX - base.hqX;
      const padMin = hq?.compactBase ? hqX - 110 : base.padMinX + dx;
      const padMax = hq?.compactBase ? hqX + 110 : base.padMaxX + dx;
      const padLeft = this.worldToScreen(padMin, 0, w, groundScreenY).sx;
      const padRight = this.worldToScreen(padMax, 0, w, groundScreenY).sx;
      this.drawLandingPad(padLeft, padRight, groundScreenY, z);

      if (!hq?.compactBase) {
        const sockX = side === "allied" ? padMax + 35 : padMin - 35;
        this.drawAirfieldWindsock(sockX, side === "enemy", simTime, w, groundScreenY);
        this.drawGroundShadow(base.siloX + dx, 118, w, groundScreenY);
        this.drawSprite("v2_silo", base.siloX + dx, 0, RENDER_HEIGHTS.v2Silo, { team: side, flipX: side === "enemy" }, w, groundScreenY);
      }
      this.drawGroundShadow(hqX, 170, w, groundScreenY);
      this.drawSprite("base_hq", hqX, 0, RENDER_HEIGHTS.baseHq, { team: side, flipX: side === "enemy" }, w, groundScreenY);

      if (hq && this.showHealthBars && (hq.hp < hq.maxHp || this.showHealthText)) {
        const { sx, sy } = this.worldToScreen(hqX, RENDER_HEIGHTS.baseHq + 18, w, groundScreenY);
        if (sx > -120 && sx < w + 120) {
          const ratio = hq.maxHp > 0 ? Math.max(0, hq.hp / hq.maxHp) : 0;
          ctx.fillStyle = "rgba(0,0,0,0.65)";
          ctx.fillRect(sx - 44, sy, 88, 7);
          ctx.fillStyle = getHpColor(hq.hp, hq.maxHp, side === "allied" ? "#3b82f6" : "#ef4444");
          ctx.fillRect(sx - 44, sy, 88 * ratio, 7);
          if (this.showHealthText) {
            ctx.font = "700 10px ui-monospace, monospace";
            ctx.textAlign = "center";
            this.drawOutlinedText(`${Math.ceil(hq.hp)}/${Math.round(hq.maxHp)}`, sx, sy - 4, "#f8fafc");
            ctx.textAlign = "left";
          }
        }
      }
    }

    // 4. Bunkers (Checkpoints)
    for (const b of state.bunkers) {
      this.drawGroundShadow(b.x, 128, w, groundScreenY);
      this.drawSprite("bunker", b.x, 0, RENDER_HEIGHTS.bunker, { team: b.owner === "enemy" ? "enemy" : "allied" }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(b.x, RENDER_HEIGHTS.bunker + 14, w, groundScreenY);
      if (sx > -100 && sx < w + 100) {
        const label = b.hp <= 0 ? "NEUTRALIZED" : b.owner.toUpperCase();
        const labelCol = b.hp <= 0 ? "#fbbf24" : b.owner === "allied" ? "#60a5fa" : b.owner === "enemy" ? "#f87171" : "#e2e8f0";
        ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        this.drawOutlinedText(label, sx, sy, labelCol);
        if (this.showHealthBars && b.hp > 0 && (b.hp < b.maxHp || (this.showHealthText && b.owner !== "neutral"))) {
          const ratio = b.maxHp > 0 ? Math.max(0, b.hp / b.maxHp) : 0;
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx - 28, sy + 5, 56, 4);
          const defaultCol = b.owner === "allied" ? "#3b82f6" : b.owner === "enemy" ? "#ef4444" : "#94a3b8";
          ctx.fillStyle = getHpColor(b.hp, b.maxHp, defaultCol);
          ctx.fillRect(sx - 28, sy + 5, 56 * ratio, 4);
          if (this.showHealthText) {
            ctx.font = "700 9px ui-monospace, monospace";
            this.drawOutlinedText(`${Math.ceil(b.hp)}/${Math.round(b.maxHp)}`, sx, sy - 11, "#f8fafc");
          }
        }
        ctx.textAlign = "left";
      }
    }

    // 4b. Stranded Civilians
    for (const civ of state.civilians || []) {
      let key = Math.floor(civ.animPhase) % 2 === 0 ? "civ_wave_1" : "civ_wave_2";
      let targetH = RENDER_HEIGHTS.civilianFlare;
      if (civ.state === "turn") {
        key = "civ_turn";
        targetH = RENDER_HEIGHTS.civilian;
      } else if (civ.state === "run") {
        const frame = (Math.floor(civ.animPhase * 1.6) % 3) + 1;
        key = `civ_run_${frame}`;
        targetH = RENDER_HEIGHTS.civilian;
      }
      this.drawSprite(key, civ.x, civ.y || 0, targetH, { team: "allied", flipX: civ.dir < 0 }, w, groundScreenY);
    }

    // 5. Practice Ground Targets & RTS Ground Units
    const unitHeightMap = {
      infantry: RENDER_HEIGHTS.infantry,
      aa_flak_truck: RENDER_HEIGHTS.aaTruck,
      main_battle_tank: RENDER_HEIGHTS.mbt,
      self_propelled_howitzer: RENDER_HEIGHTS.howitzer,
      ambulance: RENDER_HEIGHTS.ambulance,
      supply_truck: RENDER_HEIGHTS.supplyTruck
    };

    for (const t of state.targets) {
      if (t.hp <= 0) continue;
      const th = unitHeightMap[t.kind] || 48;
      this.drawGroundShadow(t.x, t.kind === "infantry" ? 20 : 76, w, groundScreenY);
      this.drawSprite(t.kind, t.x, 0, th, { team: t.team, flipX: t.dir < 0 }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(t.x, th + 12, w, groundScreenY);
      if (this.showHealthBars && this.showUnitHealthBars && sx > -80 && sx < w + 80) {
        const ratio = t.maxHp > 0 ? Math.max(0, t.hp / t.maxHp) : 0;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(sx - 24, sy, 48, 5);
        ctx.fillStyle = getHpColor(t.hp, t.maxHp, "#ef4444");
        ctx.fillRect(sx - 24, sy, 48 * ratio, 5);
        if (this.showHealthText) {
          ctx.font = "700 9px ui-monospace, monospace";
          ctx.textAlign = "center";
          this.drawOutlinedText(`${Math.ceil(t.hp)}/${Math.round(t.maxHp)}`, sx, sy - 3, "#f8fafc");
          ctx.textAlign = "left";
        }
      }
    }

    for (const u of state.units || []) {
      if (u.hp <= 0) continue;
      const uh = unitHeightMap[u.kind] || 48;
      if (u.kind !== "infantry" && u.hp < u.maxHp && state.tick % 4 === 0) {
        const dmgRatio = 1 - u.hp / u.maxHp;
        if (Math.random() < 0.35 + dmgRatio * 0.65) {
          this.smokeTrail.push({
            x: u.x - u.dir * 8,
            y: uh * 0.55 + 4,
            r: 4 + dmgRatio * 4,
            life: 0.4,
            maxLife: 0.4,
            color: dmgRatio > 0.6 ? "#475569" : "#94a3b8"
          });
        }
      }
      if (u.kind === "supply_truck") {
        const { sx } = this.worldToScreen(u.x, 0, w, groundScreenY);
        const auraR = (UNIT_CONFIG.supply_truck.auraRadius ?? 240) * this.camZoom;
        if (sx > -auraR && sx < w + auraR) {
          ctx.fillStyle = "rgba(34, 197, 94, 0.14)";
          ctx.fillRect(sx - auraR, groundScreenY - 6 * this.camZoom, auraR * 2, 10 * this.camZoom);
        }
      }
      if (!u.y) {
        this.drawGroundShadow(u.x, u.kind === "infantry" ? 20 : 84, w, groundScreenY);
      }
      const spriteKey = u.kind === "infantry"
        ? `inf_run_${(Math.floor(u.walkPhase || 0) % 4) + 1}`
        : u.kind;
      this.drawSprite(spriteKey, u.x, u.y || 0, uh, { team: u.team, flipX: u.dir < 0 }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(u.x, uh + 10, w, groundScreenY);
      if (sx > -80 && sx < w + 80) {
        const barW = u.kind === "infantry" ? 24 : 46;
        if (this.showHealthBars && this.showUnitHealthBars) {
          const ratio = u.maxHp > 0 ? Math.max(0, u.hp / u.maxHp) : 0;
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx - barW * 0.5, sy, barW, 4);
          const defaultHpColor = u.hp < u.maxHp
            ? (u.hp < u.maxHp * 0.35 ? "#ef4444" : "#f59e0b")
            : (u.team === "allied" ? "#3b82f6" : "#ef4444");
          ctx.fillStyle = getHpColor(u.hp, u.maxHp, defaultHpColor);
          ctx.fillRect(sx - barW * 0.5, sy, barW * ratio, 4);
          if (this.showHealthText) {
            ctx.font = "700 9px ui-monospace, monospace";
            ctx.textAlign = "center";
            this.drawOutlinedText(`${Math.ceil(u.hp)}/${Math.round(u.maxHp)}`, sx, sy - 4, "#f8fafc");
            ctx.textAlign = "left";
          }
        }
        if (u.kind === "ambulance" && u.passengers?.length > 0) {
          ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          this.drawOutlinedText(`+${u.passengers.length} CIV`, sx, sy - (this.showHealthBars && this.showHealthText ? 14 : 4), "#fde047");
          ctx.textAlign = "left";
        }
      }
    }

    // 6. Paratroopers -> Seamless Infantry Transition
    for (const p of state.paratroopers) {
      let key = "para_sway_1";
      let targetH = RENDER_HEIGHTS.paratrooper;
      if (p.phase === "descent") {
        key = Math.floor(state.time * 4) % 2 === 0 ? "para_sway_1" : "para_sway_2";
        targetH = RENDER_HEIGHTS.paratrooper;
      } else if (p.phase === "collapse") {
        key = "para_land_collapse";
        targetH = RENDER_HEIGHTS.paraCollapse;
      } else {
        const frame = (Math.floor(p.walkPhase) % 4) + 1;
        key = `inf_run_${frame}`;
        targetH = RENDER_HEIGHTS.infantry;
      }
      this.drawSprite(key, p.x, p.y, targetH, { team: p.team, flipX: p.dir < 0 }, w, groundScreenY);
    }

    // 7. Player Aircraft
    for (const player of Object.values(state.players)) {
      if (!player.alive) continue;
      if (player.crashing) {
        this.smokeTrail.push({
          x: player.x - player.dir * 16,
          y: 12 + Math.random() * 8,
          r: 8 + Math.random() * 6,
          life: 0.45,
          maxLife: 0.45,
          color: Math.random() > 0.35 ? "#334155" : "#f97316"
        });
      }
      if (player.y < 14) {
        this.drawGroundShadow(player.x, 96, w, groundScreenY);
      }
      const frame = this.getAircraftFrame(player);
      this.drawSprite(
        frame.key,
        player.x,
        player.y,
        frame.height,
        { team: player.team, flipX: frame.flipX, angle: frame.angle, crashing: player.crashing },
        w,
        groundScreenY
      );

      const { sx, sy } = this.worldToScreen(player.x, player.y + frame.height + 10, w, groundScreenY);
      if (sx > -120 && sx < w + 120) {
        ctx.textAlign = "center";
        const isLocal = player.id === localPlayerId;
        const label = isLocal ? "YOU" : (player.callsign || player.id.toUpperCase());
        ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
        const labelCol = isLocal ? "#fde047" : player.team === "allied" ? "#93c5fd" : "#fca5a5";
        this.drawOutlinedText(label, sx, sy, labelCol);

        if (!isLocal && this.showHealthBars) {
          const ratio = player.maxHp > 0 ? Math.max(0, player.hp / player.maxHp) : 0;
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx - 22, sy + 4, 44, 4);
          ctx.fillStyle = getHpColor(player.hp, player.maxHp, player.team === "allied" ? "#3b82f6" : "#ef4444");
          ctx.fillRect(sx - 22, sy + 4, 44 * ratio, 4);
          if (this.showHealthText) {
            ctx.font = "700 9px ui-monospace, monospace";
            this.drawOutlinedText(`${Math.ceil(player.hp)}/${Math.round(player.maxHp)}`, sx, sy - 11, "#f8fafc");
          }
        } else if (isLocal && player.aaWarningTicks > 0) {
          if (Math.floor(state.time * 8) % 2 === 0) {
            ctx.font = "900 11px ui-sans-serif, system-ui, sans-serif";
            this.drawOutlinedText("⚠ AA SAM — EVADE", sx, sy - 14, "#fb923c");
          }
        } else if (isLocal && player.aircraftType === "p47" && !player.landedAtBase && player.flightStage >= 3) {
          ctx.font = "900 11px ui-sans-serif, system-ui, sans-serif";
          this.drawOutlinedText("⚠ STALL", sx, sy - 14, "#fbbf24");
        }
        ctx.textAlign = "left";
      }
    }

    // 7a. B-52 Battlefield Target Zone Overlay
    if (b52Aiming?.active) {
      const half = STRATEGIC_CONFIG.b52_raid.stripWidth * 0.5;
      const leftSx = this.worldToScreen(b52Aiming.targetX - half, 0, w, groundScreenY).sx;
      const rightSx = this.worldToScreen(b52Aiming.targetX + half, 0, w, groundScreenY).sx;
      ctx.fillStyle = "rgba(245, 158, 11, 0.14)";
      ctx.fillRect(leftSx, 0, rightSx - leftSx, groundScreenY);
      ctx.save();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(leftSx, 0);
      ctx.lineTo(leftSx, groundScreenY);
      ctx.moveTo(rightSx, 0);
      ctx.lineTo(rightSx, groundScreenY);
      ctx.stroke();
      ctx.restore();
    }

    // 7b. Strategic B-52 Bombers & Steerable V2 Missiles
    for (const b52 of state.b52s || []) {
      if (!b52.alive) continue;
      this.drawSprite("b52_bomber", b52.x, b52.y, RENDER_HEIGHTS.b52, { team: b52.team, flipX: b52.dir < 0, anchorBottom: false }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(b52.x, b52.y + 58, w, groundScreenY);
      if (this.showHealthBars && sx > -140 && sx < w + 140) {
        const ratio = b52.maxHp > 0 ? Math.max(0, b52.hp / b52.maxHp) : 0;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(sx - 40, sy, 80, 5);
        ctx.fillStyle = getHpColor(b52.hp, b52.maxHp, b52.team === "allied" ? "#3b82f6" : "#ef4444");
        ctx.fillRect(sx - 40, sy, 80 * ratio, 5);
        if (this.showHealthText) {
          ctx.font = "700 9px ui-monospace, monospace";
          ctx.textAlign = "center";
          this.drawOutlinedText(`${Math.ceil(b52.hp)}/${Math.round(b52.maxHp)}`, sx, sy - 4, "#f8fafc");
          ctx.textAlign = "left";
        }
      }
    }

    for (const v2 of state.v2s || []) {
      if (!v2.alive) continue;
      this.smokeTrail.push({ x: v2.x, y: v2.y, r: 5.5, life: 0.45, maxLife: 0.45, color: "#cbd5e1" });
      const { sx, sy } = this.worldToScreen(v2.x, v2.y, w, groundScreenY);
      const img = v2.team === "enemy" ? this.getEnemyCanvas("v2_missile") : this.sprites.get("v2_missile");
      const ang = Math.atan2(-v2.vy, v2.vx);
      if (img) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(ang);
        ctx.drawImage(img, -24 * this.camZoom, -7 * this.camZoom, 48 * this.camZoom, 14 * this.camZoom);
        ctx.restore();
      }
    }

    // 8. Projectiles & Smoke Trail (P-47 missile cuts smoke after 4,000m fuel burnout!)
    for (const pr of state.projectiles) {
      const { sx, sy } = this.worldToScreen(pr.x, pr.y, w, groundScreenY);
      if (pr.kind === "bullet") {
        const tx = sx - pr.vx * 0.018 * this.camZoom;
        const ty = sy + pr.vy * 0.018 * this.camZoom;
        ctx.strokeStyle = "rgba(120, 53, 15, 0.72)";
        ctx.lineWidth = Math.max(2.6, 4.0 * this.camZoom);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        ctx.strokeStyle = "#fef08a";
        ctx.lineWidth = Math.max(1.4, 2.2 * this.camZoom);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      } else if (pr.kind === "flak_shell") {
        const tx = sx - pr.vx * 0.02 * this.camZoom;
        const ty = sy + pr.vy * 0.02 * this.camZoom;
        ctx.strokeStyle = "rgba(136, 19, 55, 0.75)";
        ctx.lineWidth = Math.max(3.2, 4.4 * this.camZoom);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        ctx.strokeStyle = "#fda4af";
        ctx.lineWidth = Math.max(1.8, 2.6 * this.camZoom);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      } else if (pr.kind === "heli_missile" || pr.kind === "p47_missile" || pr.kind === "sam_missile") {
        const isDropping = pr.kind === "heli_missile" && pr.missileStage === "drop";
        const isBoosting = pr.kind === "heli_missile" && pr.missileStage === "boost";
        if (!pr.fuelBurnedOut && !isDropping) {
          const samColor = pr.samProfile === "fast"
            ? "#bae6fd"
            : pr.samProfile === "slow"
              ? "#fde68a"
              : "#fecaca";
          this.smokeTrail.push({
            x: pr.x,
            y: pr.y,
            r: pr.kind === "sam_missile" ? 3.8 : isBoosting ? 5.5 : 4.5,
            life: isBoosting ? 0.42 : 0.35,
            maxLife: isBoosting ? 0.42 : 0.35,
            color: pr.kind === "sam_missile" ? samColor : isBoosting ? "#fed7aa" : "#e2e8f0"
          });
        }
        const img = this.sprites.get("v2_missile");
        const ang = isDropping
          ? Math.atan2(-Math.sin(pr.launchAngle || 0), (pr.launchDir || 1) * Math.cos(pr.launchAngle || 0))
          : Math.atan2(-pr.vy, pr.vx);
        if (img) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(ang);
          ctx.drawImage(img, -18 * this.camZoom, -5 * this.camZoom, 36 * this.camZoom, 10 * this.camZoom);
          ctx.restore();
        }
      } else if (pr.kind === "tank_shell") {
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5 * this.camZoom, 0, Math.PI * 2);
        ctx.fill();
      } else if (pr.kind === "howitzer_shell") {
        this.smokeTrail.push({ x: pr.x, y: pr.y, r: 3.5, life: 0.25, maxLife: 0.25, color: "#fed7aa" });
        ctx.fillStyle = "#f97316";
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5 * this.camZoom, 0, Math.PI * 2);
        ctx.fill();
      } else if (pr.kind === "p47_bomb" || pr.kind === "heli_bomb" || pr.kind === "b52_bomb") {
        const img = pr.team === "enemy" ? this.getEnemyCanvas("v2_missile") : this.sprites.get("v2_missile");
        const ang = Math.hypot(pr.vx, pr.vy) > 5 ? Math.atan2(-pr.vy, pr.vx) : Math.PI * 0.5;
        const bw = pr.kind === "b52_bomb" ? 20 : 26;
        const bh = pr.kind === "b52_bomb" ? 7 : 9;
        if (img) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(ang);
          ctx.drawImage(img, -(bw * 0.5) * this.camZoom, -(bh * 0.5) * this.camZoom, bw * this.camZoom, bh * this.camZoom);
          ctx.restore();
        }
      }
    }

    // 9. Flares
    for (const fl of state.flares) {
      const { sx, sy } = this.worldToScreen(fl.x, fl.y, w, groundScreenY);
      ctx.fillStyle = "#fef08a";
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5 * this.camZoom, 0, Math.PI * 2);
      ctx.fill();
      this.smokeTrail.push({ x: fl.x, y: fl.y, r: 3.5, life: 0.3, maxLife: 0.3, color: "rgba(255,255,255,0.6)" });
    }

    // 10. Smoke, Dust Motes & Explosions
    this.drawDustMotes(w, groundScreenY, simTime, z);

    for (let i = this.smokeTrail.length - 1; i >= 0; i--) {
      const pt = this.smokeTrail[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.smokeTrail.splice(i, 1);
        continue;
      }
      const { sx, sy } = this.worldToScreen(pt.x, pt.y, w, groundScreenY);
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife) * 0.55;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(sx, sy, pt.r * this.camZoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.life -= dt;
      if (ex.life <= 0) {
        this.explosions.splice(i, 1);
        continue;
      }
      const p = 1 - ex.life / ex.maxLife;
      const { sx, sy } = this.worldToScreen(ex.x, ex.y, w, groundScreenY);
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = p < 0.4 ? "#fde047" : "#f97316";
      ctx.beginPath();
      ctx.arc(sx, sy, ex.radius * (0.5 + p * 1.4) * this.camZoom, 0, Math.PI * 2);
      ctx.fill();
      if (ex.rearHit) {
        ctx.font = "800 12px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        this.drawOutlinedText("REAR HIT x1.75!", sx, sy - 22 - p * 18, "#fef08a");
        ctx.textAlign = "left";
      }
      ctx.globalAlpha = 1;
    }

    for (let i = this.floatingLabels.length - 1; i >= 0; i--) {
      const fl = this.floatingLabels[i];
      fl.life -= dt;
      if (fl.life <= 0) {
        this.floatingLabels.splice(i, 1);
        continue;
      }
      const p = 1 - fl.life / fl.maxLife;
      const { sx, sy } = this.worldToScreen(fl.x, fl.y + p * 45, w, groundScreenY);
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.font = "900 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      this.drawOutlinedText(fl.text, sx, sy, fl.color);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
  }

  drawOutlinedText(text, x, y, fillStyle, strokeStyle = "rgba(15, 23, 42, 0.88)", lineWidth = 2.6) {
    const ctx = this.ctx;
    if (typeof ctx.strokeText === "function") {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.strokeText(text, x, y);
      ctx.restore();
    }
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);
  }

  drawTiledHorizontal(img, parallax, topY, targetH, w, opts = {}) {
    if (!img) return;
    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (!natW || !natH || targetH <= 0) return;

    const scaleZ = opts.zoom ?? Math.max(0.76, this.camZoom);
    const drawW = targetH * (natW / natH);
    if (drawW <= 2) return;

    const originX = w * 0.5 - this.camX * parallax * scaleZ + (opts.driftX || 0);
    let startX = ((originX % drawW) + drawW) % drawW;
    if (startX > 0) startX -= drawW;

    const ctx = this.ctx;
    for (let x = startX; x < w + 1; x += drawW) {
      ctx.drawImage(img, x, topY, drawW + 0.75, targetH);
    }
  }

  drawDesertSky(w, h, seaHorizonY) {
    const ctx = this.ctx;
    const skyBottom = Math.max(24, seaHorizonY);
    const sky = ctx.createLinearGradient(0, 0, 0, skyBottom);
    sky.addColorStop(0, "#4b92c6");
    sky.addColorStop(0.42, "#78b4dc");
    sky.addColorStop(0.76, "#b4d7ea");
    sky.addColorStop(1, "#e6e6da");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, skyBottom + 2);

    ctx.fillStyle = "#d8c5a0";
    ctx.fillRect(0, skyBottom, w, h - skyBottom);

    if (typeof ctx.createRadialGradient === "function") {
      const sunX = w * 0.72;
      const sunY = skyBottom * 0.22;
      const glow = ctx.createRadialGradient(sunX, sunY, 12, sunX, sunY, Math.max(w, h) * 0.45);
      glow.addColorStop(0, "rgba(255, 249, 232, 0.24)");
      glow.addColorStop(0.45, "rgba(255, 244, 214, 0.08)");
      glow.addColorStop(1, "rgba(255, 244, 214, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, skyBottom);
    }

    // Ultra-soft high-altitude cirrus light streaks
    ctx.fillStyle = "rgba(255, 250, 238, 0.08)";
    for (let i = 0; i < 3; i++) {
      const sx = w * (0.14 + i * 0.31);
      const sy = skyBottom * (0.14 + (i % 2) * 0.09);
      ctx.beginPath();
      ctx.ellipse(sx, sy, w * 0.16, 12 + i * 3, -0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawDesertClouds(w, seaHorizonY, time, scaleZ) {
    const ctx = this.ctx;
    const skySpan = Math.max(80, seaHorizonY);
    const c1 = this.landscape.get("cloud_1");
    const c2 = this.landscape.get("cloud_2");
    const c3 = this.landscape.get("cloud_3");

    if (!c1 && !c2 && !c3) {
      ctx.fillStyle = "rgba(252, 246, 232, 0.45)";
      for (let c = 0; c < 6; c++) {
        const span = w + 360;
        const rawX = ((c * 320 - this.camX * 0.07 + time * 5) % span + span) % span - 180;
        const cy = skySpan * (0.2 + (c % 3) * 0.18);
        ctx.beginPath();
        ctx.ellipse(rawX, cy, 80, 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    const cycleW = 3400 * scaleZ;
    const clouds = [
      { img: c3, x: 240, yFrac: 0.17, h: 38, parallax: 0.04, drift: 3.5, alpha: 0.78, flipX: false },
      { img: c3, x: 1460, yFrac: 0.25, h: 32, parallax: 0.04, drift: 3.5, alpha: 0.74, flipX: true },
      { img: c3, x: 2560, yFrac: 0.19, h: 42, parallax: 0.04, drift: 3.5, alpha: 0.78, flipX: false },
      { img: c2, x: 520, yFrac: 0.38, h: 74, parallax: 0.09, drift: 7.0, alpha: 0.94, flipX: false },
      { img: c1, x: 1840, yFrac: 0.34, h: 92, parallax: 0.09, drift: 7.0, alpha: 0.94, flipX: false },
      { img: c2, x: 2980, yFrac: 0.45, h: 68, parallax: 0.09, drift: 7.0, alpha: 0.92, flipX: true }
    ];

    for (const cl of clouds) {
      const img = cl.img || c1 || c2 || c3;
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      if (!natW || !natH) continue;
      const drawH = cl.h * scaleZ;
      const drawW = drawH * (natW / natH);
      const basePos = cl.x * scaleZ - this.camX * cl.parallax * scaleZ + time * cl.drift * scaleZ;
      const wrappedX = ((basePos % cycleW) + cycleW) % cycleW;
      for (const offsetX of [wrappedX - cycleW, wrappedX]) {
        if (offsetX + drawW < -40 || offsetX > w + 40) continue;
        const cy = skySpan * cl.yFrac;
        ctx.save();
        ctx.globalAlpha = cl.alpha;
        if (cl.flipX) {
          ctx.translate(offsetX + drawW * 0.5, cy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
        } else {
          ctx.drawImage(img, offsetX, cy - drawH * 0.5, drawW, drawH);
        }
        ctx.restore();
      }
    }
  }

  drawDistantSea(w, groundScreenY, seaHorizonY, time, scaleZ) {
    const ctx = this.ctx;
    const seaTile = this.landscape.get("sea_horizon_tile");
    const seaH = Math.max(155, 210 * scaleZ);
    const seaTopY = seaHorizonY - seaH * 0.30;

    if (seaTile) {
      this.drawTiledHorizontal(seaTile, 0.065, seaTopY, seaH, w, { zoom: scaleZ });
    } else {
      const seaDepth = Math.max(40, groundScreenY - seaHorizonY);
      const seaGrad = ctx.createLinearGradient(0, seaHorizonY, 0, seaHorizonY + seaDepth);
      seaGrad.addColorStop(0, "#83afc0");
      seaGrad.addColorStop(0.35, "#5d8ea3");
      seaGrad.addColorStop(1, "#447389");
      ctx.fillStyle = seaGrad;
      ctx.fillRect(0, seaHorizonY, w, seaDepth);
    }

    // Subtle live sunlit shimmer glints across the sea glare band
    const natW = seaTile ? (seaTile.naturalWidth || seaTile.width) : 2048;
    const natH = seaTile ? (seaTile.naturalHeight || seaTile.height) : 420;
    const tileW = seaH * (natW / Math.max(1, natH));
    const originX = w * 0.5 - this.camX * 0.065 * scaleZ;
    let startX = ((originX % tileW) + tileW) % tileW;
    if (startX > 0) startX -= tileW;

    ctx.save();
    for (let tx = startX; tx < w + 60; tx += tileW) {
      const glareCenter = tx + tileW * 0.355;
      for (let i = 0; i < 8; i++) {
        const pulse = 0.45 + 0.55 * Math.sin(time * 2.4 + i * 1.35);
        const gx = glareCenter + Math.sin(i * 2.1 + time * 0.45) * 44 * scaleZ + (i - 3.5) * 14 * scaleZ;
        if (gx < -40 || gx > w + 40) continue;
        const gy = seaHorizonY + (5 + i * 3.1) * scaleZ;
        const gw = (12 + (i % 3) * 7) * scaleZ;
        ctx.globalAlpha = 0.16 + 0.24 * pulse;
        ctx.fillStyle = "#fffbeb";
        ctx.fillRect(gx - gw * 0.5, gy, gw, Math.max(1, 1.4 * scaleZ));
      }
    }
    ctx.restore();
  }

  drawDesertDunes(w, groundScreenY, scaleZ, z) {
    const ctx = this.ctx;
    const farDunes = this.landscape.get("far_dunes_tile");
    const midDesert = this.landscape.get("mid_desert_tile");

    if (farDunes) {
      const farH = 162 * scaleZ;
      this.drawTiledHorizontal(farDunes, 0.18, groundScreenY - farH + 6 * z, farH, w, { zoom: scaleZ });
    } else {
      this.drawCurvedDuneFallback(w, groundScreenY, 0.18, "#d7be8c", 96 * scaleZ, 260 * scaleZ);
    }

    // Soft coastal atmospheric haze wash separating far dunes from midground
    ctx.fillStyle = "rgba(235, 227, 206, 0.13)";
    ctx.fillRect(0, groundScreenY - 140 * scaleZ, w, 140 * scaleZ);

    if (midDesert) {
      const midH = 126 * scaleZ;
      this.drawTiledHorizontal(midDesert, 0.36, groundScreenY - midH + 8 * z, midH, w, { zoom: scaleZ });
    } else {
      this.drawCurvedDuneFallback(w, groundScreenY, 0.36, "#cfa668", 64 * scaleZ, 190 * scaleZ);
    }
  }

  drawCurvedDuneFallback(w, groundScreenY, parallax, color, baseH, stepW) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, groundScreenY);
    const offset = Math.floor((this.camX * parallax) / stepW) * stepW;
    for (let mx = offset - stepW; mx <= offset + w / Math.max(0.4, this.camZoom) + stepW * 2; mx += stepW * 0.25) {
      const sx = (mx - this.camX * parallax) * this.camZoom + w * 0.5;
      const wave = 0.5 + 0.3 * Math.sin(mx * 0.008) + 0.2 * Math.cos(mx * 0.017);
      ctx.lineTo(sx, groundScreenY - baseH * wave);
    }
    ctx.lineTo(w, groundScreenY);
    ctx.closePath();
    ctx.fill();
  }

  drawDesertGround(w, h, groundScreenY, z) {
    const ctx = this.ctx;
    const groundTile = this.landscape.get("ground_strip_tile");
    const tileH = Math.max(175, 200 * z);
    const topY = groundScreenY - tileH * 0.28;

    if (groundTile) {
      this.drawTiledHorizontal(groundTile, 1.0, topY, tileH, w, { zoom: z });
      const coveredBottom = topY + tileH;
      if (coveredBottom < h) {
        ctx.fillStyle = "#5b3d24";
        ctx.fillRect(0, coveredBottom - 2, w, h - coveredBottom + 4);
      }
      return;
    }

    ctx.fillStyle = "#dcb679";
    ctx.fillRect(0, groundScreenY - 40 * z, w, 58 * z);
    ctx.fillStyle = "#6c4829";
    ctx.fillRect(0, groundScreenY + 18 * z, w, h - groundScreenY);
  }

  drawDesertProps(state, w, groundScreenY) {
    const minB = state.worldBounds ? state.worldBounds.minX + 60 : -Infinity;
    const maxB = state.worldBounds ? state.worldBounds.maxX - 60 : Infinity;

    for (const prop of DESERT_PROPS) {
      if (prop.x < minB || prop.x > maxB) continue;
      const nearBunker = (state.bunkers || []).some((b) => Math.abs(b.x - prop.x) < 110);
      if (nearBunker) continue;
      const nearHq = ["allied", "enemy"].some((side) => {
        const hq = state.hqs?.[side];
        return hq && !hq.hidden && Math.abs((hq.x ?? BASES[side].hqX) - prop.x) < 120;
      });
      if (nearHq) continue;

      this.drawGroundShadow(prop.x, prop.key === "prop_tank_traps" ? 135 : 70, w, groundScreenY);
      this.drawLandscapeProp(prop.key, prop.x, prop.y, prop.height, { flipX: prop.flipX, alpha: 0.94 }, w, groundScreenY);
    }
  }

  drawAirfieldWindsock(worldX, flipX, time, w, groundScreenY) {
    const { sx, sy } = this.worldToScreen(worldX, 0, w, groundScreenY);
    if (sx < -80 || sx > w + 80) return;
    const ctx = this.ctx;
    const z = this.camZoom;
    const dir = flipX ? -1 : 1;

    ctx.save();
    // Contact shadow
    ctx.fillStyle = "rgba(58, 38, 18, 0.28)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2 * z, 24 * z, 4 * z, 0, 0, Math.PI * 2);
    ctx.fill();

    // Two weathered fuel drums beside base of pole
    for (const [dx, col] of [[-12, "#7c4a32"], [-1, "#5c6452"]]) {
      const bx = sx + dx * dir * z - 5 * z;
      const by = sy - 15 * z;
      ctx.fillStyle = col;
      ctx.fillRect(bx, by, 10 * z, 15 * z);
      ctx.strokeStyle = "#261c14";
      ctx.lineWidth = Math.max(1, 1.2 * z);
      ctx.strokeRect(bx, by, 10 * z, 15 * z);
    }

    // Mast pole
    const poleH = 52 * z;
    ctx.fillStyle = "#57534e";
    ctx.fillRect(sx - 1.5 * z, sy - poleH, 3 * z, poleH);
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = Math.max(1, 1.1 * z);
    ctx.strokeRect(sx - 1.5 * z, sy - poleH, 3 * z, poleH);

    // Fluttering sun-bleached orange & white windsock cone
    const flutter = Math.sin(time * 4.5 + worldX * 0.01) * 3.5 * z;
    const topY = sy - poleH + 3 * z;
    const len = 24 * z * dir;
    ctx.fillStyle = "#d97736";
    ctx.beginPath();
    ctx.moveTo(sx, topY);
    ctx.lineTo(sx + len, topY + 3 * z + flutter);
    ctx.lineTo(sx + len, topY + 8 * z + flutter);
    ctx.lineTo(sx, topY + 10 * z);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#292524";
    ctx.stroke();

    // White stripe band
    ctx.fillStyle = "#efe6d2";
    ctx.beginPath();
    ctx.moveTo(sx + len * 0.34, topY + 1 * z + flutter * 0.34);
    ctx.lineTo(sx + len * 0.66, topY + 2 * z + flutter * 0.66);
    ctx.lineTo(sx + len * 0.66, topY + 8.6 * z + flutter * 0.66);
    ctx.lineTo(sx + len * 0.34, topY + 9.3 * z + flutter * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawLandingPad(padLeft, padRight, groundScreenY, z) {
    const padW = Math.max(0, padRight - padLeft);
    if (padW <= 2) return;
    const ctx = this.ctx;

    // Soft sand shoulder shadow
    ctx.fillStyle = "rgba(68, 44, 22, 0.34)";
    ctx.fillRect(padLeft - 6, groundScreenY - 3 * z, padW + 12, 11 * z);

    // Weathered concrete/steel front apron lip
    ctx.fillStyle = "#4b453d";
    ctx.fillRect(padLeft, groundScreenY - 3 * z, padW, 7 * z);

    // Main sun-bleached Marston-mat desert runway slab
    ctx.fillStyle = "#726b60";
    ctx.fillRect(padLeft, groundScreenY - 6 * z, padW, 6 * z);

    // Pierced-steel planking rib ticks
    const tickStep = Math.max(10, 18 * z);
    ctx.fillStyle = "rgba(44, 38, 32, 0.38)";
    for (let px = padLeft + tickStep; px < padRight - 4; px += tickStep) {
      ctx.fillRect(px, groundScreenY - 6 * z, 1, 6 * z);
    }

    // Sun-faded amber centerline runway dashes
    ctx.fillStyle = "#e0ab3e";
    const dashW = Math.max(6, 16 * z);
    const dashStep = Math.max(14, 28 * z);
    for (let dx = padLeft + 12; dx + dashW < padRight - 10; dx += dashStep) {
      ctx.fillRect(dx, groundScreenY - 3.5 * z, dashW, 2);
    }
  }

  drawGroundShadow(worldX, widthWorld, w, groundScreenY) {
    const { sx, sy } = this.worldToScreen(worldX, 0, w, groundScreenY);
    const rx = widthWorld * 0.5 * this.camZoom;
    if (sx + rx < -40 || sx - rx > w + 40) return;
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(58, 38, 18, 0.28)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + 1 * this.camZoom, rx, Math.max(2, 4.5 * this.camZoom), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawDustMotes(w, groundScreenY, time, z) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "#f8e8c6";
    for (let i = 0; i < 16; i++) {
      const span = w + 120;
      const mx = (((i * 197 - this.camX * 0.85 * z + time * (16 + (i % 4) * 5)) % span) + span) % span - 60;
      const my = groundScreenY - (4 + ((i * 29) % 24) + Math.sin(time * 1.4 + i) * 3) * z;
      ctx.globalAlpha = 0.12 + (i % 3) * 0.05;
      ctx.beginPath();
      ctx.arc(mx, my, (1.2 + (i % 2) * 0.7) * Math.max(0.75, z), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
