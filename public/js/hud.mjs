import {
  BASES,
  BURST_MAX_TICKS,
  BURST_RECHARGE_DELAY,
  MAX_X,
  MIN_X,
  REQUISITION_MENU,
  STRATEGIC_CONFIG,
  WORLD_WIDTH
} from "../../shared/constants.mjs";

export class TacticalHud {
  constructor() {
    this.elAlliedHq = document.getElementById("allied-hq-bar");
    this.elEnemyHq = document.getElementById("enemy-hq-bar");
    this.elFunds = document.getElementById("funds-label");
    this.elBunkerPips = document.getElementById("bunker-pips");
    this.elModeBadge = document.getElementById("mode-badge");
    this.elAutoProdBadge = document.getElementById("autoprod-badge");
    this.elAudioBadge = document.getElementById("audio-badge");
    this.elPos = document.getElementById("pos-readout");
    this.elNet = document.getElementById("net-status");
    this.elBaseBanner = document.getElementById("base-banner");
    this.elTacticalAlert = document.getElementById("tactical-alert");
    this.elVictoryBanner = document.getElementById("victory-banner");
    this.elVictoryTitle = document.getElementById("victory-title");
    this.elVictoryStats = document.getElementById("victory-stats");
    this.elVictorySub = document.getElementById("victory-sub");
    this.elVictoryRematchBtn = document.getElementById("victory-rematch-btn");
    this.elVictoryLobbyBtn = document.getElementById("victory-lobby-btn");
    this.elQDrawer = document.getElementById("q-drawer");
    this.elQAutoProdStatus = document.getElementById("q-autoprod-status");
    this.elQGrid = document.getElementById("q-grid");

    // Pre-Match Lobby Elements
    this.elLobbyOverlay = document.getElementById("lobby-overlay");
    this.elLobbyRooms = document.getElementById("lobby-rooms");
    this.elLobbyRoomInput = document.getElementById("lobby-room-input");
    this.elLobbyRoomJoin = document.getElementById("lobby-room-join");
    this.elLobbyModeBtns = Array.from(document.querySelectorAll(".mode-btn"));
    this.elLobbyBotsBtn = document.getElementById("lobby-bots-btn");
    this.elLobbyAutoProdBtn = document.getElementById("lobby-autoprod-btn");
    this.elLobbyCallsign = document.getElementById("lobby-callsign");
    this.elLobbyPanelAllied = document.getElementById("lobby-panel-allied");
    this.elLobbyPanelEnemy = document.getElementById("lobby-panel-enemy");
    this.elLobbyJoinAllied = document.getElementById("lobby-join-allied");
    this.elLobbyJoinEnemy = document.getElementById("lobby-join-enemy");
    this.elLobbyAlliedRoster = document.getElementById("lobby-allied-roster");
    this.elLobbyEnemyRoster = document.getElementById("lobby-enemy-roster");
    this.elLobbyCraftHeli = document.getElementById("lobby-craft-heli");
    this.elLobbyCraftP47 = document.getElementById("lobby-craft-p47");
    this.elLobbyReadyBtn = document.getElementById("lobby-ready-btn");
    this.elLobbyStartBtn = document.getElementById("lobby-start-btn");

    this.lastRoomsSig = "";
    this.lastRosterSig = "";
    this.lobbyHandlers = null;

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

    this.toastMsg = "";
    this.toastVariant = "info";
    this.toastUntil = 0;

    this.buildQMenu();
  }

  showToast(msg, variant = "info", durationMs = 2600) {
    this.toastMsg = msg;
    this.toastVariant = variant;
    this.toastUntil = performance.now() + durationMs;
  }

