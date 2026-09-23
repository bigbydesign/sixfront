import {
  CLASSES,
  IDENTITIES,
  WORLD_H,
  WORLD_W,
  blockedAt,
  footMul,
  getMap,
  stepInfantry,
  type MoveInput,
} from "@sixfront/shared";
import { audio } from "./audio";
import type { Session, SyncPlayer } from "./net";
import { bindDown, keys, loadPrefs, mouse } from "./settings";
import { serverMenuOpen, toggleServerMenu, updateHud } from "./ui";

const map = getMap();
const FOV = Math.PI * 0.66;
const EYE = 0.52;
const WALL_H = 1.22;
const TILE = map.cell;
const COLS = map.cols;
const ROWS = map.rows;
const MAX_STEPS = 160;
const FOG = TILE * 95;
const RAYS = 320;

const WALL_COLORS = [
  [92, 78, 58],
  [110, 92, 68],
  [72, 86, 78],
  [120, 70, 52],
  [64, 64, 72],
  [88, 96, 70],
];

interface Ghost {
  x: number;
  y: number;
  aim: number;
  samples: { t: number; x: number; y: number; aim: number }[];
}

interface SpriteDraw {
  x: number;
  dist: number;
  screenX: number;
  size: number;
  kind: "player" | "bike" | "crate" | "flash";
  color: string;
  label?: string;
  alpha: number;
}

