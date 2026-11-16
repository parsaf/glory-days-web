// Strictly keyboard-only input controller (zero mouse controls per spec)
export class KeyboardInput {
  constructor(onAction) {
    this.keys = new Set();
    this.menuOpen = false;
    this.onAction = onAction;

    this._onKeyDown = (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;

      this.keys.add(e.code);

      if (e.code === "KeyQ") {
        this.menuOpen = !this.menuOpen;
        this.onAction({ type: "toggleMenu", open: this.menuOpen });
        return;
      }

      if (e.code === "KeyE") {
        this.onAction({ type: "utility" });
        return;
      }

      if (this.menuOpen && e.code.startsWith("Digit")) {
        const digit = e.code.slice(5);
        this.onAction({ type: "menuKey", key: digit });
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

  getSnapshot() {
    return {
      left: this.keys.has("ArrowLeft"),
      right: this.keys.has("ArrowRight"),
      up: this.keys.has("ArrowUp"),
      down: this.keys.has("ArrowDown"),
      firePrimary: this.keys.has("KeyA"),
      fireSecondary: this.keys.has("KeyS"),
      fireFlare: this.keys.has("KeyZ")
    };
  }

  destroy() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
  }
}
