import {
  BASES,
  MAX_X,
  MIN_X,
  MISSILE_FUEL_DISTANCE,
  RENDER_HEIGHTS,
  WORLD_WIDTH
} from "../../shared/constants.mjs";

const SPRITE_NAMES = [
  "aa_flak_truck", "ambulance", "armored_apc", "b52_bomber", "base_hq", "bunker",
  "civilian", "helicopter", "infantry", "main_battle_tank", "p47_thunderbolt",
  "paratrooper", "self_propelled_howitzer", "supply_truck", "v2_missile", "v2_silo",
  "heli_fly_1", "heli_fly_2", "heli_fly_3", "heli_turn_1", "heli_turn_2", "heli_turn_3",
  "p47_fly_1", "p47_fly_2", "p47_fly_3", "p47_turn_1", "p47_turn_2", "p47_turn_3",
  "para_sway_1", "para_sway_2", "para_land_collapse", "inf_turn",
  "inf_run_1", "inf_run_2", "inf_run_3", "inf_run_4",
  "civ_wave_1", "civ_wave_2", "civ_turn", "civ_run_1", "civ_run_2", "civ_run_3"
];

export class SpriteBattlefieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sprites = new Map();
    this.enemyTinted = new Map();
    this.explosions = [];
    this.smokeTrail = [];
    this.camX = BASES.allied.padCenterX + 180;
    this.camY = 180;
    this.camZoom = 1.0;
    this.ready = false;
  }

  async loadAll() {
    await Promise.all(
      SPRITE_NAMES.map(
        (name) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              this.sprites.set(name, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = `/assets/sprites/${name}.png`;
          })
      )
    );
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
      }
    }
  }

  updateCamera(focusPlayer, dt) {
    if (!focusPlayer) return;
    const lookAheadX = focusPlayer.vx * 0.42 + focusPlayer.dir * 130;
    const targetX = Math.max(MIN_X + 380, Math.min(MAX_X - 380, focusPlayer.x + lookAheadX));
    const targetY = Math.max(150, Math.min(760, focusPlayer.y + 90));
    const speedNorm = Math.min(1, Math.abs(focusPlayer.vx) / 520);
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

  drawSprite(name, worldX, worldY, targetHeightWorld, opts = {}, w, groundScreenY) {
    const src = opts.team === "enemy" ? this.getEnemyCanvas(name) : this.sprites.get(name);
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
    if (opts.crashing) ctx.filter = "brightness(0.55) saturate(0.65)";
    ctx.drawImage(src, -width * 0.5, -h * 0.5, width, h);
    ctx.restore();
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

  render(state, localPlayerId, dt) {
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
    this.updateCamera(camTarget, dt);

    // Keep ground visible cleanly near lower fifth while climbing
    const groundScreenY = Math.min(h - 54, Math.max(h * 0.72, h * 0.82 + (this.camY - 150) * 0.35 * this.camZoom));
    this.lastViewW = w;
    this.lastViewH = h;
    this.lastGroundScreenY = groundScreenY;

    // 1. 2.5D Sky Backdrop
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0b1930");
    sky.addColorStop(0.6, "#1e3a5f");
    sky.addColorStop(1, "#38608a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Parallax Distant Clouds
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let c = -3; c <= 10; c++) {
      const cx = ((c * 340 - this.camX * 0.14) % (w + 400));
      const cy = 62 + ((c * 53) % 90);
      ctx.beginPath();
      ctx.ellipse(cx < -150 ? cx + w + 400 : cx, cy, 85, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Parallax Mountain Ridges (2 layers)
    this.drawMountainLayer(w, groundScreenY, 0.22, "#1a2e45", 130, 170);
    this.drawMountainLayer(w, groundScreenY, 0.45, "#23394a", 75, 110);

    // 2. Ground Strip & Terrain Depth
    ctx.fillStyle = "#3f5e36";
    ctx.fillRect(0, groundScreenY - 4 * this.camZoom, w, 10 * this.camZoom);
    ctx.fillStyle = "#293524";
    ctx.fillRect(0, groundScreenY + 6 * this.camZoom, w, h - groundScreenY);

    // World Distance Markers every 1,000m so P-47 4,000m (1/3 map) fuel range is legible
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (let wx = MIN_X; wx <= MAX_X; wx += 1000) {
      const { sx } = this.worldToScreen(wx, 0, w, groundScreenY);
      if (sx < -60 || sx > w + 60) continue;
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(sx - 1, groundScreenY + 2, 2, 8);
      ctx.fillStyle = "rgba(226,232,240,0.55)";
      ctx.fillText(`${wx}m`, sx, groundScreenY + 22);
    }
    ctx.textAlign = "left";

    // 3. Bases & Landing Pads
    for (const side of ["allied", "enemy"]) {
      const base = BASES[side];
      const padLeft = this.worldToScreen(base.padMinX, 0, w, groundScreenY).sx;
      const padRight = this.worldToScreen(base.padMaxX, 0, w, groundScreenY).sx;
      ctx.fillStyle = "#334155";
      ctx.fillRect(padLeft, groundScreenY - 5 * this.camZoom, padRight - padLeft, 9 * this.camZoom);
      ctx.fillStyle = "#eab308";
      ctx.fillRect(padLeft + 10, groundScreenY - 2 * this.camZoom, Math.max(0, padRight - padLeft - 20), 2);

      this.drawSprite("v2_silo", base.siloX, 0, RENDER_HEIGHTS.v2Silo, { team: side, flipX: side === "enemy" }, w, groundScreenY);
      this.drawSprite("base_hq", base.hqX, 0, RENDER_HEIGHTS.baseHq, { team: side, flipX: side === "enemy" }, w, groundScreenY);

      const hq = state.hqs[side];
      if (hq && hq.hp < hq.maxHp) {
        const { sx, sy } = this.worldToScreen(base.hqX, RENDER_HEIGHTS.baseHq + 18, w, groundScreenY);
        if (sx > -120 && sx < w + 120) {
          ctx.fillStyle = "rgba(0,0,0,0.65)";
          ctx.fillRect(sx - 44, sy, 88, 7);
          ctx.fillStyle = side === "allied" ? "#3b82f6" : "#ef4444";
          ctx.fillRect(sx - 44, sy, 88 * (hq.hp / hq.maxHp), 7);
        }
      }
    }

    // 4. Bunkers (Checkpoints)
    for (const b of state.bunkers) {
      this.drawSprite("bunker", b.x, 0, RENDER_HEIGHTS.bunker, { team: b.owner === "enemy" ? "enemy" : "allied" }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(b.x, RENDER_HEIGHTS.bunker + 14, w, groundScreenY);
      if (sx > -100 && sx < w + 100) {
        const label = b.hp <= 0 ? "NEUTRALIZED" : b.owner.toUpperCase();
        ctx.fillStyle = b.hp <= 0 ? "#f59e0b" : b.owner === "allied" ? "#3b82f6" : b.owner === "enemy" ? "#ef4444" : "#94a3b8";
        ctx.font = "700 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, sx, sy);
        ctx.textAlign = "left";
        if (b.hp < b.maxHp && b.hp > 0) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx - 28, sy + 5, 56, 4);
          ctx.fillStyle = b.owner === "allied" ? "#3b82f6" : b.owner === "enemy" ? "#ef4444" : "#94a3b8";
          ctx.fillRect(sx - 28, sy + 5, 56 * (b.hp / b.maxHp), 4);
        }
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
      armored_apc: RENDER_HEIGHTS.apc,
      main_battle_tank: RENDER_HEIGHTS.mbt,
      self_propelled_howitzer: RENDER_HEIGHTS.howitzer,
      ambulance: RENDER_HEIGHTS.ambulance,
      supply_truck: RENDER_HEIGHTS.supplyTruck
    };

    for (const t of state.targets) {
      if (t.hp <= 0) continue;
      const th = unitHeightMap[t.kind] || 48;
      this.drawSprite(t.kind, t.x, 0, th, { team: t.team, flipX: t.dir < 0 }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(t.x, th + 12, w, groundScreenY);
      if (sx > -80 && sx < w + 80) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(sx - 24, sy, 48, 5);
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(sx - 24, sy, 48 * (t.hp / t.maxHp), 5);
      }
    }

    for (const u of state.units || []) {
      if (u.hp <= 0) continue;
      const uh = unitHeightMap[u.kind] || 48;
      if (u.kind === "supply_truck") {
        const { sx } = this.worldToScreen(u.x, 0, w, groundScreenY);
        const auraR = 240 * this.camZoom;
        if (sx > -auraR && sx < w + auraR) {
          ctx.fillStyle = "rgba(34, 197, 94, 0.12)";
          ctx.fillRect(sx - auraR, groundScreenY - 6 * this.camZoom, auraR * 2, 10 * this.camZoom);
        }
      }
      const spriteKey = u.kind === "infantry"
        ? `inf_run_${(Math.floor(u.walkPhase || 0) % 4) + 1}`
        : u.kind;
      this.drawSprite(spriteKey, u.x, u.y || 0, uh, { team: u.team, flipX: u.dir < 0 }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(u.x, uh + 10, w, groundScreenY);
      if (sx > -80 && sx < w + 80) {
        const barW = u.kind === "infantry" ? 24 : 46;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(sx - barW * 0.5, sy, barW, 4);
        ctx.fillStyle = u.team === "allied" ? "#3b82f6" : "#ef4444";
        ctx.fillRect(sx - barW * 0.5, sy, barW * (u.hp / u.maxHp), 4);
        if (u.kind === "ambulance" && u.passengers?.length > 0) {
          ctx.fillStyle = "#fde047";
          ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`+${u.passengers.length} CIV`, sx, sy - 4);
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
    }

    // 7b. Strategic B-52 Bombers & Steerable V2 Missiles
    for (const b52 of state.b52s || []) {
      if (!b52.alive) continue;
      this.drawSprite("b52_bomber", b52.x, b52.y, RENDER_HEIGHTS.b52, { team: b52.team, flipX: b52.dir < 0, anchorBottom: false }, w, groundScreenY);
      const { sx, sy } = this.worldToScreen(b52.x, b52.y + 58, w, groundScreenY);
      if (sx > -140 && sx < w + 140) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(sx - 40, sy, 80, 5);
        ctx.fillStyle = b52.team === "allied" ? "#3b82f6" : "#ef4444";
        ctx.fillRect(sx - 40, sy, 80 * (b52.hp / b52.maxHp), 5);
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
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = Math.max(1.5, 2.5 * this.camZoom);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - pr.vx * 0.018 * this.camZoom, sy + pr.vy * 0.018 * this.camZoom);
        ctx.stroke();
      } else if (pr.kind === "flak_shell") {
        ctx.strokeStyle = "#fb7185";
        ctx.lineWidth = Math.max(2, 3 * this.camZoom);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - pr.vx * 0.02 * this.camZoom, sy + pr.vy * 0.02 * this.camZoom);
        ctx.stroke();
      } else if (pr.kind === "p47_missile" || pr.kind === "sam_missile") {
        if (!pr.fuelBurnedOut) {
          this.smokeTrail.push({
            x: pr.x,
            y: pr.y,
            r: pr.kind === "sam_missile" ? 3.8 : 4.5,
            life: 0.35,
            maxLife: 0.35,
            color: pr.kind === "sam_missile" ? "#fecaca" : "#e2e8f0"
          });
        }
        const img = this.sprites.get("v2_missile");
        const ang = Math.atan2(-pr.vy, pr.vx);
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
      } else if (pr.kind === "b52_bomb") {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(-pr.vy, pr.vx));
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(-5 * this.camZoom, -2.5 * this.camZoom, 10 * this.camZoom, 5 * this.camZoom);
        ctx.restore();
      } else if (pr.kind === "heli_bomb") {
        ctx.fillStyle = "#f8fafc";
        ctx.beginPath();
        ctx.arc(sx, sy, 4 * this.camZoom, 0, Math.PI * 2);
        ctx.fill();
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

    // 10. Smoke & Explosions
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
        ctx.fillStyle = "#fef08a";
        ctx.font = "800 12px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("REAR HIT x1.75!", sx, sy - 22 - p * 18);
        ctx.textAlign = "left";
      }
      ctx.globalAlpha = 1;
    }
  }

  drawMountainLayer(w, groundScreenY, parallax, color, baseH, stepW) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, groundScreenY);
    const offset = Math.floor((this.camX * parallax) / stepW) * stepW;
    for (let mx = offset - stepW * 2; mx <= offset + w / Math.max(0.4, this.camZoom) + stepW * 3; mx += stepW) {
      const sx = (mx - this.camX * parallax) * this.camZoom + w * 0.5;
      const seed = Math.abs(Math.sin(mx * 0.013)) * 0.7 + 0.3;
      ctx.lineTo(sx, groundScreenY - baseH * seed * this.camZoom);
    }
    ctx.lineTo(w, groundScreenY);
    ctx.closePath();
    ctx.fill();
  }
}
