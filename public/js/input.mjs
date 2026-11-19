// Strictly keyboard-only input controller (zero mouse controls per spec)
export class KeyboardInput {
  constructor(onAction) {
    this.keys = new Set();
    this.menuOpen = false;
    this.b52Aiming = false;
    this.lobbyOpen = false;
    this.onAction = onAction;

    this._onKeyDown = (e) => {
      const code = this.resolveCode(e);
      const target = e.target;
      const inFormField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (inFormField) {
        if (!this.lobbyOpen && target.classList?.contains("lobby-input")) {
          target.blur();
        } else {
          if (code === "Escape" || code === "Enter") {
            target.blur();
            e.preventDefault();
          }
          return;
        }
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
        e.preventDefault();
      }
      if (e.repeat) return;

      this.keys.add(code);

      if (code === "Backquote") {
        this.onAction({ type: "toggleTuner" });
        return;
      }

      if (this.lobbyOpen) {
        if (code === "Enter" || code === "Space") {
          e.preventDefault();
          this.onAction({ type: "lobbyLaunch" });
          return;
        }
        if (code === "ArrowLeft") {
          this.onAction({ type: "lobbyTeam", team: "allied" });
          return;
        }
        if (code === "ArrowRight") {
          this.onAction({ type: "lobbyTeam", team: "enemy" });
          return;
        }
        if (code === "Digit1" || code === "Numpad1") {
          this.onAction({ type: "lobbyAircraft", aircraftType: "heli" });
          return;
        }
        if (code === "Digit2" || code === "Numpad2") {
          this.onAction({ type: "lobbyAircraft", aircraftType: "p47" });
          return;
        }
        if (code === "KeyM") {
          this.onAction({ type: "cycleMatchMode" });
          return;
        }
        if (code === "KeyB") {
          this.onAction({ type: "toggleBots" });
          return;
        }
        if (code === "KeyN") {
          this.onAction({ type: "toggleAudio" });
          return;
        }
        return;
      }

      if (code === "Escape") {
        if (this.menuOpen || this.b52Aiming) {
          this.menuOpen = false;
          this.b52Aiming = false;
          this.onAction({ type: "cancelMenu" });
        }
        return;
      }

      if (code === "KeyQ") {
        if (this.b52Aiming) {
          this.b52Aiming = false;
          this.menuOpen = false;
          this.onAction({ type: "cancelMenu" });
          return;
        }
        this.menuOpen = !this.menuOpen;
        this.onAction({ type: "toggleMenu", open: this.menuOpen });
        return;
      }

      if (this.b52Aiming && (code === "KeyS" || code === "Enter")) {
        e.preventDefault();
        this.onAction({ type: "confirmB52" });
        return;
      }

      if (code === "KeyR") {
        this.onAction({ type: "restartMatch" });
        return;
      }

      if (code === "KeyM") {
        this.onAction({ type: "cycleMatchMode" });
        return;
      }

      if (code === "KeyB") {
        this.onAction({ type: "toggleBots" });
        return;
      }

      if (code === "KeyN") {
        this.onAction({ type: "toggleAudio" });
        return;
      }

      if (code === "KeyL") {
        this.onAction({ type: "returnToLobby" });
        return;
      }

      if (code === "KeyE") {
        this.onAction({ type: "utility" });
        return;
      }

      if (this.menuOpen && (code.startsWith("Digit") || code.startsWith("Numpad"))) {
        const digit = code.replace("Digit", "").replace("Numpad", "");
        if (/^[0-9]$/.test(digit)) {
          this.onAction({ type: "menuKey", key: digit });
        }
      }
    };

    this._onKeyUp = (e) => {
      this.keys.delete(this.resolveCode(e));
    };

    this._onBlur = () => {
      this.keys.clear();
    };

    this._onPointerDown = () => {
      if (!this.lobbyOpen && typeof document !== "undefined" && document.activeElement?.classList?.contains("lobby-input")) {
        document.activeElement.blur();
      }
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    window.addEventListener("pointerdown", this._onPointerDown);
  }

  resolveCode(e) {
    if (e?.code) return e.code;
    const key = e?.key || "";
    const map = {
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      " ": "Space",
      Enter: "Enter",
      Escape: "Escape",
      "`": "Backquote",
      q: "KeyQ", Q: "KeyQ",
      r: "KeyR", R: "KeyR",
      l: "KeyL", L: "KeyL",
      e: "KeyE", E: "KeyE",
      a: "KeyA", A: "KeyA",
      s: "KeyS", S: "KeyS",
      z: "KeyZ", Z: "KeyZ",
      m: "KeyM", M: "KeyM",
      b: "KeyB", B: "KeyB",
      n: "KeyN", N: "KeyN",
      0: "Digit0", 1: "Digit1", 2: "Digit2", 3: "Digit3", 4: "Digit4",
      5: "Digit5", 6: "Digit6", 7: "Digit7", 8: "Digit8", 9: "Digit9"
    };
    return map[key] || key;
  }

  isRawKeyDown(code) {
    return this.keys.has(code);
  }

  getSnapshot() {
    if (this.lobbyOpen) {
      return {
        left: false,
        right: false,
        up: false,
        down: false,
        firePrimary: false,
        fireSecondary: false,
        fireFlare: false
      };
    }
    return {
      left: this.b52Aiming ? false : this.keys.has("ArrowLeft"),
      right: this.b52Aiming ? false : this.keys.has("ArrowRight"),
      up: this.keys.has("ArrowUp"),
      down: this.keys.has("ArrowDown"),
      firePrimary: this.keys.has("KeyA"),
      fireSecondary: this.b52Aiming ? false : this.keys.has("KeyS"),
      fireFlare: this.keys.has("KeyZ")
    };
  }

  destroy() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    window.removeEventListener("pointerdown", this._onPointerDown);
  }
}
