import {
  BASES,
  BURST_MAX_TICKS,
  BURST_RECHARGE_DELAY,
  MAX_X,
  MIN_X,
  REQUISITION_MENU,
  WORLD_WIDTH
} from "../../shared/constants.mjs";

export class TacticalHud {
  constructor() {
    this.elAlliedHq = document.getElementById("allied-hq-bar");
    this.elEnemyHq = document.getElementById("enemy-hq-bar");
    this.elFunds = document.getElementById("funds-label");
    this.elBunkerPips = document.getElementById("bunker-pips");
    this.elPos = document.getElementById("pos-readout");
    this.elNet = document.getElementById("net-status");
    this.elBaseBanner = document.getElementById("base-banner");
    this.elQDrawer = document.getElementById("q-drawer");
    this.elQGrid = document.getElementById("q-grid");

    this.elCraftName = document.getElementById("craft-name");
    this.elHpText = document.getElementById("hp-text");
    this.elHpFill = document.getElementById("hp-fill");
    this.elBurstState = document.getElementById("burst-state");
    this.elBurstFill = document.getElementById("burst-fill");
    this.elSecPips = document.getElementById("sec-pips");
    this.elFlarePips = document.getElementById("flare-pips");
    this.elCabin = document.getElementById("cabin-readout");
    this.elTeamBadge = document.getElementById("team-badge");
    this.radar = document.getElementById("radar");
    this.rctx = this.radar.getContext("2d");

    this.buildQMenu();
  }

  buildQMenu() {
    this.elQGrid.innerHTML = "";
    this.qCards = {};
    for (const item of REQUISITION_MENU) {
      const card = document.createElement("div");
      card.className = `q-item ${item.phase > 1 ? "phase2-locked" : ""}`;
      card.innerHTML = `
        <div class="q-key">${item.key}</div>
        <div style="min-width:0;">
          <div style="font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
          <div style="color:#94a3b8;font-size:10px;">${item.cost > 0 ? `$${item.cost} (Phase 2)` : "Free @ Base Pad"}</div>
        </div>
      `;
      this.elQGrid.appendChild(card);
      this.qCards[item.key] = card;
    }
  }

  setMenuOpen(open) {
    this.elQDrawer.classList.toggle("open", open);
  }

  setNetStatus(text, color) {
    this.elNet.textContent = text;
    this.elNet.style.color = color;
  }

