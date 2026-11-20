// Pure Web Audio API procedural SFX synthesizer (zero external audio files)
export class BattlefieldAudio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.lastExplosionMs = 0;
    this.lastGunMs = 0;
  }

  ensureContext() {
    if (!this.enabled || typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  unlock() {
    this.ensureContext();
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  playTone(freqStart, freqEnd, duration, type = "sine", gainVal = 0.08, delay = 0) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  playNoise(duration, cutoffHz, gainVal = 0.1) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoffHz, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  ingestEvents(events, localPlayer) {
    if (!this.enabled || !events?.length) return;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    for (const ev of events) {
      if (ev.type === "primary_fired" && localPlayer && ev.playerId === localPlayer.id) {
        if (nowMs - this.lastGunMs > 45) {
          this.lastGunMs = nowMs;
          this.playTone(320, 110, 0.045, "square", 0.035);
        }
      } else if (ev.type === "secondary_fired" && localPlayer && ev.playerId === localPlayer.id) {
        this.playTone(240, 75, 0.18, "sawtooth", 0.07);
        this.playNoise(0.14, 900, 0.06);
      } else if (ev.type === "special_weapon_unlocked" && (!localPlayer || ev.team === localPlayer.team)) {
        this.playTone(587, 784, 0.12, "triangle", 0.09, 0);
        this.playTone(784, 1046, 0.18, "triangle", 0.1, 0.11);
      } else if (ev.type === "sam_launched" && localPlayer && ev.targetId === localPlayer.id) {
        this.playTone(880, 1180, 0.09, "square", 0.07, 0);
        this.playTone(880, 1180, 0.09, "square", 0.07, 0.12);
      } else if (ev.type === "explosion") {
        const nearLocal = !localPlayer || Math.abs((ev.x || 0) - localPlayer.x) < 1600;
        if (nearLocal && nowMs - this.lastExplosionMs > 65) {
          this.lastExplosionMs = nowMs;
          const scale = Math.min(2.2, Math.max(0.4, ev.size || 1));
          this.playNoise(0.14 + scale * 0.1, 420 + scale * 120, 0.06 + scale * 0.04);
        }
      } else if (ev.type === "civilians_rescued") {
        this.playTone(523, 659, 0.1, "triangle", 0.08, 0);
        this.playTone(659, 784, 0.12, "triangle", 0.08, 0.09);
        this.playTone(784, 1046, 0.16, "triangle", 0.09, 0.18);
      } else if (ev.type === "bunker_captured") {
        this.playTone(440, 660, 0.14, "triangle", 0.07, 0);
        this.playTone(660, 880, 0.18, "triangle", 0.07, 0.11);
      } else if (ev.type === "b52_raid_called" || ev.type === "v2_launched") {
        this.playTone(140, 320, 0.32, "sawtooth", 0.08);
        this.playNoise(0.32, 600, 0.07);
      } else if (ev.type === "match_won") {
        const won = !localPlayer || ev.winner === localPlayer.team;
        if (won) {
          this.playTone(392, 523, 0.16, "triangle", 0.1, 0);
          this.playTone(523, 659, 0.16, "triangle", 0.1, 0.14);
          this.playTone(659, 784, 0.28, "triangle", 0.12, 0.28);
        } else {
          this.playTone(330, 220, 0.25, "sawtooth", 0.08, 0);
          this.playTone(220, 146, 0.35, "sawtooth", 0.08, 0.22);
        }
      }
    }
  }
}
