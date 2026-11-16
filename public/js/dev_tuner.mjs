import {
  AIRCRAFT_CONFIG,
  DEFAULT_P47_CONFIG,
  P47_TUNING_SCHEMA
} from "../../shared/constants.mjs";

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class DevPhysicsTuner {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.open = false;
    this.controls = new Map();
    this.elPanel = document.getElementById("dev-tuner");
    this.elToggleBtn = document.getElementById("tuner-toggle-btn");
    this.elTelemetry = document.getElementById("tuner-telemetry");
    this.elGroups = document.getElementById("tuner-groups");
    this.elSpawnAirBtn = document.getElementById("tuner-spawn-air");
    this.elSpawnRunwayBtn = document.getElementById("tuner-spawn-runway");
    this.elResetBtn = document.getElementById("tuner-reset-btn");
    this.elCopyBtn = document.getElementById("tuner-copy-btn");

    this._lastTelemetryHtml = "";
    this._lastTelemetryAt = 0;

    this.buildControls();
    this.bindActions();
    this.setOpen(callbacks.initialOpen ?? true);
  }

  setOpen(open) {
    this.open = Boolean(open);
    this.elPanel.classList.toggle("open", this.open);
    this.elToggleBtn.classList.toggle("active", this.open);
    this.elToggleBtn.textContent = this.open ? "CLOSE TUNER (`)" : "P-47 PHYSICS TUNER (`)";
    if (document.activeElement === this.elToggleBtn) {
      this.elToggleBtn.blur();
    }
  }

  toggle() {
    this.setOpen(!this.open);
  }

  bindActions() {
    this.elToggleBtn.addEventListener("click", () => {
      this.toggle();
      this.elToggleBtn.blur();
    });

    this.elSpawnAirBtn.addEventListener("click", () => {
      this.callbacks.onSpawnTest?.("air");
      this.elSpawnAirBtn.blur();
    });

    this.elSpawnRunwayBtn.addEventListener("click", () => {
      this.callbacks.onSpawnTest?.("runway");
      this.elSpawnRunwayBtn.blur();
    });

    this.elResetBtn.addEventListener("click", () => {
      this.callbacks.onReset?.();
      this.elResetBtn.blur();
    });

    this.elCopyBtn.addEventListener("click", async () => {
      const exportObj = {};
      for (const group of P47_TUNING_SCHEMA) {
        for (const item of group.items) {
          exportObj[item.key] = AIRCRAFT_CONFIG.p47[item.key];
        }
      }
      const json = JSON.stringify(exportObj, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        this.elCopyBtn.textContent = "COPIED JSON!";
      } catch {
        window.prompt("Copy tuned P-47 config JSON:", json);
      }
      setTimeout(() => {
        this.elCopyBtn.textContent = "COPY JSON";
      }, 1400);
      this.elCopyBtn.blur();
    });
  }

  buildControls() {
    this.elGroups.innerHTML = "";
    this.controls.clear();

    for (const group of P47_TUNING_SCHEMA) {
      const section = document.createElement("details");
      section.className = "tuner-group";
      section.open = true;

      const summary = document.createElement("summary");
      summary.textContent = group.group;
      section.appendChild(summary);

      const list = document.createElement("div");
      list.className = "tuner-list";

      for (const item of group.items) {
        const row = document.createElement("div");
        row.className = "tuner-row";
        row.title = `${item.desc} (Default: ${DEFAULT_P47_CONFIG[item.key]} ${item.unit})`;

        const labelWrap = document.createElement("div");
        labelWrap.className = "tuner-label-wrap";

        const label = document.createElement("span");
        label.className = "tuner-label";
        label.textContent = item.label;

        const hint = document.createElement("span");
        hint.className = "tuner-unit";
        hint.textContent = item.unit;

        labelWrap.appendChild(label);
        labelWrap.appendChild(hint);

        const inputsWrap = document.createElement("div");
        inputsWrap.className = "tuner-inputs";

        const range = document.createElement("input");
        range.type = "range";
        range.min = String(item.min);
        range.max = String(item.max);
        range.step = String(item.step);
        range.value = String(AIRCRAFT_CONFIG.p47[item.key]);
        range.tabIndex = -1;

        const num = document.createElement("input");
        num.type = "number";
        num.min = String(item.min);
        num.max = String(item.max);
        num.step = String(item.step);
        num.value = String(AIRCRAFT_CONFIG.p47[item.key]);
        num.className = "tuner-num";

        const emitPatch = (raw) => {
          const val = Number(raw);
          if (!Number.isFinite(val)) return;
          range.value = String(clamp(val, item.min, item.max));
          num.value = String(val);
          this.callbacks.onPatch?.({ [item.key]: val });
        };

        range.addEventListener("input", () => emitPatch(range.value));
        range.addEventListener("change", () => range.blur());

        num.addEventListener("input", () => {
          const val = Number(num.value);
          if (!Number.isFinite(val)) return;
          range.value = String(clamp(val, item.min, item.max));
          this.callbacks.onPatch?.({ [item.key]: val });
        });
        num.addEventListener("change", () => {
          emitPatch(num.value);
          num.blur();
        });

        inputsWrap.appendChild(range);
        inputsWrap.appendChild(num);

        row.appendChild(labelWrap);
        row.appendChild(inputsWrap);

        const descEl = document.createElement("div");
        descEl.className = "tuner-desc";
        descEl.textContent = item.desc;
        row.appendChild(descEl);

        list.appendChild(row);
        this.controls.set(item.key, { range, num, item });
      }

      section.appendChild(list);
      this.elGroups.appendChild(section);
    }
  }

  applyConfig(config) {
    if (!config) return;
    Object.assign(AIRCRAFT_CONFIG.p47, config);
    for (const [key, entry] of this.controls.entries()) {
      const val = AIRCRAFT_CONFIG.p47[key];
      if (typeof val !== "number") continue;
      entry.range.value = String(clamp(val, entry.item.min, entry.item.max));
      if (document.activeElement !== entry.num) {
        entry.num.value = String(val);
      }
    }
  }

  updateTelemetry(state, localPlayerId) {
    if (!this.open) return;
    const now = performance.now();
    if (now - this._lastTelemetryAt < 50) return;
    this._lastTelemetryAt = now;

    const p = state.players[localPlayerId];
    const cfg = AIRCRAFT_CONFIG.p47;
    if (!p) {
      this.elTelemetry.innerHTML = `<div class="tel-badge">WAITING FOR PLAYER...</div>`;
      return;
    }

    if (p.aircraftType !== "p47") {
      this.elTelemetry.innerHTML = `
        <div class="tel-row"><span>ACTIVE CRAFT</span><strong style="color:#fbbf24;">HELICOPTER</strong></div>
        <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Click <b>Fly P-47 in Air</b> or <b>P-47 on Runway</b> above to switch instantly and tune flight feel.</div>
      `;
      return;
    }

    const stallRange = Math.max(1, cfg.stallSpeed - cfg.minGlideSpeed);
    const lift = clamp((p.speed - cfg.minGlideSpeed) / stallRange, 0, 1);
    const effPitch = p.effectivePitch ?? p.pitch ?? 0;
    const pitchDeg = (effPitch * 180) / Math.PI;

    let flightPhase = "CRUISE";
    let phaseColor = "#22c55e";
    if (!p.alive) {
      flightPhase = `RESPAWN ${(p.respawnTicks / 60).toFixed(1)}s`;
      phaseColor = "#ef4444";
    } else if (p.crashing) {
      flightPhase = "CRASH SLIDE";
      phaseColor = "#f97316";
    } else if (p.y <= 0.05 && Math.abs(p.vy) < 5) {
      flightPhase = p.speed >= cfg.takeoffSpeed ? "ROTATE READY (↑)" : "RUNWAY ROLL";
      phaseColor = "#38bdf8";
    } else if (p.turnTimer > 0) {
      flightPhase = "WIDE U-TURN";
      phaseColor = "#a855f7";
    } else if (lift < 1) {
      flightPhase = (p.stallTime || 0) < cfg.stallGlideDelay ? "STALL GLIDE" : "STALL NOSE-DIVE";
      phaseColor = (p.stallTime || 0) < cfg.stallGlideDelay ? "#f59e0b" : "#ef4444";
    }

    const liftColor = lift >= 0.99 ? "#22c55e" : lift > 0.25 ? "#f59e0b" : "#ef4444";

    const html = `
      <div class="tel-grid">
        <div class="tel-cell"><span>PHASE</span><strong style="color:${phaseColor};">${flightPhase}</strong></div>
        <div class="tel-cell"><span>SPEED</span><strong>${Math.round(p.speed)} px/s</strong></div>
        <div class="tel-cell"><span>WING LIFT</span><strong style="color:${liftColor};">${Math.round(lift * 100)}%</strong></div>
        <div class="tel-cell"><span>PITCH</span><strong>${pitchDeg >= 0 ? "+" : ""}${pitchDeg.toFixed(1)}°</strong></div>
        <div class="tel-cell"><span>VX / VY</span><strong>${Math.round(p.vx)} / ${Math.round(p.vy)}</strong></div>
        <div class="tel-cell"><span>ALT / HP</span><strong>${Math.round(p.y)}m • ${Math.ceil(p.hp)}/${p.maxHp}</strong></div>
        <div class="tel-cell"><span>COAST TMR</span><strong>${(p.throttleOffTime || 0).toFixed(2)}s</strong></div>
        <div class="tel-cell"><span>STALL TMR</span><strong>${(p.stallTime || 0).toFixed(2)}s</strong></div>
      </div>
    `;
    if (html !== this._lastTelemetryHtml) {
      this._lastTelemetryHtml = html;
      this.elTelemetry.innerHTML = html;
    }
  }
}
