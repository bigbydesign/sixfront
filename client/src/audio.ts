import type { Prefs } from "./settings";

const MUSIC_URL = "/sixfront/jesus.mp3";

/**
 * Layered gunshot: crack (the supersonic snap), body (the bang), thump (the low punch),
 * mech (the action cycling), and tail (the echo off the houses).
 */
const GUNS: Record<string, {
  crack: number; crackGain: number; body: number; bodyGain: number; bodyDur: number;
  thump: number; thumpGain: number; mech: number; tail: number; tailDur: number;
}> = {
  pistol: { crack: 5200, crackGain: 0.35, body: 1500, bodyGain: 0.42, bodyDur: 0.09, thump: 120, thumpGain: 0.28, mech: 0.05, tail: 0.18, tailDur: 0.5 },
  rifle: { crack: 6200, crackGain: 0.45, body: 1100, bodyGain: 0.5, bodyDur: 0.11, thump: 90, thumpGain: 0.38, mech: 0.035, tail: 0.24, tailDur: 0.7 },
  smg: { crack: 4800, crackGain: 0.28, body: 1700, bodyGain: 0.34, bodyDur: 0.06, thump: 140, thumpGain: 0.2, mech: 0.03, tail: 0.12, tailDur: 0.4 },
  lmg: { crack: 5600, crackGain: 0.42, body: 850, bodyGain: 0.55, bodyDur: 0.12, thump: 70, thumpGain: 0.44, mech: 0.04, tail: 0.26, tailDur: 0.8 },
  shotgun: { crack: 3400, crackGain: 0.4, body: 600, bodyGain: 0.7, bodyDur: 0.2, thump: 55, thumpGain: 0.6, mech: 0.08, tail: 0.34, tailDur: 1 },
  sniper: { crack: 7400, crackGain: 0.6, body: 700, bodyGain: 0.65, bodyDur: 0.18, thump: 50, thumpGain: 0.6, mech: 0.07, tail: 0.42, tailDur: 1.4 },
  rocket: { crack: 1800, crackGain: 0.2, body: 380, bodyGain: 0.6, bodyDur: 0.4, thump: 60, thumpGain: 0.5, mech: 0, tail: 0.3, tailDur: 1.1 },
};
/** Quiet bed under SFX — fraction of master volume. */
const MUSIC_LEVEL = 0.14;

export class AudioBus {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  musicSrc: AudioBufferSourceNode | null = null;
  musicBuf: AudioBuffer | null = null;
  musicStarted = false;
  musicMuted = false;
  noise: AudioBuffer | null = null;
  motorOsc: OscillatorNode | null = null;
  motorGain: GainNode | null = null;
  prefs: Prefs | null = null;
  pan = 0;
  reverb: GainNode | null = null;

  attach(prefs: Prefs): void {
    this.prefs = prefs;
    if (this.master) this.master.gain.value = prefs.volume;
    this.applyMusicGain();
  }

  /** Toggle background track (Minus / - key). Returns whether music is now muted. */
  toggleMusic(): boolean {
    this.musicMuted = !this.musicMuted;
    this.unlock();
    this.applyMusicGain();
    return this.musicMuted;
  }

  setMusicMuted(muted: boolean): void {
    this.musicMuted = muted;
    this.applyMusicGain();
  }

