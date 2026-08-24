/**
 * Procedural table audio for House Blackjack.
 *
 * Every sound is SYNTHESIZED with the Web Audio API — no asset files, no
 * network cost, and each hit is subtly randomized so repeated actions never
 * sound like a looping sample. Design brief: quiet luxury. Dry, close-miked,
 * felt-dampened. Nothing arcade-y.
 *
 * Browsers block audio until a user gesture, so the AudioContext is created
 * lazily on the first play() and resumed if suspended. Muting is remembered
 * in localStorage under `suite7:muted`.
 */

const MUTE_KEY = "suite7:muted";

/** Master trim so the whole table sits politely under the page. */
const MASTER_GAIN = 0.5;

type Voice =
  | "cardSlide"
  | "cardLand"
  | "cardFlip"
  | "chipToss"
  | "chipStack"
  | "shuffle"
  | "shaker"
  | "pour"
  | "win"
  | "lose"
  | "push";

class TableAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  /** Shared noise buffer — generated once, reused by every noise voice. */
  private noise: AudioBuffer | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // non-fatal: the preference just won't survive a reload
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
    }
  }

  /** Lazily build the graph. Returns null when audio is unavailable. */
  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);

      // ~1s of white noise, the raw material for slides, thuds and shuffles.
      const frames = Math.floor(ctx.sampleRate);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.noise = buffer;
      return ctx;
    } catch {
      return null;
    }
  }

  /** A shaped burst of the shared noise buffer. */
  private noiseBurst(
    ctx: AudioContext,
    at: number,
    opts: {
      duration: number;
      gain: number;
      type: BiquadFilterType;
      freq: number;
      freqEnd?: number;
      q?: number;
      attack?: number;
    }
  ): void {
    if (!this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    // Start at a random offset so successive bursts differ.
    const offset = Math.random() * 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.setValueAtTime(opts.freq, at);
    if (opts.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), at + opts.duration);
    }
    filter.Q.value = opts.q ?? 0.7;

    const env = ctx.createGain();
    const attack = opts.attack ?? 0.004;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(opts.gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + opts.duration);

    src.connect(filter).connect(env).connect(this.master);
    src.start(at, offset, opts.duration + 0.05);
    src.stop(at + opts.duration + 0.05);
  }

  /** A struck-metal partial — the body of a chip clink. */
  private ping(
    ctx: AudioContext,
    at: number,
    freq: number,
    gain: number,
    duration: number,
    type: OscillatorType = "triangle"
  ): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    // Slight downward drift: struck objects lose pitch as they settle.
    osc.frequency.exponentialRampToValueAtTime(freq * 0.94, at + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(env).connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  /**
   * Fire a voice. Safe to call anywhere — silently no-ops when muted or when
   * the browser gives us no audio.
   */
  play(voice: Voice): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const r = (a: number, b: number) => a + Math.random() * (b - a);

    switch (voice) {
      // Card pulled from the shoe: a short paper hiss sweeping down.
      case "cardSlide":
        this.noiseBurst(ctx, t, {
          duration: r(0.16, 0.2),
          gain: 0.16,
          type: "bandpass",
          freq: r(2600, 3200),
          freqEnd: r(900, 1200),
          q: 0.9,
          attack: 0.012,
        });
        break;

      // Card touching felt: a soft dampened thud with a hint of slide.
      case "cardLand":
        this.noiseBurst(ctx, t, {
          duration: 0.09,
          gain: 0.2,
          type: "lowpass",
          freq: r(520, 700),
          q: 0.6,
        });
        this.noiseBurst(ctx, t + 0.01, {
          duration: 0.07,
          gain: 0.06,
          type: "bandpass",
          freq: r(1800, 2400),
          q: 1.2,
        });
        break;

      // The reveal: a crisp snap as the card turns over.
      case "cardFlip":
        this.noiseBurst(ctx, t, {
          duration: 0.05,
          gain: 0.22,
          type: "highpass",
          freq: r(1600, 2200),
          q: 0.8,
          attack: 0.002,
        });
        this.noiseBurst(ctx, t + 0.03, {
          duration: 0.08,
          gain: 0.12,
          type: "lowpass",
          freq: 800,
        });
        break;

      // Clay chip landing: two detuned partials plus a tiny click.
      case "chipToss": {
        const base = r(1150, 1400);
        this.ping(ctx, t, base, 0.13, 0.1);
        this.ping(ctx, t + 0.004, base * r(1.4, 1.55), 0.07, 0.07);
        this.noiseBurst(ctx, t, {
          duration: 0.035,
          gain: 0.1,
          type: "bandpass",
          freq: r(2400, 3200),
          q: 1.5,
          attack: 0.001,
        });
        break;
      }

      // A stack riffling — several clinks in quick, uneven succession.
      case "chipStack": {
        const hits = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < hits; i++) {
          const at = t + i * r(0.02, 0.045);
          this.ping(ctx, at, r(1000, 1500), 0.07, 0.06);
        }
        break;
      }

      /**
       * The cocktail shaker: ice in a tin. Four two-beat shakes over ~1.2 s —
       * each beat is a dense bright rattle (the cubes), a short low thump (the
       * tin's body) and two metallic partials (its ring), so it reads as metal
       * rather than as a maraca. Every beat is independently jittered in time,
       * pitch and level, so the four shakes never sound like one sample looped.
       */
      case "shaker": {
        const shakes = 4;
        const period = 0.3; // 4 x 0.3 = the 1.2 s the pour is cued off
        for (let i = 0; i < shakes; i++) {
          // The forward throw is struck harder than the catch on the way back.
          for (const [off, level] of [
            [0, 0.17],
            [0.088, 0.115],
          ] as const) {
            const a = t + i * period + off + r(-0.007, 0.007);
            // The cubes: a bright, dense rattle that dies almost at once.
            this.noiseBurst(ctx, a, {
              duration: r(0.1, 0.145),
              gain: level,
              type: "bandpass",
              freq: r(3600, 5200),
              freqEnd: r(1800, 2600),
              q: 0.85,
              attack: 0.002,
            });
            // The tin taking the hit.
            this.noiseBurst(ctx, a + 0.002, {
              duration: 0.075,
              gain: level * 0.5,
              type: "lowpass",
              freq: r(250, 360),
              attack: 0.002,
            });
            // Its metallic ring — two partials, the upper one quieter.
            this.ping(ctx, a, r(2050, 2600), level * 0.3, 0.17, "triangle");
            this.ping(ctx, a + 0.004, r(3150, 3950), level * 0.15, 0.11, "sine");
          }
        }
        break;
      }

      /**
       * The pour: a SUSTAINED liquid stream, ~1.5 s, not a burst. The shared
       * noise buffer is looped through a band-pass that opens as the stream
       * finds the bowl and closes again as it is cut off, wobbled by a slow LFO
       * so it reads as liquid rather than as hiss, with bubbles rising in pitch
       * as the glass fills.
       */
      case "pour": {
        if (!this.noise) break;
        const dur = 1.5;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.playbackRate.value = r(0.9, 1.1);

        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 420;

        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 0.8;
        bp.frequency.setValueAtTime(r(820, 980), t);
        bp.frequency.linearRampToValueAtTime(r(2000, 2400), t + dur * 0.55);
        bp.frequency.linearRampToValueAtTime(r(1350, 1650), t + dur);

        // Splash wobble on the filter, so the stream breathes.
        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = r(6.5, 8.5);
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 260;
        lfo.connect(lfoDepth).connect(bp.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);

        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.135, t + 0.09);
        env.gain.setValueAtTime(0.135, t + dur - 0.28);
        env.gain.linearRampToValueAtTime(0.0001, t + dur);

        src.connect(hp).connect(bp).connect(env).connect(this.master);
        src.start(t);
        src.stop(t + dur + 0.05);

        // Bubbles: the resonance of the bowl climbs as the level rises.
        for (let i = 0; i < 9; i++) {
          const a = t + 0.14 + i * r(0.12, 0.18);
          if (a > t + dur - 0.12) break;
          this.ping(ctx, a, r(320, 520) * (1 + i * 0.09), 0.03, 0.05, "sine");
        }
        break;
      }

      // Shoe refill / shuffle: a longer riffle wash.
      case "shuffle": {
        for (let i = 0; i < 14; i++) {
          this.noiseBurst(ctx, t + i * r(0.03, 0.055), {
            duration: 0.05,
            gain: 0.07,
            type: "bandpass",
            freq: r(1800, 3400),
            q: 1.1,
            attack: 0.003,
          });
        }
        break;
      }

      // Win: a quiet gold arpeggio, major and unhurried.
      case "win": {
        const root = 523.25; // C5
        [1, 1.25, 1.5, 2].forEach((mult, i) => {
          this.ping(ctx, t + i * 0.075, root * mult, 0.075, 0.5, "sine");
        });
        break;
      }

      // Loss: a single low, dry note. No sting, no punishment.
      case "lose":
        this.ping(ctx, t, 174.61, 0.075, 0.42, "sine");
        break;

      // Push: one neutral tone.
      case "push":
        this.ping(ctx, t, 329.63, 0.06, 0.3, "sine");
        break;
    }
  }

  /** Release the context (call on unmount of the last consumer). */
  dispose(): void {
    try {
      void this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }
}

/** Lazily-created singleton — one graph shared by the whole table. */
let instance: TableAudio | null = null;

export function tableAudio(): TableAudio {
  if (!instance) instance = new TableAudio();
  return instance;
}

export type { Voice };
