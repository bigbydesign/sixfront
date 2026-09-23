import {
  CLASSES,
  IDENTITIES,
  WORLD_H,
  WORLD_W,
  blockedAt,
  footMul,
  getMap,
  slotWeapon,
  stepInfantry,
  type ClassId,
  type MoveInput,
} from "@sixfront/shared";
import { audio } from "./audio";
import type { Session, SyncPlayer } from "./net";
import { bindDown, keys, loadPrefs, mouse } from "./settings";
import { serverMenuOpen, toggleServerMenu, updateHud } from "./ui";

/**
 * CSS 3D first-person view (cssQuake / PolyCSS style):
 * world faces are HTML elements with transform + pixel textures — no WebGL.
 * Approach inspired by https://github.com/layoutit/cssQuake — original code for Big Hersh House.
 */

const map = getMap();
/**
 * World px → CSS 3D units.
 * 48 world px ≈ 1 m; CSS meters stay large so faces aren't sub-pixel thin.
 */
const WORLD_PER_M = 48;
const CSS_PER_M = 36;
const S = CSS_PER_M / WORLD_PER_M;
const EYE = 1.15 * CSS_PER_M;
const BIKE_EYE = 0.1 * CSS_PER_M;
const WALL_H = 3.35 * CSS_PER_M;
const CEIL_H = 3.5 * CSS_PER_M;
const TEX_PX = 1.15 * CSS_PER_M;
const LOOK_SENS = 0.00215;
const PERSPECTIVE = 1050;
const PITCH_MAX = 0.48; // ~27° — grounded FPS, not free-cam
const WHEEL_COOLDOWN_MS = 180;

interface Ghost {
  x: number;
  y: number;
  samples: { t: number; x: number; y: number }[];
}

/** Quake-ish 64-color dithered tile (original procedural art — not Quake PAK). */
function texDataUrl(
  size: number,
  paint: (ctx: CanvasRenderingContext2D, n: (x: number, y: number) => number) => void,
): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const n = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  paint(ctx, n);
  return c.toDataURL("image/png");
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** House siding / drywall panels — Big Hersh House, not dungeon Quake. */
const STONE = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const board = Math.floor(y / 12);
      const seam = y % 12 < 1 ? 0.72 : 1;
      const v = (150 + n(x * 0.2, board) * 28 + n(x, y) * 12) * seam;
      ctx.fillStyle = rgb(v * 0.92, v * 0.88, v * 0.78);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Hardwood floor of the house. */
const FLOOR = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const plank = Math.floor(x / 10);
      const seam = x % 10 < 1 ? 0.55 : 1;
      const v = (110 + n(plank, y * 0.4) * 32 + n(x, y) * 14) * seam;
      ctx.fillStyle = rgb(v, v * 0.72, v * 0.42);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Yard grass — ground skirt so the house isn't a floating island. */
const GRASS = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const clump = n(Math.floor(x / 4), Math.floor(y / 4));
      const v = 72 + n(x, y) * 36 + clump * 22;
      ctx.fillStyle = rgb(v * 0.35, v * 0.78, v * 0.28);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Teal/white suburban siding — Nuketown house vibe. */
const SIDING = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const band = y > 28;
      const seam = y % 8 < 1;
      if (seam) {
        ctx.fillStyle = rgb(40, 50, 48);
      } else if (band) {
        const v = 118 + n(x, y) * 18;
        ctx.fillStyle = rgb(v * 0.35, v * 0.72, v * 0.68);
      } else {
        const v = 210 + n(x, y) * 18;
        ctx.fillStyle = rgb(v, v * 0.98, v * 0.94);
      }
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Asphalt street. */
const ASPHALT = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const line = (x > 30 && x < 34) ? 1 : 0;
      const v = 42 + n(x, y) * 22;
      ctx.fillStyle = line ? rgb(200, 180, 60) : rgb(v, v, v * 1.02);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Yellow school bus panels. */
const BUS = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const win = y > 18 && y < 40 && x % 14 > 3 && x % 14 < 11;
      const v = 190 + n(x, y) * 20;
      ctx.fillStyle = win ? rgb(40, 70, 90) : rgb(v, v * 0.78, v * 0.12);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Welcome billboard face. */
const WELCOME_SIGN = (() => {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#5a3a22";
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = "#3a2414";
  ctx.fillRect(12, 12, 488, 296);
  ctx.fillStyle = "#6a4428";
  ctx.fillRect(24, 24, 464, 272);
  ctx.fillStyle = "#f2efe6";
  ctx.font = "italic 36px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("Welcome to", 256, 100);
  ctx.font = "bold 52px Impact, Oswald, sans-serif";
  ctx.fillText("BIG HERSH'S", 256, 168);
  ctx.fillText("HOUSE", 256, 228);
  ctx.font = "22px monospace";
  ctx.fillStyle = "#d8c8a0";
  ctx.fillText("Population  01", 256, 275);
  // hazard strip
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? "#e8c020" : "#1a1a12";
    ctx.fillRect(40 + i * 27, 288, 27, 16);
  }
  return c.toDataURL("image/png");
})();