  private applyMusicGain(): void {
    if (!this.musicGain) return;
    const vol = this.musicMuted ? 0 : (this.prefs?.volume ?? 0.8) * MUSIC_LEVEL;
    this.musicGain.gain.setTargetAtTime(Math.max(0.0001, vol), this.ctx?.currentTime ?? 0, 0.05);
    if (vol <= 0) this.musicGain.gain.value = 0;
  }

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      void this.ensureMusic();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.prefs?.volume ?? 0.8;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.applyMusicGain();
    const samples = ctx.sampleRate * 1;
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    const irLen = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / ctx.sampleRate;
        const slap = t > 0.07 && t < 0.085 ? 0.5 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.exp(-t * 3.4) * 0.6 + slap);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    conv.connect(wet);
    wet.connect(this.master);
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 1;
    this.reverb.connect(conv);
    void ctx.resume();
    void this.ensureMusic();
  }

  private async ensureMusic(): Promise<void> {
    if (!this.ctx || !this.musicGain || this.musicStarted) return;
    try {
      if (!this.musicBuf) {
        const res = await fetch(MUSIC_URL);
        const raw = await res.arrayBuffer();
        this.musicBuf = await this.ctx.decodeAudioData(raw.slice(0));
      }
      if (this.musicStarted || !this.musicBuf) return;
      this.musicStarted = true;
      const src = this.ctx.createBufferSource();
      src.buffer = this.musicBuf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start(0);
      this.musicSrc = src;
    } catch {
      /* music optional — ignore load errors */
    }
  }

  private burst(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0): void {
    if (!this.ctx || !this.master || (this.prefs?.volume ?? 1) <= 0) return;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), this.ctx.currentTime + dur);
    amp.gain.setValueAtTime(gain, this.ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(amp);
    amp.connect(this.panner());
    osc.start();
    osc.stop(this.ctx.currentTime + dur + 0.02);
  }

  private noiseHit(dur: number, gain: number, freq: number): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain, this.ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(this.panner());
    src.start();
    src.stop(this.ctx.currentTime + dur + 0.02);
  }

  private panner(): StereoPannerNode {
    const node = this.ctx!.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, this.pan));
    node.connect(this.master!);
    return node;
  }

  /** A gunshot heard `dist` meters away. Far shots arrive late, quieter, and muffled. */
  gun(kind: string, pan = 0, dist = 0): void {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || (this.prefs?.volume ?? 1) <= 0) return;
    const g = GUNS[kind] ?? GUNS.rifle;
    const t0 = ctx.currentTime + Math.min(0.35, dist / 343);
    const near = 1 / (1 + dist / 22);
    const jitter = 0.94 + Math.random() * 0.12;

    const out = ctx.createGain();
    out.gain.value = near;
    const muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = Math.max(900, 17000 / (1 + dist / 10));
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(muffle);
    muffle.connect(panner);
    panner.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = g.tail * (0.6 + Math.min(1.4, dist / 30));
    muffle.connect(send);
    if (this.reverb) send.connect(this.reverb);

    const noise = (start: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = jitter;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq * jitter;
      f.Q.value = q;
      const a = ctx.createGain();
      a.gain.setValueAtTime(0.0001, start);
      a.gain.exponentialRampToValueAtTime(gain, start + 0.002);
      a.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      src.connect(f);
      f.connect(a);
      a.connect(out);
      src.start(start, Math.random() * 0.5);
      src.stop(start + dur + 0.02);
    };
    const tone = (start: number, from: number, to: number, dur: number, gain: number, type: OscillatorType) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(from * jitter, start);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, to), start + dur);
      const a = ctx.createGain();
      a.gain.setValueAtTime(0.0001, start);
      a.gain.exponentialRampToValueAtTime(gain, start + 0.004);
      a.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(a);
      a.connect(out);
      o.start(start);
      o.stop(start + dur + 0.02);
    };

    noise(t0, 0.025, g.crackGain, "highpass", g.crack, 0.8);
    noise(t0, g.bodyDur, g.bodyGain, "bandpass", g.body, 0.9);
    tone(t0, g.thump * 1.8, g.thump * 0.6, g.bodyDur * 1.3, g.thumpGain, "sine");
    if (dist < 12 && g.mech > 0) {
      noise(t0 + g.mech, 0.018, 0.08, "bandpass", 3600, 4);
      noise(t0 + g.mech + 0.045, 0.02, 0.06, "bandpass", 2600, 4);
    }
    if (kind === "shotgun" && dist < 12) {
      noise(t0 + 0.32, 0.03, 0.12, "bandpass", 1800, 3);
      noise(t0 + 0.42, 0.04, 0.14, "bandpass", 1200, 3);
    }
    noise(t0 + 0.02, g.tailDur * 0.5, g.tail * 0.35, "lowpass", 700, 0.5);
  }

  play(name: string, pan = 0): void {
    this.unlock();
    this.pan = pan;
    if (name === "headshot") {
      this.burst(1800, 0.06, "triangle", 0.09, 400);
      this.noiseHit(0.04, 0.12, 5200);
      return;
    }
    if (name === "kill") {
      this.burst(880, 0.09, "triangle", 0.08);
      window.setTimeout(() => this.burst(1320, 0.14, "triangle", 0.08), 70);
      this.noiseHit(0.08, 0.1, 300);
      return;
    }
    if (name === "hit") {
      this.burst(2400, 0.03, "square", 0.035);
      this.noiseHit(0.03, 0.08, 1800);
      return;
    }
    if (name === "shot") {
      this.noiseHit(0.09, 0.35, 1400);
      this.burst(180, 0.08, "square", 0.08, -80);
    } else if (name === "smg") {
      this.noiseHit(0.05, 0.22, 1800);
    } else if (name === "lmg") {
      this.noiseHit(0.08, 0.3, 900);
      this.burst(90, 0.07, "sawtooth", 0.05, -30);
    } else if (name === "rocket") {
      this.noiseHit(0.25, 0.4, 400);
      this.burst(220, 0.3, "sawtooth", 0.12, -140);
    } else if (name === "explode") {
      this.noiseHit(0.45, 0.55, 240);
      this.burst(70, 0.4, "triangle", 0.2, -40);
    } else if (name === "hit") {
      this.burst(520, 0.05, "square", 0.06);
    } else if (name === "hurt") {
      this.burst(140, 0.12, "sawtooth", 0.1, -60);
    } else if (name === "reload") {
      this.burst(880, 0.04, "square", 0.04);
      window.setTimeout(() => this.burst(640, 0.05, "square", 0.04), 140);
    } else if (name === "ui") {
      this.burst(660, 0.06, "triangle", 0.05);
    } else if (name === "capture") {
      this.burst(523, 0.12, "triangle", 0.07);
      window.setTimeout(() => this.burst(659, 0.14, "triangle", 0.07), 90);
    } else if (name === "skid") {
      this.noiseHit(0.12, 0.12, 700);
    } else if (name === "empty") {
      this.burst(1200, 0.03, "square", 0.03);
    } else if (name === "loco") {
      // Can crack — sharp aluminum snap
      this.noiseHit(0.07, 0.42, 3200);
      this.burst(2100, 0.05, "square", 0.07, -900);
      window.setTimeout(() => this.burst(1400, 0.04, "triangle", 0.05, -400), 35);
      // Guzzle — low wet swallows
      for (let i = 0; i < 5; i++) {
        window.setTimeout(() => {
          this.noiseHit(0.1, 0.16, 280 + i * 40);
          this.burst(90 + i * 18, 0.12, "sine", 0.09, 35);
        }, 120 + i * 110);
      }
    }
  }

  motor(speed: number, active: boolean): void {
    this.unlock();
    if (!this.ctx || !this.master) return;
    if (!active) {
      this.motorGain?.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      return;
    }
    if (!this.motorOsc) {
      this.motorOsc = this.ctx.createOscillator();
      this.motorOsc.type = "sawtooth";
      this.motorGain = this.ctx.createGain();
      this.motorGain.gain.value = 0.0001;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 420;
      this.motorOsc.connect(filter);
      filter.connect(this.motorGain);
      this.motorGain.connect(this.master);
      this.motorOsc.start();
    }
    const rate = 70 + Math.min(180, Math.abs(speed) * 0.35);
    this.motorOsc.frequency.setTargetAtTime(rate, this.ctx.currentTime, 0.08);
    this.motorGain?.gain.setTargetAtTime(Math.min(0.08, 0.02 + Math.abs(speed) / 8000), this.ctx.currentTime, 0.08);
  }
}

export const audio = new AudioBus();
