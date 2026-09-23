import type { Prefs } from "./settings";

const MUSIC_URL = "/sixfront/jesus.mp3";
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

  play(name: string, pan = 0): void {
    this.unlock();
    this.pan = pan;
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