  update(state, localPlayerId, camX) {
    const p = state.players[localPlayerId];
    this.elAlliedHq.style.width = `${(state.hqs.allied.hp / state.hqs.allied.maxHp) * 100}%`;
    this.elEnemyHq.style.width = `${(state.hqs.enemy.hp / state.hqs.enemy.maxHp) * 100}%`;

    const team = p?.team || "allied";
    this.elFunds.textContent = `$${Math.floor(state.teamFunds[team])}`;
    this.elTeamBadge.textContent = team.toUpperCase();
    this.elTeamBadge.style.color = team === "allied" ? "#60a5fa" : "#f87171";

    // Bunker ownership pips
    if (this.elBunkerPips.childElementCount !== state.bunkers.length) {
      this.elBunkerPips.innerHTML = state.bunkers
        .map((_, idx) => `<div class="bunker-pip" data-b="${idx}">${idx + 1}</div>`)
        .join("");
    }
    state.bunkers.forEach((b, idx) => {
      const el = this.elBunkerPips.children[idx];
      el.className = `bunker-pip ${b.owner === "allied" ? "allied" : b.owner === "enemy" ? "enemy" : ""}`;
    });

    if (p) {
      this.elPos.textContent = p.alive ? `X:${Math.round(p.x)}m Y:${Math.round(p.y)}m` : `RESPAWN ${(p.respawnTicks / 60).toFixed(1)}s`;
      this.elCraftName.textContent = p.aircraftType === "heli" ? "HELICOPTER" : "P-47 THUNDERBOLT";
      this.elHpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp} HP`;
      this.elHpFill.style.width = `${(p.hp / p.maxHp) * 100}%`;
      this.elHpFill.style.background = p.hp > p.maxHp * 0.35 ? "#22c55e" : "#ef4444";

      // Burst reservoir status
      const pct = (p.burstReservoir / BURST_MAX_TICKS) * 100;
      this.elBurstFill.style.width = `${pct}%`;
      if (p.burstReservoir > 0) {
        this.elBurstState.textContent = "BURST READY (12/s)";
        this.elBurstState.style.color = "#22c55e";
        this.elBurstFill.style.background = "#22c55e";
      } else if (p.primaryIdleTicks >= BURST_RECHARGE_DELAY) {
        this.elBurstState.textContent = "RECHARGING...";
        this.elBurstState.style.color = "#38bdf8";
        this.elBurstFill.style.background = "#38bdf8";
      } else {
        this.elBurstState.textContent = "SUSTAINED SLOW (1/0.5s)";
        this.elBurstState.style.color = "#f59e0b";
        this.elBurstFill.style.background = "#f59e0b";
      }

      // Ordnance & Flare pips
      this.renderPips(this.elSecPips, p.secondaryAmmo, p.maxSecondary, "pip");
      this.renderPips(this.elFlarePips, p.flaresAmmo, p.maxFlares, "pip flare");

      // Cabin display
      this.elCabin.textContent = p.aircraftType === "heli"
        ? `CABIN: ${p.passengers.length} / ${p.cabinCapacity} PARATROOPERS`
        : "P-47 STRAIGHT ROCKETS (4,000m FUEL)";

      // Base pad passive indicator (no modal!)
      this.elBaseBanner.style.display = p.alive && p.landedAtBase ? "block" : "none";
      if (this.qCards["0"]) {
        this.qCards["0"].classList.toggle("active-ready", Boolean(p.alive && p.landedAtBase));
      }
    }

    this.drawRadar(state, localPlayerId, camX);
  }

  renderPips(container, current, max, cls) {
    let html = "";
    for (let i = 0; i < max; i++) {
      html += `<div class="${cls} ${i < current ? "on" : ""}"></div>`;
    }
    container.innerHTML = html;
  }

  drawRadar(state, localPlayerId, camX) {
    const rect = this.radar.getBoundingClientRect();
    const w = Math.max(200, Math.floor(rect.width));
    const h = 104;
    if (this.radar.width !== w || this.radar.height !== h) {
      this.radar.width = w;
      this.radar.height = h;
    }
    const ctx = this.rctx;
    ctx.clearRect(0, 0, w, h);

    const toRx = (wx) => ((wx - MIN_X) / WORLD_WIDTH) * w;
    const toRy = (wy) => h - 14 - (wy / 1200) * (h - 24);

    // Ground & Bases
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, h - 14, w, 14);
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(toRx(BASES.allied.hqX) - 5, h - 24, 10, 10);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(toRx(BASES.enemy.hqX) - 5, h - 24, 10, 10);

    // Bunkers
    for (const b of state.bunkers) {
      ctx.fillStyle = b.owner === "allied" ? "#3b82f6" : b.owner === "enemy" ? "#ef4444" : "#94a3b8";
      ctx.fillRect(toRx(b.x) - 3, h - 19, 6, 6);
    }

    // Targets
    ctx.fillStyle = "#f97316";
    for (const t of state.targets) {
      if (t.hp <= 0) continue;
      ctx.fillRect(toRx(t.x) - 2, h - 17, 4, 3);
    }

    // Paratroopers
    ctx.fillStyle = "#4ade80";
    for (const p of state.paratroopers) {
      ctx.fillRect(toRx(p.x) - 1.5, toRy(p.y) - 1.5, 3, 3);
    }

    // Projectiles (highlights P-47 1/3 map missiles)
    for (const pr of state.projectiles) {
      if (pr.kind === "p47_missile") {
        ctx.fillStyle = pr.fuelBurnedOut ? "#94a3b8" : "#fde047";
        ctx.fillRect(toRx(pr.x) - 2, toRy(pr.y) - 1.5, 4, 3);
      }
    }

    // Players
    for (const pl of Object.values(state.players)) {
      if (!pl.alive) continue;
      const rx = toRx(pl.x);
      const ry = toRy(pl.y);
      ctx.fillStyle = pl.id === localPlayerId ? "#fde047" : pl.team === "allied" ? "#60a5fa" : "#f87171";
      ctx.beginPath();
      ctx.arc(rx, ry, pl.id === localPlayerId ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera Viewport Indicator
    const camRx = toRx(camX);
    const viewW = (1400 / WORLD_WIDTH) * w;
    ctx.strokeStyle = "rgba(248, 250, 252, 0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(camRx - viewW * 0.5, 4, viewW, h - 8);
  }
}
