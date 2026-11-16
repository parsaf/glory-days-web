// Strictly keyboard-only input controller (zero mouse controls per spec)
export class KeyboardInput {
  constructor(onAction) {
    this.keys = new Set();
    this.menuOpen = false;
    this.b52Aiming = false;
    this.onAction = onAction;

    this._onKeyDown = (e) => {
      const target = e.target;
      const inFormField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (inFormField) {
        if (e.code === "Escape" || e.code === "Enter") {
          target.blur();
          e.preventDefault();
        }
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;

      this.keys.add(e.code);

      if (e.code === "Backquote") {
        this.onAction({ type: "toggleTuner" });
        return;
      }

      if (e.code === "Escape") {
        if (this.menuOpen || this.b52Aiming) {
          this.menuOpen = false;
          this.b52Aiming = false;
          this.onAction({ type: "cancelMenu" });
        }
        return;
      }

      if (e.code === "KeyQ") {
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

      if (this.b52Aiming && (e.code === "KeyS" || e.code === "Enter")) {
        e.preventDefault();
        this.onAction({ type: "confirmB52" });
        return;
      }

      if (e.code === "KeyR") {
        this.onAction({ type: "restartMatch" });
        return;
      }

      if (e.code === "KeyE") {
        this.onAction({ type: "utility" });
        return;
      }

      if (this.menuOpen && (e.code.startsWith("Digit") || e.code.startsWith("Numpad"))) {
        const digit = e.code.replace("Digit", "").replace("Numpad", "");
        if (/^[0-9]$/.test(digit)) {
          this.onAction({ type: "menuKey", key: digit });
        }
      }
    };

    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    this._onBlur = () => {
      this.keys.clear();
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
  }

  isRawKeyDown(code) {
    return this.keys.has(code);
  }

  getSnapshot() {
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
  }
}