  ingestEvents(events) {
    for (const ev of events) {
      if (ev.type === "civilians_rescued") {
        this.showToast(`CIVILIAN RESCUED +$${ev.payout} (${ev.count})`, "success", 3200);
      } else if (ev.type === "bunker_captured") {
        this.showToast(`${ev.team.toUpperCase()} CAPTURED BUNKER`, ev.team === "allied" ? "success" : "info", 2200);
      } else if (ev.type === "civilian_killed") {
        this.showToast(`CIVILIAN PENALTY -$${ev.penalty}`, "", 2600);
      } else if (ev.type === "b52_raid_called") {
        this.showToast("B-52 CARPET RAID INBOUND", "info", 2600);
      } else if (ev.type === "v2_launched") {
        this.showToast("V2 CRUISE MISSILE LAUNCHED", "info", 2200);
      }
    }
  }

  buildQMenu() {
    this.elQGrid.innerHTML = "";
    this.qCards = {};
    for (const item of REQUISITION_MENU) {
      const card = document.createElement("div");
      card.className = `q-item ${item.unlocked ? "" : "phase2-locked"}`;
      card.innerHTML = `
        <div class="q-key">${item.key}</div>
        <div style="min-width:0;">
          <div style="font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
          <div style="color:#94a3b8;font-size:10px;">${item.cost > 0 ? `$${item.cost}` : "Free @ Base Pad"}</div>
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

  bindLobbyHandlers(handlers) {
    this.lobbyHandlers = handlers;
    this.elLobbyRoomJoin?.addEventListener("click", () => {
      const val = this.elLobbyRoomInput?.value.trim();
      if (val) handlers.onJoinRoom?.(val);
      this.elLobbyRoomJoin.blur();
    });
    this.elLobbyRoomInput?.addEventListener("keydown", (e) => {
      if (e.code === "Enter") {
        const val = this.elLobbyRoomInput.value.trim();
        if (val) handlers.onJoinRoom?.(val);
        this.elLobbyRoomInput.blur();
      }
    });
    for (const btn of this.elLobbyModeBtns) {
      btn.addEventListener("click", () => {
        handlers.onSelectMode?.(btn.dataset.mode);
        btn.blur();
      });
    }
    this.elLobbyBotsBtn?.addEventListener("click", () => {
      handlers.onToggleBots?.();
      this.elLobbyBotsBtn.blur();
    });
    this.elLobbyAutoProdBtn?.addEventListener("click", () => {
      handlers.onToggleAutoProduction?.();
      this.elLobbyAutoProdBtn.blur();
    });
    this.elLobbyCallsign?.addEventListener("change", () => {
      handlers.onCallsignChange?.(this.elLobbyCallsign.value);
    });
    this.elLobbyCallsign?.addEventListener("keydown", (e) => {
      if (e.code === "Enter") {
        handlers.onCallsignChange?.(this.elLobbyCallsign.value);
        this.elLobbyCallsign.blur();
      }
    });
    this.elLobbyJoinAllied?.addEventListener("click", () => {
      handlers.onSelectTeam?.("allied");
      this.elLobbyJoinAllied.blur();
    });
    this.elLobbyJoinEnemy?.addEventListener("click", () => {
      handlers.onSelectTeam?.("enemy");
      this.elLobbyJoinEnemy.blur();
    });
    this.elLobbyCraftHeli?.addEventListener("click", () => {
      handlers.onSelectAircraft?.("heli");
      this.elLobbyCraftHeli.blur();
    });
    this.elLobbyCraftP47?.addEventListener("click", () => {
      handlers.onSelectAircraft?.("p47");
      this.elLobbyCraftP47.blur();
    });
    this.elLobbyReadyBtn?.addEventListener("click", () => {
      handlers.onToggleReady?.();
      this.elLobbyReadyBtn.blur();
    });
    this.elLobbyStartBtn?.addEventListener("click", () => {
      handlers.onStartMatch?.();
      this.elLobbyStartBtn.blur();
    });
    this.elVictoryRematchBtn?.addEventListener("click", () => {
      handlers.onRematch?.();
      this.elVictoryRematchBtn.blur();
    });
    this.elVictoryLobbyBtn?.addEventListener("click", () => {
      handlers.onReturnToLobby?.();
      this.elVictoryLobbyBtn.blur();
    });
  }

  escapeHtml(text) {
    return String(text || "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  updateLobby(state, localPlayerId, roomsList = []) {
    if (!this.elLobbyOverlay) return;
    const isLobby = state.phase === "lobby";
    this.elLobbyOverlay.style.display = isLobby ? "flex" : "none";
    if (!isLobby) {
      if (document.activeElement && this.elLobbyOverlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      return;
    }

    const activeRoomId = state.roomId || "ALPHA";
    const rooms = roomsList.length
      ? roomsList
      : [{ id: activeRoomId, phase: state.phase, matchMode: state.matchMode, humanCount: Object.values(state.players).filter((p) => !p.isBot).length }];

    const roomsSig = rooms.map((r) => `${r.id}:${r.humanCount}:${r.phase}:${r.id === activeRoomId}`).join("|");
    if (roomsSig !== this.lastRoomsSig && this.elLobbyRooms) {
      this.lastRoomsSig = roomsSig;
      this.elLobbyRooms.innerHTML = "";
      for (const r of rooms) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `lobby-btn ${r.id === activeRoomId ? "active" : ""}`;
        btn.textContent = `${r.id} (${r.humanCount})`;
        btn.addEventListener("click", () => {
          this.lobbyHandlers?.onJoinRoom?.(r.id);
          btn.blur();
        });
        this.elLobbyRooms.appendChild(btn);
      }
    }

    for (const btn of this.elLobbyModeBtns) {
      btn.classList.toggle("active", btn.dataset.mode === state.matchMode);
    }
    if (this.elLobbyBotsBtn) {
      this.elLobbyBotsBtn.textContent = `AI BOTS: ${state.botsEnabled ? "ON" : "OFF"}`;
      this.elLobbyBotsBtn.classList.toggle("active", Boolean(state.botsEnabled));
    }

    const localP = state.players[localPlayerId];
    const localTeam = localP?.team || "allied";
    if (this.elLobbyAutoProdBtn) {
      const autoOn = Boolean(state.autoProduction?.[localTeam]);
      this.elLobbyAutoProdBtn.textContent = `AUTO PROD: ${autoOn ? "ON" : "OFF"}`;
      this.elLobbyAutoProdBtn.classList.toggle("active", autoOn);
    }
    if (this.elLobbyCallsign && document.activeElement !== this.elLobbyCallsign && localP) {
      this.elLobbyCallsign.value = localP.callsign || "";
    }

    this.elLobbyPanelAllied?.classList.toggle("selected-allied", localP?.team === "allied");
    this.elLobbyPanelEnemy?.classList.toggle("selected-enemy", localP?.team === "enemy");
    this.elLobbyJoinAllied?.classList.toggle("active", localP?.team === "allied");
    this.elLobbyJoinEnemy?.classList.toggle("active", localP?.team === "enemy");
    this.elLobbyCraftHeli?.classList.toggle("selected-craft", localP?.aircraftType === "heli");
    this.elLobbyCraftP47?.classList.toggle("selected-craft", localP?.aircraftType === "p47");

    if (this.elLobbyReadyBtn) {
      const isReady = Boolean(localP?.ready);
      this.elLobbyReadyBtn.textContent = isReady ? "READY ✓" : "READY";
      this.elLobbyReadyBtn.classList.toggle("ready-on", isReady);
    }

    const rosterSig = Object.values(state.players)
      .map((p) => `${p.id}:${p.team}:${p.aircraftType}:${p.callsign}:${p.isBot}:${p.ready}`)
      .join("|");
    if (rosterSig !== this.lastRosterSig) {
      this.lastRosterSig = rosterSig;
      const renderRoster = (team, el) => {
        if (!el) return;
        const members = Object.values(state.players).filter((p) => p.team === team);
        if (!members.length) {
          el.innerHTML = `<div class="roster-slot" style="color:#64748b;">No pilots assigned</div>`;
          return;
        }
        el.innerHTML = members
          .map((p) => {
            const isLocal = p.id === localPlayerId;
            const tag = isLocal ? "YOU" : p.isBot ? "AI BOT" : p.ready ? "READY" : "PILOT";
            const tagColor = isLocal ? "#fde047" : p.isBot ? "#94a3b8" : p.ready ? "#4ade80" : "#cbd5e1";
            const craft = p.aircraftType === "p47" ? "P-47" : "HELI";
            return `<div class="roster-slot"><span><strong>${this.escapeHtml(p.callsign || p.id)}</strong> <span style="color:#94a3b8;">(${craft})</span></span><span style="color:${tagColor};font-weight:800;font-size:10px;">${tag}</span></div>`;
          })
          .join("");
      };
      renderRoster("allied", this.elLobbyAlliedRoster);
      renderRoster("enemy", this.elLobbyEnemyRoster);
    }
  }

  update(state, localPlayerId, camX, b52Aiming = null, audioEnabled = true, roomsList = []) {
    this.updateLobby(state, localPlayerId, roomsList);
    const p = state.players[localPlayerId];
    this.elAlliedHq.style.width = `${(state.hqs.allied.hp / state.hqs.allied.maxHp) * 100}%`;
    this.elEnemyHq.style.width = `${(state.hqs.enemy.hp / state.hqs.enemy.maxHp) * 100}%`;

    const team = p?.team || "allied";
    const funds = state.teamFunds[team] ?? 0;
    this.elFunds.textContent = `$${Math.floor(funds)}`;
    this.elTeamBadge.textContent = team.toUpperCase();
    this.elTeamBadge.style.color = team === "allied" ? "#60a5fa" : "#f87171";

    if (this.elModeBadge) {
      const modeLabel = (state.matchMode || "1v1").toUpperCase();
      this.elModeBadge.textContent = `${modeLabel} • BOTS ${state.botsEnabled ? "ON" : "OFF"}`;
    }
    const autoOn = Boolean(state.autoProduction?.[team]);
    if (this.elAutoProdBadge) {
      this.elAutoProdBadge.textContent = autoOn ? "AUTO ON" : "AUTO OFF";
      this.elAutoProdBadge.style.color = autoOn ? "#22c55e" : "#94a3b8";
    }
    if (this.elQAutoProdStatus) {
      this.elQAutoProdStatus.textContent = autoOn ? "T: AUTO PROD ON (TANKS & AA)" : "T: AUTO PROD OFF";
      this.elQAutoProdStatus.style.color = autoOn ? "#22c55e" : "#94a3b8";
    }
    if (this.elAudioBadge) {
      this.elAudioBadge.textContent = audioEnabled ? "SFX ON" : "SFX OFF";
      this.elAudioBadge.style.color = audioEnabled ? "#22c55e" : "#94a3b8";
    }

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

    // Highlight affordable requisitions
    for (const item of REQUISITION_MENU) {
      const card = this.qCards[item.key];
      if (!card) continue;
      if (item.key === "0") {
        card.classList.toggle("active-ready", Boolean(p?.alive && p?.landedAtBase));
      } else {
        const affordable = !state.winner && funds >= item.cost;
        card.classList.toggle("active-ready", affordable);
        card.classList.toggle("phase2-locked", !affordable);
      }
    }

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

      // Cabin display (shows both infantry paratroopers and rescued civilians)
      if (p.aircraftType === "heli") {
        const infCount = p.passengers.filter((u) => u === "infantry").length;
        const civCount = p.passengers.filter((u) => u === "civilian").length;
        this.elCabin.textContent = `CABIN: ${infCount} INF • ${civCount} CIV (${p.passengers.length}/${p.cabinCapacity})`;
      } else {
        this.elCabin.textContent = "P-47 STRAIGHT ROCKETS (4,000m FUEL)";
      }

      // Base pad passive indicator (no modal!)
      this.elBaseBanner.style.display = p.alive && p.landedAtBase ? "block" : "none";
    }

    // Diegetic Tactical Alert Banner
    if (this.elTacticalAlert) {
      let alertText = "";
      let alertClass = "";
      const p47Stalling = p?.aircraftType === "p47" && p?.alive && !p?.landedAtBase && (p?.flightStage >= 3 || (p?.y < 55 && p?.vy < -45));
      if (b52Aiming?.active) {
        alertText = `B-52 TARGETING (X: ${Math.round(b52Aiming.targetX)}m) — ←/→ MOVE • S/ENTER LAUNCH • Q/ESC CANCEL`;
        alertClass = "info";
      } else if (p?.controllingV2Id) {
        alertText = "STEERING V2 CRUISE MISSILE — ←/→ SPEED • ↑/↓ PITCH";
        alertClass = "info";
      } else if (p?.samWarningTicks > 0) {
        alertText = "SAM LOCK — PRESS Z FOR FLARES!";
        alertClass = "";
      } else if (p?.aaWarningTicks > 0) {
        alertText = "INCOMING AA SAM — EVADE!";
        alertClass = "";
      } else if (p47Stalling) {
        alertText = "STALL / DESCENDING — HOLD ←/→ THRUST";
        alertClass = "";
      } else if (this.toastMsg && performance.now() < this.toastUntil) {
        alertText = this.toastMsg;
        alertClass = this.toastVariant;
      }

      if (alertText) {
        this.elTacticalAlert.textContent = alertText;
        this.elTacticalAlert.className = alertClass;
        this.elTacticalAlert.style.display = "block";
      } else {
        this.elTacticalAlert.style.display = "none";
      }
    }

    // Match Victory / Scoreboard & Rematch Overlay
    if (this.elVictoryBanner) {
      if (state.winner) {
        this.elVictoryBanner.style.display = "block";
        this.elVictoryTitle.textContent = `${state.winner.toUpperCase()} VICTORY`;
        this.elVictoryTitle.style.color = state.winner === "allied" ? "#60a5fa" : "#f87171";
        if (this.elVictoryStats) {
          const secs = Math.max(0, Math.floor(state.time || 0));
          const mins = Math.floor(secs / 60);
          const rem = String(secs % 60).padStart(2, "0");
          const alliedBunkers = state.bunkers.filter((b) => b.owner === "allied").length;
          const enemyBunkers = state.bunkers.filter((b) => b.owner === "enemy").length;
          const stA = state.stats?.allied || { unitsBought: 0, civiliansRescued: 0, fundsEarned: 500 };
          const stE = state.stats?.enemy || { unitsBought: 0, civiliansRescued: 0, fundsEarned: 500 };
          this.elVictoryStats.innerHTML = `
            <div><span class="v-stat-label">Duration:</span> <span class="v-stat-val">${mins}:${rem} (${(state.matchMode || "1v1").toUpperCase()})</span></div>
            <div><span class="v-stat-label">Bunkers Held:</span> <span class="v-stat-val">${alliedBunkers} Allied / ${enemyBunkers} Enemy</span></div>
            <div><span class="v-stat-label">Units Deployed:</span> <span class="v-stat-val">${stA.unitsBought} / ${stE.unitsBought}</span></div>
            <div><span class="v-stat-label">Civilians Rescued:</span> <span class="v-stat-val">${stA.civiliansRescued} / ${stE.civiliansRescued}</span></div>
            <div><span class="v-stat-label">Allied Funds Earned:</span> <span class="v-stat-val">$${Math.round(stA.fundsEarned)}</span></div>
            <div><span class="v-stat-label">Enemy Funds Earned:</span> <span class="v-stat-val">$${Math.round(stE.fundsEarned)}</span></div>
          `;
        }
        this.elVictorySub.innerHTML = `${state.winner === "allied" ? "ENEMY" : "ALLIED"} HQ DESTROYED • PRESS <span class="kbd">R</span> FOR REMATCH • <span class="kbd">L</span> LOBBY`;
      } else {
        this.elVictoryBanner.style.display = "none";
      }
    }

    this.drawRadar(state, localPlayerId, camX, b52Aiming);
  }

  renderPips(container, current, max, cls) {
    let html = "";
    for (let i = 0; i < max; i++) {
      html += `<div class="${cls} ${i < current ? "on" : ""}"></div>`;
    }
    container.innerHTML = html;
  }

  drawRadar(state, localPlayerId, camX, b52Aiming = null) {
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

    // B-52 Aiming Strip Reticle
    if (b52Aiming?.active) {
      const stripHalf = STRATEGIC_CONFIG.b52_raid.stripWidth * 0.5;
      const sx1 = toRx(b52Aiming.targetX - stripHalf);
      const sx2 = toRx(b52Aiming.targetX + stripHalf);
      ctx.fillStyle = "rgba(245, 158, 11, 0.24)";
      ctx.fillRect(sx1, 4, sx2 - sx1, h - 18);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx1, 4, sx2 - sx1, h - 18);
    }

    // Active B-52 Target Zones & Bomber Blips
    for (const b52 of state.b52s || []) {
      const stripHalf = (b52.stripWidth || 1500) * 0.5;
      const sx1 = toRx(b52.targetX - stripHalf);
      const sx2 = toRx(b52.targetX + stripHalf);
      ctx.fillStyle = b52.team === "allied" ? "rgba(96, 165, 250, 0.14)" : "rgba(248, 113, 113, 0.14)";
      ctx.fillRect(sx1, 8, sx2 - sx1, h - 22);

      const bx = toRx(b52.x);
      const by = toRy(b52.y);
      ctx.fillStyle = b52.team === "allied" ? "#93c5fd" : "#fca5a5";
      ctx.fillRect(bx - 6, by - 2, 12, 4);
    }

    // Bunkers
    for (const b of state.bunkers) {
      ctx.fillStyle = b.owner === "allied" ? "#3b82f6" : b.owner === "enemy" ? "#ef4444" : "#94a3b8";
      ctx.fillRect(toRx(b.x) - 3, h - 19, 6, 6);
    }

    // Civilians (blinking orange distress beacons)
    const blink = Math.floor(state.time * 4) % 2 === 0;
    ctx.fillStyle = blink ? "#fb923c" : "#fdba74";
    for (const c of state.civilians || []) {
      ctx.fillRect(toRx(c.x) - 1.5, h - 21, 3, 4);
    }

    // Practice Targets
    ctx.fillStyle = "#f97316";
    for (const t of state.targets) {
      if (t.hp <= 0) continue;
      ctx.fillRect(toRx(t.x) - 2, h - 17, 4, 3);
    }

    // RTS Ground Units
    for (const u of state.units || []) {
      if (u.hp <= 0) continue;
      ctx.fillStyle = u.kind === "ambulance" ? "#fef08a" : u.team === "allied" ? "#60a5fa" : "#f87171";
      const size = u.kind === "infantry" ? 2.5 : 4;
      ctx.fillRect(toRx(u.x) - size * 0.5, h - 17, size, 3);
    }

    // Paratroopers
    ctx.fillStyle = "#4ade80";
    for (const p of state.paratroopers) {
      ctx.fillRect(toRx(p.x) - 1.5, toRy(p.y) - 1.5, 3, 3);
    }

    // Projectiles (highlights P-47 1/3 map missiles & SAMs)
    for (const pr of state.projectiles) {
      if (pr.kind === "p47_missile") {
        ctx.fillStyle = pr.fuelBurnedOut ? "#94a3b8" : "#fde047";
        ctx.fillRect(toRx(pr.x) - 2, toRy(pr.y) - 1.5, 4, 3);
      } else if (pr.kind === "sam_missile") {
        ctx.fillStyle = "#f87171";
        ctx.fillRect(toRx(pr.x) - 1.5, toRy(pr.y) - 1.5, 3, 3);
      }
    }

    // Steerable V2 Cruise Missiles
    for (const v2 of state.v2s || []) {
      ctx.fillStyle = "#e879f9";
      ctx.beginPath();
      ctx.arc(toRx(v2.x), toRy(v2.y), 3.5, 0, Math.PI * 2);
      ctx.fill();
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