export class FrontView {
  session: Session;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private walls: Uint8Array;
  private depth!: Float32Array;
  private imageData!: ImageData;
  private view = { x: 0, y: 0, yaw: 0, init: false };
  private ghosts = new Map<string, Ghost>();
  private pred = { x: 0, y: 0, aim: 0, acc: 0, ready: false };
  private yaw = 0;
  private seq = 1;
  private edges = { reload: false, ability: false, grenade: false, interact: false };
  private gunKick = 0;
  private bob = 0;
  private escDown = false;
  private pointerLocked = false;
  private running = false;
  private raf = 0;
  private lastTs = 0;
  private radarPings: { x: number; y: number; until: number }[] = [];
  private flashes: { x: number; y: number; until: number }[] = [];
  private onMove = (e: MouseEvent) => this.handleLook(e);
  private onClick = () => this.requestLock();
  private onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  constructor(session: Session, parent: HTMLElement) {
    this.session = session;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "wolf-view";
    this.canvas.tabIndex = 0;
    parent.replaceChildren(this.canvas);
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.walls = this.buildWallGrid();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("click", this.onClick);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMove);
    this.running = true;
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMove);
    this.canvas.removeEventListener("click", this.onClick);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.canvas.remove();
  }

  tracer(x: number, y: number, x2: number, y2: number): void {
    this.flashes.push({ x: (x + x2) * 0.5, y: (y + y2) * 0.5, until: performance.now() + 90 });
    this.flashes.push({ x: x2, y: y2, until: performance.now() + 120 });
  }

  radarPing(x: number, y: number): void {
    this.radarPings.push({ x, y, until: performance.now() + 1600 });
    if (this.radarPings.length > 32) this.radarPings.splice(0, this.radarPings.length - 32);
  }

  burst(x: number, y: number): void {
    this.flashes.push({ x, y, until: performance.now() + 280 });
    this.radarPing(x, y);
  }

  onShotFeedback(): void {
    this.gunKick = 1;
    const me = this.session.mine;
    if (!me) return;
    audio.play(me.classId === "heavy" ? "lmg" : me.classId === "medic" ? "smg" : "shot");
  }

  get midX(): number {
    const me = this.session.mine;
    return me ? this.origin(me).x : 0;
  }

  private requestLock(): void {
    if (serverMenuOpen()) return;
    if (!this.pointerLocked) void this.canvas.requestPointerLock();
  }

  private handleLook(event: MouseEvent): void {
    if (!this.pointerLocked || serverMenuOpen()) return;
    this.yaw += event.movementX * 0.002;
    while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const cssW = Math.max(320, parent?.clientWidth || window.innerWidth);
    const cssH = Math.max(240, parent?.clientHeight || window.innerHeight);
    const aspect = cssW / cssH;
    let rw = Math.min(RAYS, Math.floor(cssW * 0.55));
    rw = Math.max(280, rw - (rw % 2));
    let rh = Math.floor(rw / aspect);
    rh = Math.max(160, rh - (rh % 2));
    this.canvas.width = rw;
    this.canvas.height = rh;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.depth = new Float32Array(RAYS);
    this.imageData = this.ctx.createImageData(rw, rh);
  }

  private buildWallGrid(): Uint8Array {
    const grid = new Uint8Array(COLS * ROWS);
    for (let c = 0; c < COLS; c++) {
      grid[c] = 5;
      grid[(ROWS - 1) * COLS + c] = 5;
    }
    for (let r = 0; r < ROWS; r++) {
      grid[r * COLS] = 5;
      grid[r * COLS + (COLS - 1)] = 5;
    }
    for (const solid of map.solids) {
      const c0 = Math.max(0, Math.floor(solid.x / TILE));
      const r0 = Math.max(0, Math.floor(solid.y / TILE));
      const c1 = Math.min(COLS - 1, Math.floor((solid.x + solid.w - 0.01) / TILE));
      const r1 = Math.min(ROWS - 1, Math.floor((solid.y + solid.h - 0.01) / TILE));
      let tint = 1;
      for (const b of map.buildings) {
        if (Math.abs(b.x - solid.x) < 2 && Math.abs(b.y - solid.y) < 2) {
          tint = b.kind === "warehouse" ? 4 : b.kind === "shed" ? 3 : b.variant ? 5 : 2;
          break;
        }
      }
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) grid[r * COLS + c] = tint;
      }
    }
    return grid;
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
    if (me.alive !== 1) this.view.init = false;
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
    if (me.alive === 1 && mouse.left) this.gunKick = Math.max(this.gunKick, 0.55);
    this.gunKick = Math.max(0, this.gunKick - dt * 7);
    const moving = Math.hypot(input.mx, input.my) > 0.1 || Math.abs(input.throttle) > 0.1;
    this.bob += dt * (moving ? 10 : 2);
    this.render(me, state.night === 1);
    updateHud(this.session, {
      prompt: this.prompt(me),
      pause: keys.has("Escape"),
      score: bindDown(loadPrefs().binds.score),
    });
    audio.motor(this.ridden(me)?.speed ?? 0, me.seat === 0 && me.alive === 1);
  }

  private readInput(me: SyncPlayer, typing: boolean): MoveInput {
    const prefs = loadPrefs();
    const b = prefs.binds;
    const down = (code: string) => !typing && keys.has(code);
    const origin = this.origin(me);
    const aim = me.seat === 0 && me.vehicleId
      ? (this.session.state?.vehicles.get(me.vehicleId)?.heading ?? this.yaw)
      : this.yaw;
    const range = 1400;
    const ax = origin.x + Math.cos(aim) * range;
    const ay = origin.y + Math.sin(aim) * range;
    let mx = 0;
    let my = 0;
    if (me.seat < 0) {
      const fx = Math.cos(aim);
      const fy = Math.sin(aim);
      const rx = Math.sin(aim);
      const ry = -Math.cos(aim);
      if (down(b.up) || down("ArrowUp")) { mx += fx; my += fy; }
      if (down(b.down) || down("ArrowDown")) { mx -= fx; my -= fy; }
      if (down(b.left) || down("ArrowLeft")) { mx -= rx; my -= ry; }
      if (down(b.right) || down("ArrowRight")) { mx += rx; my += ry; }
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
    const throttle = (down(b.up) || down("ArrowUp") ? 1 : 0) + (down(b.down) || down("ArrowDown") ? -1 : 0);
    const steer = (down(b.right) || down("ArrowRight") ? 1 : 0) + (down(b.left) || down("ArrowLeft") ? -1 : 0);
    return {
      seq: this.seq++,
      mx, my, aim,
      ax, ay,
      throttle, steer,
      fire: !typing && mouse.left,
      reload: reload.edge,
      ability: ability.edge,
      grenade: grenade.edge,
      interact: interact.edge,
      sprint: down(b.sprint),
      boost: down(b.sprint),
      brake: down(b.brake),
      ads: mouse.right,
      slot,
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
        this.pred.aim = this.yaw;
        this.pred.ready = true;
        this.view.x = me.x;
        this.view.y = me.y;
        this.view.yaw = this.yaw;
        this.view.init = true;
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
        const body = { x: this.pred.x, y: this.pred.y, aim: this.yaw };
        stepInfantry(body, input, speed, env);
        this.pred.x = body.x;
        this.pred.y = body.y;
        this.pred.aim = this.yaw;
      }
    } else {
      this.pred.ready = false;
      this.pred.x = me.x;
      this.pred.y = me.y;
      this.pred.aim = this.yaw;
      if (me.seat === 0 && me.vehicleId) {
        const bike = this.session.state?.vehicles.get(me.vehicleId);
        if (bike) this.yaw = bike.heading;
      }
    }
  }

  private render(me: SyncPlayer, night: boolean): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    const eye = this.origin(me);
    const yawTarget = me.seat === 0 && me.vehicleId
      ? (this.session.state?.vehicles.get(me.vehicleId)?.heading ?? this.yaw)
      : this.yaw;
    if (!this.view.init) {
      this.view.x = eye.x;
      this.view.y = eye.y;
      this.view.yaw = yawTarget;
      this.view.init = true;
    }
    this.view.x += (eye.x - this.view.x) * 0.42;
    this.view.y += (eye.y - this.view.y) * 0.42;
    let dy = yawTarget - this.view.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.view.yaw += dy * 0.55;
    const castX = this.view.x;
    const castY = this.view.y;
    const yaw = this.view.yaw;
    const zBuf = this.depth;
    zBuf.fill(1e9);
    const horizon = Math.floor(h * EYE);
    const proj = (w * 0.5) / Math.tan(FOV * 0.5);
    const px = this.imageData.data;
    const skyTop = night ? [8, 12, 22] : [118, 138, 158];
    const skyHor = night ? [18, 24, 36] : [168, 178, 188];
    const floorFar = night ? [22, 20, 16] : [42, 52, 34];
    const floorNear = night ? [48, 42, 30] : [78, 92, 58];
    const fogRgb = night ? [10, 14, 20] : [150, 162, 172];
    let p = 0;
    for (let y = 0; y < h; y++) {
      const t = y < horizon ? y / Math.max(1, horizon) : (y - horizon) / Math.max(1, h - horizon);
      const r = y < horizon
        ? (skyTop[0] + (skyHor[0] - skyTop[0]) * t)
        : (floorFar[0] + (floorNear[0] - floorFar[0]) * t);
      const g = y < horizon
        ? (skyTop[1] + (skyHor[1] - skyTop[1]) * t)
        : (floorFar[1] + (floorNear[1] - floorFar[1]) * t);
      const b = y < horizon
        ? (skyTop[2] + (skyHor[2] - skyTop[2]) * t)
        : (floorFar[2] + (floorNear[2] - floorFar[2]) * t);
      for (let x = 0; x < w; x++) {
        px[p++] = r | 0;
        px[p++] = g | 0;
        px[p++] = b | 0;
        px[p++] = 255;
      }
    }

    const colW = w / RAYS;
    for (let ray = 0; ray < RAYS; ray++) {
      const camX = (2 * (ray + 0.5)) / RAYS - 1;
      const rayAng = yaw + Math.atan(camX * Math.tan(FOV * 0.5));
      const hit = this.cast(castX, castY, rayAng);
      const corr = hit ? hit.dist * Math.cos(rayAng - yaw) : FOG;
      zBuf[ray] = corr;
      if (!hit) continue;
      const lineH = Math.min(h * 2.2, (TILE / Math.max(6, corr)) * proj * WALL_H);
      const top = Math.max(0, Math.floor(horizon - lineH * 0.5));
      const bot = Math.min(h, Math.ceil(top + lineH));
      const shade = Math.max(0.28, 1 - corr / FOG);
      const side = hit.side ? 0.78 : 1;
      const base = WALL_COLORS[hit.tint % WALL_COLORS.length];
      const brick = Math.floor(hit.u * 6) % 2 === 0 ? 1.05 : 0.95;
      const fog = Math.min(1, (corr / FOG) ** 1.4);
      let wr = base[0] * shade * side * brick;
      let wg = base[1] * shade * side * brick;
      let wb = base[2] * shade * side * brick;
      wr = wr * (1 - fog) + fogRgb[0] * fog;
      wg = wg * (1 - fog) + fogRgb[1] * fog;
      wb = wb * (1 - fog) + fogRgb[2] * fog;
      const x0 = Math.floor(ray * colW);
      const x1 = Math.min(w, Math.ceil((ray + 1) * colW));
      for (let y = top; y < bot; y++) {
        const wallT = (y - top) / Math.max(1, bot - top);
        const band = wallT > 0.85 ? 0.75 : wallT < 0.07 ? 1.06 : 1;
        const rr = Math.min(255, wr * band) | 0;
        const gg = Math.min(255, wg * band) | 0;
        const bb = Math.min(255, wb * band) | 0;
        let row = (y * w + x0) * 4;
        for (let x = x0; x < x1; x++) {
          px[row++] = rr;
          px[row++] = gg;
          px[row++] = bb;
          px[row++] = 255;
        }
      }
    }
    ctx.putImageData(this.imageData, 0, 0);

    const sprites = this.collectSprites(me, { x: castX, y: castY }, yaw, proj, w, h);
    sprites.sort((a, b) => b.dist - a.dist);
    for (const spr of sprites) {
      if (spr.dist < 12) continue;
      const size = spr.size;
      const left = Math.floor(spr.screenX - size * 0.5);
      const top = Math.floor(h * EYE - size * (spr.kind === "crate" ? 0.35 : 0.55));
      const right = Math.ceil(spr.screenX + size * 0.5);
      let visible = false;
      const r0 = Math.max(0, Math.floor((left / w) * RAYS));
      const r1 = Math.min(RAYS - 1, Math.ceil((right / w) * RAYS));
      for (let r = r0; r <= r1; r++) {
        if (spr.dist < zBuf[r]) { visible = true; break; }
      }
      if (!visible) continue;
      ctx.globalAlpha = spr.alpha;
      if (spr.kind === "player") this.drawSoldier(ctx, spr.screenX, top, size, spr.color);
      else if (spr.kind === "bike") this.drawBike(ctx, spr.screenX, top + size * 0.2, size, spr.color);
      else if (spr.kind === "crate") this.drawCrate(ctx, spr.screenX, top, size);
      else {
        ctx.fillStyle = spr.color;
        ctx.beginPath();
        ctx.arc(spr.screenX, h * EYE, Math.max(2, size * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
      if (spr.label && size > 28) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(spr.screenX - size * 0.22, top - size * 0.12, size * 0.44, size * 0.1);
        ctx.fillStyle = "#f2f2f2";
        ctx.font = `${Math.max(10, size * 0.11)}px Oswald, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(spr.label, spr.screenX, top - size * 0.04);
      }
      ctx.globalAlpha = 1;
    }

    this.drawWeapon(ctx, w, h, me);
    this.drawCrosshair(ctx, w, h);
    this.drawMinimap(ctx, me, w, h);
    this.drawStats(ctx, me, w, h);
    if (!this.pointerLocked && !serverMenuOpen()) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, h * 0.78, w, h * 0.08);
      ctx.fillStyle = "#e8e8e8";
      ctx.font = `${Math.max(11, w * 0.014)}px Barlow, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Click to capture mouse · WASD move · shoot where you look", w * 0.5, h * 0.825);
    }
  }

  private cast(ox: number, oy: number, ang: number): { dist: number; side: number; tint: number; u: number } | null {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let mapX = Math.floor(ox / TILE);
    let mapY = Math.floor(oy / TILE);
    const deltaX = dx === 0 ? 1e30 : Math.abs(TILE / dx);
    const deltaY = dy === 0 ? 1e30 : Math.abs(TILE / dy);
    let stepX = 0;
    let stepY = 0;
    let sideX = 0;
    let sideY = 0;
    if (dx < 0) {
      stepX = -1;
      sideX = (ox / TILE - mapX) * deltaX;
    } else {
      stepX = 1;
      sideX = (mapX + 1 - ox / TILE) * deltaX;
    }
    if (dy < 0) {
      stepY = -1;
      sideY = (oy / TILE - mapY) * deltaY;
    } else {
      stepY = 1;
      sideY = (mapY + 1 - oy / TILE) * deltaY;
    }
    let side = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
      if (sideX < sideY) {
        sideX += deltaX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += deltaY;
        mapY += stepY;
        side = 1;
      }
      if (mapX < 0 || mapY < 0 || mapX >= COLS || mapY >= ROWS) {
        const dist = (side === 0 ? sideX - deltaX : sideY - deltaY) * TILE;
        const hitX = ox + Math.cos(ang) * dist;
        const hitY = oy + Math.sin(ang) * dist;
        const u = side === 0 ? ((hitY % TILE) + TILE) % TILE / TILE : ((hitX % TILE) + TILE) % TILE / TILE;
        return { dist: Math.max(1, dist), side, tint: 5, u };
      }
      const tint = this.walls[mapY * COLS + mapX];
      if (tint) {
        const dist = (side === 0 ? sideX - deltaX : sideY - deltaY) * TILE;
        const hitX = ox + Math.cos(ang) * dist;
        const hitY = oy + Math.sin(ang) * dist;
        const u = side === 0 ? ((hitY % TILE) + TILE) % TILE / TILE : ((hitX % TILE) + TILE) % TILE / TILE;
        return { dist: Math.max(1, dist), side, tint, u };
      }
    }
    return null;
  }

  private collectSprites(
    me: SyncPlayer,
    eye: { x: number; y: number },
    yaw: number,
    proj: number,
    w: number,
    h: number,
  ): SpriteDraw[] {
    const out: SpriteDraw[] = [];
    const push = (
      x: number, y: number, kind: SpriteDraw["kind"], color: string, scale: number, label?: string, alpha = 1,
    ) => {
      const dx = x - eye.x;
      const dy = y - eye.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return;
      const ang = Math.atan2(dy, dx) - yaw;
      let a = ang;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      if (Math.abs(a) > FOV * 0.75) return;
      const screenX = (w * 0.5) * (1 + Math.tan(a) / Math.tan(FOV * 0.5));
      const size = Math.min(h * 1.6, (TILE / dist) * proj * scale);
      out.push({ x, dist, screenX, size, kind, color, label, alpha });
    };

    this.session.state?.players.forEach((p) => {
      if (p.id === me.id || p.alive === 0) return;
      if (!this.visible(me, p) && !p.blip) return;
      const ghost = this.ghosts.get(p.id) ?? { x: p.x, y: p.y, aim: p.aim, samples: [] };
      const now = performance.now();
      const last = ghost.samples[ghost.samples.length - 1];
      if (!last || now - last.t > 45) {
        ghost.samples.push({ t: now, x: p.x, y: p.y, aim: p.aim });
        if (ghost.samples.length > 8) ghost.samples.shift();
      }
      this.ghosts.set(p.id, ghost);
      const sample = this.sample(ghost);
      const color = p.blip && !this.visible(me, p) ? "#ffb020" : "#d06048";
      push(sample.x, sample.y, "player", color, p.alive === 2 ? 0.7 : 1.15, p.identity || p.name, this.visible(me, p) ? 1 : 0.55);
    });

    this.session.state?.vehicles.forEach((bike, id) => {
      if (!bike.alive) return;
      if (me.seat === 0 && me.vehicleId === id) return;
      push(bike.x, bike.y, "bike", "#2a2e28", 1.35);
    });

    for (const d of map.decor) {
      if (d.kind !== "crate" && d.kind !== "barrier") continue;
      const dx = d.x - eye.x;
      const dy = d.y - eye.y;
      if (dx * dx + dy * dy > (TILE * 22) ** 2) continue;
      push(d.x, d.y, "crate", "#8a7048", 0.7);
    }

    const now = performance.now();
    this.flashes = this.flashes.filter((f) => f.until > now);
    for (const f of this.flashes) push(f.x, f.y, "flash", "#ffe08a", 0.5, undefined, 0.85);
    return out;
  }

  private sample(ghost: Ghost): { x: number; y: number; aim: number } {
    const when = performance.now() - 90;
    const list = ghost.samples;
    if (list.length < 2) return list[0] ?? ghost;
    if (when <= list[0].t) return list[0];
    for (let i = 1; i < list.length; i++) {
      if (when <= list[i].t) {
        const a = list[i - 1];
        const b = list[i];
        const u = (when - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, aim: a.aim };
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

  private drawSoldier(ctx: CanvasRenderingContext2D, x: number, top: number, size: number, color: string): void {
    const s = size;
    const cols = 8;
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1);
      const colW = s * 0.11;
      const cx = x - s * 0.45 + c * colW;
      const legH = s * (0.22 + (1 - Math.abs(t - 0.5) * 2) * 0.08);
      ctx.fillStyle = "#1a1814";
      ctx.fillRect(cx, top + s * 0.78, colW * 0.9, legH);
      const torsoH = s * (0.38 + Math.sin(t * Math.PI) * 0.06);
      ctx.fillStyle = color;
      ctx.fillRect(cx, top + s * 0.38, colW * 0.95, torsoH);
      if (t > 0.35 && t < 0.65) {
        ctx.fillStyle = "#e2b48a";
        ctx.fillRect(cx, top + s * 0.18, colW, s * 0.16);
        ctx.fillStyle = "#2a2820";
        ctx.fillRect(cx + colW * 0.15, top + s * 0.28, colW * 0.7, s * 0.05);
      }
      if (t > 0.55 && t < 0.95) {
        ctx.fillStyle = "#1c1c18";
        ctx.fillRect(cx, top + s * 0.48, colW * 1.1, s * 0.06);
      }
    }
  }

  private drawBike(ctx: CanvasRenderingContext2D, x: number, top: number, size: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x - size * 0.35, top + size * 0.25, size * 0.7, size * 0.22);
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(x - size * 0.22, top + size * 0.48, size * 0.1, 0, Math.PI * 2);
    ctx.arc(x + size * 0.22, top + size * 0.48, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCrate(ctx: CanvasRenderingContext2D, x: number, top: number, size: number): void {
    ctx.fillStyle = "#8a7048";
    ctx.fillRect(x - size * 0.22, top + size * 0.15, size * 0.44, size * 0.44);
    ctx.strokeStyle = "#5a4830";
    ctx.strokeRect(x - size * 0.22, top + size * 0.15, size * 0.44, size * 0.44);
  }

  private drawWeapon(ctx: CanvasRenderingContext2D, w: number, h: number, me: SyncPlayer): void {
    if (me.alive !== 1) return;
    const kick = this.gunKick * h * 0.05;
    const bobY = Math.sin(this.bob) * h * 0.014;
    const bobX = Math.cos(this.bob * 0.5) * w * 0.012;
    const gx = w * 0.54 + bobX;
    const gy = h * 0.68 + kick + bobY;
    const gw = w * 0.42;
    const gh = h * 0.34;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(gx + gw * 0.08, gy + gh * 0.15, gw * 0.75, gh * 0.55);
    ctx.fillStyle = "#2a2820";
    ctx.fillRect(gx + gw * 0.12, gy + gh * 0.22, gw * 0.62, gh * 0.42);
    ctx.fillStyle = "#1a1814";
    ctx.fillRect(gx + gw * 0.55, gy + gh * 0.05, gw * 0.12, gh * 0.55);
    ctx.fillStyle = "#3a3630";
    ctx.fillRect(gx + gw * 0.52, gy - gh * 0.02, gw * 0.18, gh * 0.12);
    ctx.fillStyle = "#8a7048";
    ctx.fillRect(gx + gw * 0.08, gy + gh * 0.38, gw * 0.28, gh * 0.12);
    ctx.fillStyle = "#c4a574";
    ctx.fillRect(gx + gw * 0.02, gy + gh * 0.48, gw * 0.22, gh * 0.08);
    ctx.fillStyle = "#111";
    ctx.fillRect(gx + gw * 0.62, gy + gh * 0.28, gw * 0.06, gh * 0.2);
    if (this.gunKick > 0.25) {
      ctx.fillStyle = `rgba(255,224,140,${0.35 + this.gunKick * 0.45})`;
      ctx.beginPath();
      ctx.arc(gx + gw * 0.58, gy + gh * 0.02, gh * 0.045 * this.gunKick, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStats(ctx: CanvasRenderingContext2D, me: SyncPlayer, w: number, h: number): void {
    const barH = Math.max(36, Math.floor(h * 0.11));
    const y = h - barH;
    ctx.fillStyle = "rgba(28, 18, 12, 0.88)";
    ctx.fillRect(0, y, w, barH);
    ctx.fillStyle = "rgba(255, 200, 120, 0.08)";
    ctx.fillRect(0, y, w, 2);
    const hp = Math.max(0, Math.round(me.hp));
    const mag = me.reloading ? "—" : String(Math.max(0, me.mag | 0));
    const reserve = me.reloading ? "RELOAD" : String(Math.max(0, me.reserve | 0));
    const size = Math.max(22, Math.floor(h * 0.075));
    ctx.font = `600 ${size}px Oswald, Impact, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = hp < me.maxHp * 0.2 ? "#ff3030" : "#d06048";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 0;
    ctx.fillText(String(hp), 16, y + barH * 0.55);
    ctx.font = `500 ${Math.max(10, size * 0.28)}px Barlow, sans-serif`;
    ctx.fillStyle = "#c4a878";
    ctx.fillText("HEALTH", 16, y + barH * 0.22);
    ctx.textAlign = "right";
    ctx.font = `600 ${size}px Oswald, Impact, sans-serif`;
    ctx.fillStyle = mag === "0" ? "#6a3028" : "#d06048";
    ctx.fillText(String(mag), w - 16, y + barH * 0.55);
    ctx.font = `500 ${Math.max(10, size * 0.28)}px Barlow, sans-serif`;
    ctx.fillStyle = "#c4a878";
    ctx.fillText(`AMMO  ${reserve}   G ${me.grenades ?? 0}`, w - 16, y + barH * 0.22);
    ctx.textAlign = "center";
    ctx.fillText((CLASSES[me.classId as keyof typeof CLASSES]?.name ?? "").toUpperCase(), w * 0.5, y + barH * 0.55);
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w * 0.5;
    const cy = h * EYE;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(2, w * 0.003);
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy); ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 16);
    ctx.stroke();
    ctx.strokeStyle = "rgba(244,244,244,0.92)";
    ctx.lineWidth = Math.max(1, w * 0.0015);
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 4, cy);
    ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 4);
    ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14);
    ctx.stroke();
    ctx.fillStyle = "#f2d48a";
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, me: SyncPlayer, w: number, h: number): void {
    const prefs = loadPrefs();
    const big = keys.has(prefs.binds.map);
    const mw = big ? Math.min(520, w * 0.45) : Math.min(210, w * 0.22);
    const mh = big ? Math.min(360, h * 0.45) : Math.min(150, h * 0.2);
    const pad = 16 * (w / Math.max(1, this.canvas.clientWidth || w));
    const x = w - mw - pad;
    const y = pad;
    ctx.fillStyle = "rgba(18,22,15,0.78)";
    ctx.fillRect(x, y, mw, mh);
    const sx = mw / WORLD_W;
    const sy = mh / WORLD_H;
    const now = performance.now();
    this.radarPings = this.radarPings.filter((p) => p.until > now);
    for (const ping of this.radarPings) {
      const life = (ping.until - now) / 1600;
      const px = x + ping.x * sx;
      const py = y + ping.y * sy;
      ctx.strokeStyle = `rgba(255,144,32,${life})`;
      ctx.beginPath();
      ctx.arc(px, py, 5 + (1 - life) * 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,192,64,${0.35 + life * 0.55})`;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const eye = this.origin(me);
    ctx.fillStyle = "#f2d48a";
    ctx.beginPath();
    ctx.arc(x + eye.x * sx, y + eye.y * sy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f2d48a";
    ctx.beginPath();
    ctx.moveTo(x + eye.x * sx, y + eye.y * sy);
    ctx.lineTo(x + (eye.x + Math.cos(this.yaw) * 180) * sx, y + (eye.y + Math.sin(this.yaw) * 180) * sy);
    ctx.stroke();
    this.session.state?.players.forEach((p) => {
      if (p.id === me.id || p.alive === 0) return;
      if (!this.visible(me, p) && !p.blip) return;
      ctx.fillStyle = p.blip && !this.visible(me, p) ? "#ffb020" : "#e07060";
      ctx.beginPath();
      ctx.arc(x + p.x * sx, y + p.y * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private prompt(me: SyncPlayer): string {
    if (me.alive !== 1) return "";
    if (me.seat >= 0) return "E  DISMOUNT";
    let near = false;
    this.session.state?.vehicles.forEach((bike) => {
      if (!bike.alive) return;
      if ((bike.x - me.x) ** 2 + (bike.y - me.y) ** 2 < 56 * 56) near = true;
    });
    if (near) return "E  RIDE EBIKE";
    return "";
  }

  private ridden(me: SyncPlayer) {
    if (!me.vehicleId) return undefined;
    return this.session.state?.vehicles.get(me.vehicleId);
  }
}