/** Dark riveted tech panel. */
const METAL = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const panel = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
      const rivet = ((x + 3) % 16 < 3 && (y + 3) % 16 < 3) ? 40 : 0;
      const edge = x % 16 < 1 || y % 16 < 1 ? 0.55 : 1;
      const v = (48 + panel * 10 + n(x * 0.3, y * 0.3) * 28 + rivet) * edge;
      ctx.fillStyle = rgb(v, v * 0.96, v * 0.9);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Dim ceiling slabs. */
const CEILING = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const tile = (Math.floor(x / 16) ^ Math.floor(y / 16)) & 1;
      const seam = x % 16 < 1 || y % 16 < 1 ? 0.7 : 1;
      const v = (168 + tile * 10 + n(x, y) * 14) * seam;
      ctx.fillStyle = rgb(v * 0.98, v * 0.94, v * 0.86);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

/** Warm wood crate. */
const WOOD = texDataUrl(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const plank = Math.floor(y / 10);
      const seam = y % 10 < 1 ? 0.5 : 1;
      const v = (88 + n(x * 0.6, plank) * 28 + n(x, y) * 12) * seam;
      ctx.fillStyle = rgb(v, v * 0.72, v * 0.38);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

function faceShade(rotY: number): number {
  const a = ((rotY % 360) + 360) % 360;
  if (a < 45 || a >= 315) return 0.78;   // -Z
  if (a >= 135 && a < 225) return 1.05;  // +Z
  if (a >= 45 && a < 135) return 0.62;   // +X
  return 0.88;                           // -X
}

function el(tag: string, className: string, parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

export class FrontView {
  session: Session;
  private root: HTMLElement;
  private view: HTMLElement;
  private cam: HTMLElement;
  private world: HTMLElement;
  private gun: HTMLElement;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private entities = new Map<string, HTMLElement>();
  private bikes = new Map<string, HTMLElement>();
  private projectiles = new Map<string, HTMLElement>();
  private ghosts = new Map<string, Ghost>();
  private pred = { x: 0, y: 0, aim: 0, acc: 0, ready: false };
  private yaw = 0;
  private pitch = 0;
  private seq = 1;
  private edges = { reload: false, ability: false, grenade: false, interact: false };
  private gunKick = 0;
  private gunSkin = "";
  private bob = 0;
  private escDown = false;
  private pointerLocked = false;
  private running = false;
  private raf = 0;
  private lastTs = 0;
  private wheelSlot = 0;
  private wheelPending = 0;
  private wheelAt = 0;
  private radarPings: { x: number; y: number; until: number }[] = [];
  private onMove = (e: MouseEvent) => this.handleLook(e);
  private onClick = () => this.requestLock();
  private onWheel = (e: WheelEvent) => this.handleWheel(e);
  private onLockChange = () => {
    const locked = document.pointerLockElement === this.view;
    if (this.pointerLocked && !locked) {
      // Soft-reset extreme look when unlocking so you don't stay in drone pitch
      this.pitch *= 0.35;
      if (Math.abs(this.pitch) < 0.04) this.pitch = 0;
    }
    this.pointerLocked = locked;
  };
  private onResize = () => this.resize();

  constructor(session: Session, parent: HTMLElement) {
    this.session = session;
    parent.replaceChildren();

    this.root = el("div", "css3d-root", parent);
    this.view = el("div", "css3d-view", this.root);
    this.view.tabIndex = 0;
    this.cam = el("div", "css3d-cam", this.view);
    this.world = el("div", "css3d-world", this.cam);
    this.gun = el("div", "css3d-gun skin-rifle", this.root);
    this.gun.innerHTML = `
      <div class="g-stock"></div>
      <div class="g-breech"></div>
      <div class="g-barrel"></div>
      <div class="g-hopper"></div>
      <div class="g-mag"></div>
      <div class="g-sight"></div>`;
    el("div", "css3d-cross", this.root);
    el("div", "css3d-vignette", this.root);
    el("div", "css3d-scan", this.root);

    this.overlay = document.createElement("canvas");
    this.overlay.className = "css3d-overlay";
    this.root.appendChild(this.overlay);
    const octx = this.overlay.getContext("2d");
    if (!octx) throw new Error("overlay");
    this.octx = octx;

    this.buildWorld();
    this.resize();

    window.addEventListener("resize", this.onResize);
    this.view.addEventListener("click", this.onClick);
    this.view.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMove);

    this.running = true;
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMove);
    this.view.removeEventListener("click", this.onClick);
    this.view.removeEventListener("wheel", this.onWheel);
    if (document.pointerLockElement === this.view) document.exitPointerLock();
    this.root.remove();
  }

  tracer(_x: number, _y: number, x2: number, y2: number): void {
    const flash = el("div", "css3d-flash", this.world);
    flash.style.transform = `translate3d(${x2 * S}px, ${-1.15 * CSS_PER_M}px, ${y2 * S}px)`;
    window.setTimeout(() => flash.remove(), 120);
  }

  radarPing(x: number, y: number): void {
    this.radarPings.push({ x, y, until: performance.now() + 1600 });
    if (this.radarPings.length > 32) this.radarPings.splice(0, this.radarPings.length - 32);
  }

  burst(x: number, y: number): void {
    this.tracer(x, y, x, y);
    this.radarPing(x, y);
  }

  onShotFeedback(): void {
    this.gunKick = 1;
    this.gun.classList.add("kick");
    window.setTimeout(() => this.gun.classList.remove("kick"), 80);
    const me = this.session.mine;
    if (!me) return;
    audio.play(me.classId === "heavy" ? "lmg" : me.classId === "medic" ? "smg" : "shot");
  }

  get midX(): number {
    const me = this.session.mine;
    return me ? this.origin(me).x : 0;
  }

  private buildWorld(): void {
    const fw = WORLD_W * S;
    const fh = WORLD_H * S;
    const tile = 12 * CSS_PER_M;
    const skirt = 48 * CSS_PER_M;

    // Ground tiles from surface map (grass / road / pads)
    for (let z = 0; z < fh; z += tile) {
      for (let x = 0; x < fw; x += tile) {
        const tw = Math.min(tile, fw - x);
        const td = Math.min(tile, fh - z);
        const wx = (x + tw / 2) / S;
        const wy = (z + td / 2) / S;
        const surf = map.surface[Math.floor(wy / map.cell) * map.cols + Math.floor(wx / map.cell)] ?? 0;
        const tex = surf === 2 ? ASPHALT : surf === 3 || surf === 1 ? FLOOR : GRASS;
        const shade = surf === 2 ? 1.0 : surf === 1 ? 1.05 : 1.02;
        this.addPlane(tw, td, x + tw / 2, 0, z + td / 2, -90, 0, tex, shade, "css3d-floor");
      }
    }

    for (let z = -skirt; z < fh + skirt; z += tile) {
      for (let x = -skirt; x < fw + skirt; x += tile) {
        if (x >= 0 && x + tile <= fw && z >= 0 && z + tile <= fh) continue;
        const tw = Math.min(tile, fw + skirt - x);
        const td = Math.min(tile, fh + skirt - z);
        if (tw < 2 || td < 2) continue;
        this.addPlane(tw, td, x + tw / 2, 0.5, z + td / 2, -90, 0, GRASS, 1.0, "css3d-floor");
      }
    }

    // Buildings by kind (Nuketown houses, bus, fence, attic)
    for (const b of map.buildings) {
      const kind = b.kind;
      let h = WALL_H * 0.85;
      let tex = SIDING;
      let roof = true;
      let shade = 1;
      if (kind === "fence") {
        h = WALL_H * 0.42;
        tex = METAL;
        roof = false;
        shade = 0.85;
      } else if (kind === "bus") {
        h = WALL_H * 0.7;
        tex = BUS;
        roof = true;
        shade = 1.05;
      } else if (kind === "attic") {
        h = CEIL_H * 1.15;
        tex = SIDING;
        roof = true;
        shade = 1.08;
      } else if (kind === "garage") {
        h = WALL_H * 0.72;
        tex = SIDING;
        roof = true;
      } else if (kind === "house") {
        h = WALL_H * 0.95;
        tex = SIDING;
        roof = true;
      }
      this.addBox(b.x * S, b.y * S, b.w * S, b.h * S, h, tex, roof, shade);
    }

    for (const d of map.decor) {
      if (d.kind === "crate") {
        const size = Math.max(0.4 * CSS_PER_M, Math.min(d.w, d.h) * S * 0.95);
        this.addBox(d.x * S - size / 2, d.y * S - size / 2, size, size, size * 0.95, WOOD, true);
      } else if (d.kind === "barrier") {
        const w = Math.max(0.5 * CSS_PER_M, d.w * S);
        const depth = Math.max(0.25 * CSS_PER_M, d.h * S);
        this.addBox(d.x * S - w / 2, d.y * S - depth / 2, w, depth, 0.55 * CSS_PER_M, STONE, true, 0.9);
      } else if (d.kind === "car") {
        const w = Math.max(0.8 * CSS_PER_M, d.w * S);
        const depth = Math.max(0.5 * CSS_PER_M, d.h * S);
        this.addBox(d.x * S - w / 2, d.y * S - depth / 2, w, depth, 0.7 * CSS_PER_M, METAL, true, 0.95);
      } else if (d.kind === "sign") {
        this.addWelcomeSign(d.x * S, d.y * S, d.w * S);
      } else if (d.kind === "tower") {
        const size = 0.9 * CSS_PER_M;
        this.addBox(d.x * S - size / 2, d.y * S - size / 2, size, size, CEIL_H * 0.95, METAL, true, 0.75);
      }
    }
  }

  private addWelcomeSign(x: number, z: number, width: number): void {
    const w = Math.max(width, 4.5 * CSS_PER_M);
    const h = 2.8 * CSS_PER_M;
    const postH = 2.2 * CSS_PER_M;
    // Posts
    this.addBox(x - w * 0.45, z - 0.15 * CSS_PER_M, 0.25 * CSS_PER_M, 0.25 * CSS_PER_M, postH, STONE, false, 0.9);
    this.addBox(x + w * 0.45 - 0.25 * CSS_PER_M, z - 0.15 * CSS_PER_M, 0.25 * CSS_PER_M, 0.25 * CSS_PER_M, postH, STONE, false, 0.9);
    // Billboard face (toward street / -Z-ish — rotY 0 faces -Z in our convention)
    const face = el("div", "css3d-face css3d-sign", this.world);
    face.style.width = `${w}px`;
    face.style.height = `${h}px`;
    face.style.backgroundImage = `url(${WELCOME_SIGN})`;
    face.style.backgroundSize = "100% 100%";
    face.style.backgroundColor = "#5a3a22";
    face.style.transform =
      `translate3d(${x - w / 2}px, ${-postH - h * 0.15}px, ${z}px) rotateY(0deg)`;
    // Back face
    const back = el("div", "css3d-face css3d-sign", this.world);
    back.style.width = `${w}px`;
    back.style.height = `${h}px`;
    back.style.background = "#3a2414";
    back.style.transform =
      `translate3d(${x - w / 2}px, ${-postH - h * 0.15}px, ${z + 4}px) rotateY(180deg)`;
  }

  /** Horizontal plane (floor / ceiling). rotX  -90 = floor up, +90 = ceiling down. */
  private addPlane(
    w: number, d: number, tx: number, ty: number, tz: number,
    rotX: number, rotY: number, tex: string, shade: number, className: string,
  ): void {
    const face = el("div", className, this.world);
    face.style.width = `${w}px`;
    face.style.height = `${d}px`;
    face.style.backgroundImage = `url(${tex})`;
    face.style.backgroundSize = `${TEX_PX}px ${TEX_PX}px`;
    face.style.filter = `brightness(${shade})`;
    face.style.transform =
      `translate3d(${tx}px, ${ty}px, ${tz}px) rotateX(${rotX}deg) rotateY(${rotY}deg) translate(-50%, -50%)`;
  }

  /** Axis-aligned brush: 4 walls + optional roof top. */
  private addBox(
    x: number, z: number, w: number, d: number, h: number,
    tex: string, roof = false, shadeMul = 1,
  ): void {
    // Skip degenerate faces that collapse to a line
    if (w < 1 || d < 1 || h < 1) return;
    const faces: Array<{ width: number; height: number; tx: number; ty: number; tz: number; rotY: number }> = [
      { width: w, height: h, tx: x + w / 2, ty: -h / 2, tz: z, rotY: 0 },
      { width: w, height: h, tx: x + w / 2, ty: -h / 2, tz: z + d, rotY: 180 },
      { width: d, height: h, tx: x, ty: -h / 2, tz: z + d / 2, rotY: -90 },
      { width: d, height: h, tx: x + w, ty: -h / 2, tz: z + d / 2, rotY: 90 },
    ];
    for (const f of faces) {
      if (f.width < 1.5) continue;
      const face = el("div", "css3d-face", this.world);
      face.style.width = `${f.width}px`;
      face.style.height = `${f.height}px`;
      face.style.backgroundImage = `url(${tex})`;
      face.style.backgroundSize = `${TEX_PX}px ${TEX_PX}px`;
      face.style.filter = `brightness(${faceShade(f.rotY) * shadeMul})`;
      face.style.transform =
        `translate3d(${f.tx - f.width / 2}px, ${f.ty}px, ${f.tz}px) rotateY(${f.rotY}deg)`;
    }
    if (roof && w > 4 && d > 4) {
      const top = el("div", "css3d-face css3d-roof", this.world);
      top.style.width = `${w}px`;
      top.style.height = `${d}px`;
      top.style.backgroundImage = `url(${CEILING})`;
      top.style.backgroundSize = `${TEX_PX}px ${TEX_PX}px`;
      top.style.filter = `brightness(${0.45 * shadeMul})`;
      top.style.transform =
        `translate3d(${x + w / 2}px, ${-h}px, ${z + d / 2}px) rotateX(90deg) translate(-50%, -50%)`;
    }
  }

  private requestLock(): void {
    if (serverMenuOpen()) return;
    if (!this.pointerLocked) void this.view.requestPointerLock();
  }

  private handleLook(event: MouseEvent): void {
    if (!this.pointerLocked || serverMenuOpen()) return;
    this.yaw += event.movementX * LOOK_SENS;
    this.pitch -= event.movementY * LOOK_SENS;
    this.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.pitch));
  }

  private resize(): void {
    const parent = this.root.parentElement;
    const w = Math.max(320, parent?.clientWidth || window.innerWidth);
    const h = Math.max(240, parent?.clientHeight || window.innerHeight);
    this.view.style.perspective = `${PERSPECTIVE}px`;
    this.overlay.width = w;
    this.overlay.height = h;
  }

  private frame(ts: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.tick(dt);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private tick(dt: number): void {
    const state = this.session.state;
    const me = this.session.mine;
    if (!state || !me) return;
    if (me.alive !== 1) this.pred.ready = false;
    const typing =
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLSelectElement;
    const esc = keys.has("Escape");
    if (esc && !this.escDown) {
      if (this.pointerLocked) document.exitPointerLock();
      toggleServerMenu(this.session);
    }
    this.escDown = esc;
    const input = this.readInput(me, typing || serverMenuOpen());
    if (state.phase === "play" && me.alive === 1) {
      if (serverMenuOpen()) {
        this.session.input({
          ...input, fire: false, mx: 0, my: 0, throttle: 0, steer: 0, brake: false, boost: false,
        });
      } else this.session.input(input);
    }
    this.predict(me, dt, input);
    if (me.alive === 1 && mouse.left) this.gunKick = Math.max(this.gunKick, 0.45);
    this.gunKick = Math.max(0, this.gunKick - dt * 7);
    const moving = Math.hypot(input.mx, input.my) > 0.1 || Math.abs(input.throttle) > 0.1;
    this.bob += dt * (moving ? 9 : 1.4);
    this.syncEntities(me);
    this.updateCamera(me);
    this.syncGun(me);
    this.drawOverlay(me);
    updateHud(this.session, {
      prompt: this.prompt(me),
      pause: keys.has("Escape"),
      score: bindDown(loadPrefs().binds.score),
    });
    audio.motor(this.ridden(me)?.speed ?? 0, me.seat === 0 && me.alive === 1);
  }

  private updateCamera(me: SyncPlayer): void {
    const eye = this.origin(me);
    if (me.seat === 0 && me.vehicleId) {
      const bike = this.session.state?.vehicles.get(me.vehicleId);
      if (bike) this.yaw = bike.heading + Math.PI / 2;
    }
    const pitch = me.seat === 0 ? this.pitch * 0.35 : this.pitch;
    const bobY = Math.sin(this.bob) * (me.seat >= 0 ? 0.02 : 0.05) * CSS_PER_M;
    const eyeY = EYE + bobY + (me.seat >= 0 ? BIKE_EYE : 0);
    // Camera: rotate view, then world is at identity; we counter-translate world.
    // CSS Y is down, so player height uses negative Y.
    const degY = (this.yaw * 180) / Math.PI;
    const degX = (pitch * 180) / Math.PI;
    this.cam.style.transform = `rotateX(${degX}deg) rotateY(${-degY}deg)`;
    this.world.style.transform =
      `translate3d(${-eye.x * S}px, ${eyeY}px, ${-eye.y * S}px)`;
  }

  private syncGun(me: SyncPlayer): void {
    const seated = !!me.vehicleId;
    const def = CLASSES[me.classId as ClassId];
    const slotted = def ? slotWeapon(def, me.weaponSlot || 1) : null;
    const skin =
      slotted === "barricade" ? "barricade"
        : slotted === "rocket" ? "rocket"
          : slotted === "pistol" ? "pistol"
            : slotted === "lmg" ? "lmg"
              : slotted === "smg" ? "smg"
                : slotted === "shotgun" ? "shotgun"
                  : "rifle";
    if (skin !== this.gunSkin) {
      this.gunSkin = skin;
      this.gun.className = `css3d-gun skin-${skin}`;
    }
    // Quake-style stub: large, lower-center/right, slight perspective tilt into crosshair
    const bobX = Math.cos(this.bob * 0.5) * 6;
    const bobY = 10 + this.gunKick * 28 + Math.sin(this.bob) * 4;
    this.gun.style.transform =
      `perspective(420px) rotateY(-18deg) rotateX(6deg) translate(${bobX}px, ${bobY}px) rotate(${-4 + this.gunKick * -3}deg)`;
    this.gun.style.opacity = me.alive === 1 && !seated ? "1" : "0";
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.pointerLocked || serverMenuOpen()) return;
    event.preventDefault();
    const me = this.session.mine;
    if (!me || me.alive !== 1) return;
    const def = CLASSES[me.classId as ClassId];
    if (!def) return;
    const slots: number[] = [];
    if (def.primary) slots.push(1);
    if (def.secondary) slots.push(2);
    if (def.special) slots.push(3);
    if (slots.length < 2) return;

    const now = performance.now();
    this.wheelPending += event.deltaY;
    if (now - this.wheelAt < WHEEL_COOLDOWN_MS) return;
    if (Math.abs(this.wheelPending) < 20) return;

    const dir = this.wheelPending > 0 ? 1 : -1;
    this.wheelPending = 0;
    this.wheelAt = now;
    const from = this.wheelSlot || me.weaponSlot || 1;
    const cur = slots.indexOf(from);
    const next = slots[(Math.max(0, cur) + dir + slots.length) % slots.length];
    this.wheelSlot = next;
  }

  /** W into screen — from camera yaw (CSS rotateY uses opposite sign of Three). */
  private lookVectors(): { fx: number; fy: number; rx: number; ry: number; aim: number } {
    const fx = Math.sin(this.yaw);
    const fy = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const ry = Math.sin(this.yaw);
    return { fx, fy, rx, ry, aim: Math.atan2(fy, fx) };
  }

  private readInput(me: SyncPlayer, typing: boolean): MoveInput {
    const prefs = loadPrefs();
    const b = prefs.binds;
    const down = (code: string) => !typing && keys.has(code);
    const origin = this.origin(me);
    const look = this.lookVectors();
    const aim = me.seat === 0 && me.vehicleId
      ? (this.session.state?.vehicles.get(me.vehicleId)?.heading ?? look.aim)
      : look.aim;
    const range = 1400;
    const ax = origin.x + Math.cos(aim) * range;
    const ay = origin.y + Math.sin(aim) * range;
    let mx = 0;
    let my = 0;
    if (me.seat < 0) {
      if (down(b.up) || down("ArrowUp")) { mx += look.fx; my += look.fy; }
      if (down(b.down) || down("ArrowDown")) { mx -= look.fx; my -= look.fy; }
      if (down(b.right) || down("ArrowRight")) { mx += look.rx; my += look.ry; }
      if (down(b.left) || down("ArrowLeft")) { mx -= look.rx; my -= look.ry; }
      const mag = Math.hypot(mx, my);
      if (mag > 1) { mx /= mag; my /= mag; }
    }
    const press = (code: string, prev: boolean) => {
      const now = down(code);
      return { now, edge: now && !prev };
    };
    const reload = press(b.reload, this.edges.reload);
    const ability = press(b.ability, this.edges.ability);
    const grenade = press(b.grenade, this.edges.grenade);
    const interact = press(b.interact, this.edges.interact);
    this.edges = { reload: reload.now, ability: ability.now, grenade: grenade.now, interact: interact.now };
    let slot = me.weaponSlot;
    if (down(b.slot1)) slot = 1;
    if (down(b.slot2)) slot = 2;
    if (down(b.slot3)) slot = 3;
    if (this.wheelSlot) {
      slot = this.wheelSlot;
      this.wheelSlot = 0;
    }
    const throttle = (down(b.up) || down("ArrowUp") ? 1 : 0) + (down(b.down) || down("ArrowDown") ? -1 : 0);
    const steer = (down(b.right) || down("ArrowRight") ? 1 : 0) + (down(b.left) || down("ArrowLeft") ? -1 : 0);
    return {
      seq: this.seq++,
      mx, my, aim, ax, ay, throttle, steer,
      fire: !typing && mouse.left,
      reload: reload.edge, ability: ability.edge, grenade: grenade.edge, interact: interact.edge,
      sprint: down(b.sprint), boost: down(b.sprint), brake: down(b.brake), ads: mouse.right, slot,
      pitch: 0, jumpZ: 0, floorZ: 0, crouch: false,
    };
  }

  private origin(me: SyncPlayer): { x: number; y: number } {
    if (me.seat >= 0 && me.vehicleId) {
      const bike = this.session.state?.vehicles.get(me.vehicleId);
      if (bike) return { x: bike.x, y: bike.y };
    }
    return this.pred.ready ? { x: this.pred.x, y: this.pred.y } : { x: me.x, y: me.y };
  }

  private predict(me: SyncPlayer, dt: number, input: MoveInput): void {
    const def = CLASSES[me.classId as keyof typeof CLASSES] ?? CLASSES.rifleman;
    if (me.alive === 1 && me.seat < 0) {
      if (!this.pred.ready) {
        this.pred.x = me.x;
        this.pred.y = me.y;
        this.pred.aim = input.aim;
        this.pred.ready = true;
        this.yaw = input.aim + Math.PI / 2;
      }
      const dx = me.x - this.pred.x;
      const dy = me.y - this.pred.y;
      if (dx * dx + dy * dy > 140 * 140) {
        this.pred.x = me.x;
        this.pred.y = me.y;
      } else if (dx * dx + dy * dy > 18 * 18) {
        this.pred.x += dx * 0.2;
        this.pred.y += dy * 0.2;
      }
      let speed = def.speed;
      if (input.sprint) speed *= 1.28;
      if (input.ads) speed *= 0.74;
      this.pred.acc += dt;
      const env = {
        dt: 0.05,
        solids: map.solids,
        blocked: (x: number, y: number) => blockedAt(map, x, y),
        footMul: (x: number, y: number) => footMul(map, x, y),
        bikeMul: () => 1,
      };
      while (this.pred.acc >= 0.05) {
        this.pred.acc -= 0.05;
        const body = { x: this.pred.x, y: this.pred.y, aim: input.aim };
        stepInfantry(body, input, speed, env);
        this.pred.x = body.x;
        this.pred.y = body.y;
        this.pred.aim = input.aim;
      }
    } else {
      this.pred.ready = false;
      this.pred.x = me.x;
      this.pred.y = me.y;
      this.pred.aim = input.aim;
    }
  }

  private syncEntities(me: SyncPlayer): void {
    const seen = new Set<string>();
    const eye = this.origin(me);
    this.session.state?.players.forEach((p, id) => {
      if (p.id === me.id || p.alive === 0) return;
      if (!this.visible(me, p) && !p.blip) return;
      seen.add(id);
      let ghost = this.ghosts.get(id);
      if (!ghost) {
        ghost = { x: p.x, y: p.y, samples: [] };
        this.ghosts.set(id, ghost);
      }
      const now = performance.now();
      const last = ghost.samples[ghost.samples.length - 1];
      if (!last || now - last.t > 40) {
        ghost.samples.push({ t: now, x: p.x, y: p.y });
        if (ghost.samples.length > 8) ghost.samples.shift();
      }
      const sample = this.sample(ghost);
      let node = this.entities.get(id);
      if (!node) {
        node = el("div", "css3d-sprite soldier", this.world);
        node.innerHTML = `<div class="spr-body"></div><div class="spr-head"></div><div class="spr-label"></div>`;
        this.entities.set(id, node);
      }
      const label = node.querySelector(".spr-label") as HTMLElement;
      label.textContent = p.identity || p.name;
      const dx = sample.x - eye.x;
      const dy = sample.y - eye.y;
      const dist = Math.hypot(dx, dy);
      const scale = Math.max(0.45, Math.min(2.2, (2.2 * CSS_PER_M) / Math.max(CSS_PER_M, dist * S)));
      // Billboard: face the camera yaw.
      const degY = (-this.yaw * 180) / Math.PI;
      const stand = (p.alive === 2 ? 0.9 : 1.55) * CSS_PER_M;
      node.style.transform =
        `translate3d(${sample.x * S}px, ${-stand}px, ${sample.y * S}px) rotateY(${-degY}deg) scale(${scale})`;
      node.style.opacity = this.visible(me, p) ? "1" : "0.55";
      (node.querySelector(".spr-body") as HTMLElement).style.background =
        p.blip && !this.visible(me, p) ? "#ffb020" : "#b05040";
    });
    for (const [id, node] of this.entities) {
      if (!seen.has(id)) {
        node.remove();
        this.entities.delete(id);
        this.ghosts.delete(id);
      }
    }

    const bikeSeen = new Set<string>();
    this.session.state?.vehicles.forEach((bike, id) => {
      if (!bike.alive) return;
      if (me.seat === 0 && me.vehicleId === id) return;
      bikeSeen.add(id);
      let node = this.bikes.get(id);
      if (!node) {
        node = el("div", "css3d-sprite bike", this.world);
        node.innerHTML = `<div class="spr-bike"></div>`;
        this.bikes.set(id, node);
      }
      const degY = (-this.yaw * 180) / Math.PI;
      node.style.transform =
        `translate3d(${bike.x * S}px, ${-0.55 * CSS_PER_M}px, ${bike.y * S}px) rotateY(${-degY}deg)`;
    });
    for (const [id, node] of this.bikes) {
      if (!bikeSeen.has(id)) {
        node.remove();
        this.bikes.delete(id);
      }
    }

    const projSeen = new Set<string>();
    this.session.state?.projectiles.forEach((shot, id) => {
      projSeen.add(id);
      let node = this.projectiles.get(id);
      const hotdog = shot.kind === "grenade" || shot.weapon === "grenade";
      if (!node) {
        node = el("div", hotdog ? "css3d-hotdog" : "css3d-bolt", this.world);
        if (hotdog) {
          node.innerHTML = `<div class="dog-bun"></div><div class="dog-meat"></div><div class="dog-mustard"></div>`;
        }
        this.projectiles.set(id, node);
      }
      const z = Math.max(0.2, (shot.z || 12) / 48) * CSS_PER_M;
      const degY = (-this.yaw * 180) / Math.PI;
      const spin = hotdog ? ((performance.now() / 8) % 360) : 0;
      node.style.transform =
        `translate3d(${shot.x * S}px, ${-z}px, ${shot.y * S}px) rotateY(${degY}deg) rotateZ(${spin}deg)`;
    });
    for (const [id, node] of this.projectiles) {
      if (!projSeen.has(id)) {
        node.remove();
        this.projectiles.delete(id);
      }
    }
  }

  private sample(ghost: Ghost): { x: number; y: number } {
    const when = performance.now() - 90;
    const list = ghost.samples;
    if (list.length < 2) return list[0] ?? ghost;
    if (when <= list[0].t) return list[0];
    for (let i = 1; i < list.length; i++) {
      if (when <= list[i].t) {
        const a = list[i - 1];
        const b = list[i];
        const u = (when - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      }
    }
    return list[list.length - 1];
  }

  private visible(me: SyncPlayer, other: SyncPlayer): boolean {
    if (other.id === me.id) return true;
    if (me.team === other.team && this.session.state?.teamMode !== "ffa") return true;
    const bit = 1 << Math.max(0, IDENTITIES.indexOf(me.identity as typeof IDENTITIES[number]));
    return (other.seenMask & bit) !== 0;
  }

  private drawOverlay(me: SyncPlayer): void {
    const w = this.overlay.width;
    const h = this.overlay.height;
    const ctx = this.octx;
    ctx.clearRect(0, 0, w, h);
    const prefs = loadPrefs();
    const big = keys.has(prefs.binds.map);
    const mw = big ? Math.min(480, w * 0.4) : Math.min(190, w * 0.18);
    const mh = big ? Math.min(340, h * 0.4) : Math.min(130, h * 0.16);
    const pad = 14;
    const mx = w - mw - pad;
    const my = pad;
    ctx.fillStyle = "rgba(10,8,6,0.82)";
    ctx.fillRect(mx, my, mw, mh);
    const sx = mw / WORLD_W;
    const sy = mh / WORLD_H;
    const now = performance.now();
    this.radarPings = this.radarPings.filter((p) => p.until > now);
    for (const ping of this.radarPings) {
      const life = (ping.until - now) / 1600;
      ctx.strokeStyle = `rgba(255,144,32,${life})`;
      ctx.beginPath();
      ctx.arc(mx + ping.x * sx, my + ping.y * sy, 4 + (1 - life) * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    const eye = this.origin(me);
    const look = this.lookVectors();
    ctx.fillStyle = "#f2d48a";
    ctx.beginPath();
    ctx.arc(mx + eye.x * sx, my + eye.y * sy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f2d48a";
    ctx.beginPath();
    ctx.moveTo(mx + eye.x * sx, my + eye.y * sy);
    ctx.lineTo(mx + (eye.x + look.fx * 220) * sx, my + (eye.y + look.fy * 220) * sy);
    ctx.stroke();
    this.session.state?.players.forEach((p) => {
      if (p.id === me.id || p.alive === 0) return;
      if (!this.visible(me, p) && !p.blip) return;
      ctx.fillStyle = p.blip && !this.visible(me, p) ? "#ffb020" : "#e07060";
      ctx.beginPath();
      ctx.arc(mx + p.x * sx, my + p.y * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    // Compact look hint — keep clear of HUD + interaction prompt.
    const hasPrompt = !!document.getElementById("prompt")?.textContent?.trim();
    if (!this.pointerLocked && !serverMenuOpen() && !hasPrompt) {
      const label = "Click to look";
      ctx.font = `600 ${Math.max(13, Math.min(16, w * 0.011))}px Oswald, Impact, sans-serif`;
      ctx.textAlign = "center";
      const tw = ctx.measureText(label).width;
      const padX = 16;
      const bw = tw + padX * 2;
      const bh = 28;
      const bx = (w - bw) / 2;
      const by = Math.max(72, h * 0.42);
      ctx.fillStyle = "rgba(8,10,6,0.72)";
      ctx.beginPath();
      const r = 14;
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
      ctx.arcTo(bx, by + bh, bx, by, r);
      ctx.arcTo(bx, by, bx + bw, by, r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#efe6d2";
      ctx.fillText(label, w * 0.5, by + 19);
    }
  }

  private prompt(me: SyncPlayer): string {
    if (me.alive !== 1) return "";
    if (me.seat >= 0) return "E  DISMOUNT";
    let near = false;
    this.session.state?.vehicles.forEach((bike) => {
      if (!bike.alive) return;
      if ((bike.x - me.x) ** 2 + (bike.y - me.y) ** 2 < 56 * 56) near = true;
    });
    return near ? "E  RIDE EBIKE" : "";
  }

  private ridden(me: SyncPlayer) {
    if (!me.vehicleId) return undefined;
    return this.session.state?.vehicles.get(me.vehicleId);
  }
}
