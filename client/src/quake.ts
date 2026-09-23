import * as THREE from "three";
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
/** World pixels → meters (48 px ≈ 1 yd). */
const S = 1 / 48;
const EYE = 1.55;
const WALL_H = 2.9;
const LOOK_SENS = 0.0022;

interface Ghost {
  x: number;
  y: number;
  samples: { t: number; x: number; y: number }[];
}

function makeNoiseTex(
  size: number,
  paint: (ctx: CanvasRenderingContext2D, n: (x: number, y: number) => number) => void,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const n = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  paint(ctx, n);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stoneTexture(): THREE.CanvasTexture {
  return makeNoiseTex(128, (ctx, n) => {
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const brickY = Math.floor(y / 10);
        const ox = brickY % 2 ? 8 : 0;
        const bx = Math.floor((x + ox) / 16);
        const edge = ((x + ox) % 16 < 1 || (x + ox) % 16 > 14 || y % 10 < 1 || y % 10 > 8) ? 0.55 : 1;
        const v = (95 + n(bx, brickY) * 45 + n(x * 0.35, y * 0.35) * 28) * edge;
        const blood = n(bx * 3.1, brickY * 4.7) > 0.94 ? 22 : 0;
        ctx.fillStyle = `rgb(${(v + blood) | 0},${(v * 0.88) | 0},${(v * 0.72) | 0})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

function floorTexture(): THREE.CanvasTexture {
  return makeNoiseTex(128, (ctx, n) => {
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const plank = Math.floor(y / 8);
        const seam = y % 8 < 1 ? 0.55 : 1;
        const v = (70 + n(x * 0.5, plank) * 32 + n(x, y) * 20) * seam;
        ctx.fillStyle = `rgb(${(v * 1.05) | 0},${(v * 0.85) | 0},${(v * 0.55) | 0})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

function metalTexture(): THREE.CanvasTexture {
  return makeNoiseTex(64, (ctx, n) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const rivet = ((x + 4) % 16 < 2 && (y + 4) % 16 < 2) ? 30 : 0;
        const v = 70 + n(x * 0.25, y * 0.25) * 50 + rivet;
        ctx.fillStyle = `rgb(${v | 0},${(v * 0.92) | 0},${(v * 0.82) | 0})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

export class FrontView {
  session: Session;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private gun!: THREE.Group;
  private muzzle!: THREE.PointLight;
  private entities = new Map<string, THREE.Object3D>();
  private bikes = new Map<string, THREE.Object3D>();
  private ghosts = new Map<string, Ghost>();
  private pred = { x: 0, y: 0, aim: 0, acc: 0, ready: false };
  private yaw = 0;
  private pitch = 0;
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
  private flashes: { until: number; mesh: THREE.Mesh }[] = [];
  private mats: THREE.Material[] = [];
  private onMove = (e: MouseEvent) => this.handleLook(e);
  private onClick = () => this.requestLock();
  private onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
  };
  private onResize = () => this.resize();

  constructor(session: Session, parent: HTMLElement) {
    this.session = session;
    parent.replaceChildren();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "quake-view";
    this.renderer.domElement.tabIndex = 0;
    parent.appendChild(this.renderer.domElement);

    this.overlay = document.createElement("canvas");
    this.overlay.className = "quake-overlay";
    parent.appendChild(this.overlay);
    const octx = this.overlay.getContext("2d");
    if (!octx) throw new Error("overlay");
    this.octx = octx;

    this.camera = new THREE.PerspectiveCamera(78, 1, 0.06, 320);
    this.scene.background = new THREE.Color(0x7a8ea0);
    this.scene.fog = new THREE.Fog(0x9aacb4, 28, 160);

    this.buildWorld();
    this.buildGun();
    this.resize();

    window.addEventListener("resize", this.onResize);
    this.renderer.domElement.addEventListener("click", this.onClick);
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
    this.renderer.domElement.removeEventListener("click", this.onClick);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    for (const m of this.mats) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }

  tracer(x: number, y: number, x2: number, y2: number): void {
    this.spawnFlash((x + x2) * 0.5, (y + y2) * 0.5, 90);
    this.spawnFlash(x2, y2, 140);
  }

  radarPing(x: number, y: number): void {
    this.radarPings.push({ x, y, until: performance.now() + 1600 });
    if (this.radarPings.length > 32) this.radarPings.splice(0, this.radarPings.length - 32);
  }

  burst(x: number, y: number): void {
    this.spawnFlash(x, y, 280);
    this.radarPing(x, y);
  }

  onShotFeedback(): void {
    this.gunKick = 1;
    this.muzzle.intensity = 5;
    const me = this.session.mine;
    if (!me) return;
    audio.play(me.classId === "heavy" ? "lmg" : me.classId === "medic" ? "smg" : "shot");
  }

  get midX(): number {
    const me = this.session.mine;
    return me ? this.origin(me).x : 0;
  }

  private spawnFlash(x: number, y: number, lifeMs: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.95 }),
    );
    mesh.position.set(x * S, 1.25, y * S);
    this.scene.add(mesh);
    this.flashes.push({ until: performance.now() + lifeMs, mesh });
  }

  private buildWorld(): void {
    const stone = stoneTexture();
    stone.repeat.set(1.5, 1.5);
    const floorTex = floorTexture();
    floorTex.repeat.set((WORLD_W * S) / 3.5, (WORLD_H * S) / 3.5);
    const metal = metalTexture();
    metal.repeat.set(2, 2);

    const wallMat = new THREE.MeshLambertMaterial({ map: stone });
    const metalMat = new THREE.MeshLambertMaterial({ map: metal });
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
    this.mats.push(wallMat, metalMat, floorMat);

    this.scene.add(new THREE.AmbientLight(0xc8c0b0, 1.15));
    this.scene.add(new THREE.HemisphereLight(0xb8c8e0, 0x6a8050, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.35);
    sun.position.set(40, 80, 30);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xa8c0e0, 0.45);
    fill.position.set(-30, 40, -20);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W * S, WORLD_H * S), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((WORLD_W * S) / 2, 0, (WORLD_H * S) / 2);
    this.scene.add(floor);

    for (const solid of map.solids) {
      const ww = Math.max(0.25, solid.w * S);
      const dd = Math.max(0.25, solid.h * S);
      const long = solid.w > solid.h * 3 || solid.h > solid.w * 3;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(ww, WALL_H, dd), long ? metalMat : wallMat);
      mesh.position.set((solid.x + solid.w / 2) * S, WALL_H / 2, (solid.y + solid.h / 2) * S);
      this.scene.add(mesh);
    }

    for (const d of map.decor) {
      if (d.kind !== "crate" && d.kind !== "barrier") continue;
      const size = Math.max(0.45, Math.min(d.w, d.h) * S * 0.85);
      const h = size * (d.kind === "crate" ? 0.95 : 0.5);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(size, h, size),
        new THREE.MeshLambertMaterial({ color: d.kind === "crate" ? 0x7a5a38 : 0x8a3040 }),
      );
      this.mats.push(box.material as THREE.Material);
      box.position.set(d.x * S, h / 2, d.y * S);
      this.scene.add(box);
    }
  }

  private buildGun(): void {
    this.gun = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x1a1a18 });
    const wood = new THREE.MeshLambertMaterial({ color: 0x4a3020 });
    const steel = new THREE.MeshLambertMaterial({ color: 0x5a5a58 });
    this.mats.push(dark, wood, steel);

    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.58), dark);
    b1.position.set(0.06, -0.1, -0.48);
    const b2 = b1.clone();
    b2.position.x = 0.16;
    const breech = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.2), steel);
    breech.position.set(0.11, -0.08, -0.2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.3), wood);
    stock.position.set(0.11, -0.14, -0.05);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.08), wood);
    grip.position.set(0.11, -0.22, 0.02);
    this.gun.add(b1, b2, breech, stock, grip);
    this.camera.add(this.gun);
    this.scene.add(this.camera);

    this.muzzle = new THREE.PointLight(0xffcc66, 0, 8);
    this.muzzle.position.set(0.11, -0.06, -0.8);
    this.camera.add(this.muzzle);
    const lamp = new THREE.PointLight(0xffe8c8, 1.1, 22, 1.4);
    lamp.position.set(0, 0.2, 0.1);
    this.camera.add(lamp);
  }

  private makeSoldier(color: number): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.9, 0.35),
      new THREE.MeshLambertMaterial({ color }),
    );
    body.position.y = 1.1;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.32),
      new THREE.MeshLambertMaterial({ color: 0xc4a070 }),
    );
    head.position.y = 1.72;
    const helm = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.16, 0.36),
      new THREE.MeshLambertMaterial({ color: 0x3a3a40 }),
    );
    helm.position.y = 1.86;
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.75, 0.32),
      new THREE.MeshLambertMaterial({ color: 0x2a2824 }),
    );
    legs.position.y = 0.4;
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.55),
      new THREE.MeshLambertMaterial({ color: 0x111 }),
    );
    gun.position.set(0.3, 1.1, -0.28);
    g.add(body, head, helm, legs, gun);
    return g;
  }

  private makeBike(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.38, 1.15),
      new THREE.MeshLambertMaterial({ color: 0x2a2e28 }),
    );
    body.position.y = 0.48;
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111 });
    const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 8), wheelMat);
    w1.rotation.z = Math.PI / 2;
    w1.position.set(0, 0.24, 0.42);
    const w2 = w1.clone();
    w2.position.z = -0.42;
    g.add(body, w1, w2);
    return g;
  }

  private requestLock(): void {
    if (serverMenuOpen()) return;
    if (!this.pointerLocked) void this.renderer.domElement.requestPointerLock();
  }

  private handleLook(event: MouseEvent): void {
    if (!this.pointerLocked || serverMenuOpen()) return;
    this.yaw += event.movementX * LOOK_SENS;
    this.pitch -= event.movementY * LOOK_SENS;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
  }

  private resize(): void {
    const parent = this.renderer.domElement.parentElement;
    const w = Math.max(320, parent?.clientWidth || window.innerWidth);
    const h = Math.max(240, parent?.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlay.width = w;
    this.overlay.height = h;
    this.overlay.style.width = "100%";
    this.overlay.style.height = "100%";
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
    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 18);
    const moving = Math.hypot(input.mx, input.my) > 0.1 || Math.abs(input.throttle) > 0.1;
    this.bob += dt * (moving ? 9 : 1.4);
    this.syncEntities(me);
    this.updateCamera(me);
    this.pruneFlashes();
    this.renderer.render(this.scene, this.camera);
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
    let yaw = this.yaw;
    if (me.seat === 0 && me.vehicleId) {
      const bike = this.session.state?.vehicles.get(me.vehicleId);
      if (bike) {
        yaw = bike.heading + Math.PI / 2;
        this.yaw = yaw;
      }
    }
    const pitch = me.seat === 0 ? this.pitch * 0.35 : this.pitch;
    const bobY = Math.sin(this.bob) * (me.seat >= 0 ? 0.012 : 0.028);
    const bobX = Math.cos(this.bob * 0.5) * 0.014;
    this.camera.position.set(
      eye.x * S + bobX,
      EYE + bobY + (me.seat >= 0 ? 0.38 : 0),
      eye.y * S,
    );
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
    this.gun.position.set(0.2, -0.26 - this.gunKick * 0.09, -0.32 - this.gunKick * 0.06);
    this.gun.rotation.x = this.gunKick * 0.14;
    this.gun.visible = me.alive === 1;
  }

  /** Movement & aim from camera yaw. W = into the screen. */
  private lookVectors(): { fx: number; fy: number; rx: number; ry: number; aim: number } {
    // Three.js yaw: local -Z look → world XZ (-sin(y), -cos(y)); world map uses (x,z) as (x,y).
    const fx = -Math.sin(this.yaw);
    const fy = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const ry = -Math.sin(this.yaw);
    return { fx, fy, rx, ry, aim: Math.atan2(fy, fx) };
  }

  private worldAim(): number {
    return this.lookVectors().aim;
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
      let obj = this.entities.get(id);
      if (!obj) {
        obj = this.makeSoldier(p.blip && !this.visible(me, p) ? 0xffb020 : 0xb05040);
        this.entities.set(id, obj);
        this.scene.add(obj);
      }
      obj.position.set(sample.x * S, 0, sample.y * S);
      obj.rotation.y = p.aim + Math.PI / 2;
      obj.scale.setScalar(p.alive === 2 ? 0.7 : 1);
      obj.visible = true;
    });
    for (const [id, obj] of this.entities) {
      if (!seen.has(id)) {
        this.scene.remove(obj);
        this.entities.delete(id);
        this.ghosts.delete(id);
      }
    }

    const bikeSeen = new Set<string>();
    this.session.state?.vehicles.forEach((bike, id) => {
      if (!bike.alive) return;
      if (me.seat === 0 && me.vehicleId === id) return;
      bikeSeen.add(id);
      let obj = this.bikes.get(id);
      if (!obj) {
        obj = this.makeBike();
        this.bikes.set(id, obj);
        this.scene.add(obj);
      }
      obj.position.set(bike.x * S, 0, bike.y * S);
      obj.rotation.y = bike.heading + Math.PI / 2;
      obj.visible = true;
    });
    for (const [id, obj] of this.bikes) {
      if (!bikeSeen.has(id)) {
        this.scene.remove(obj);
        this.bikes.delete(id);
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

  private pruneFlashes(): void {
    const now = performance.now();
    this.flashes = this.flashes.filter((f) => {
      if (f.until > now) {
        (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (f.until - now) / 280);
        return true;
      }
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
      return false;
    });
  }

  private drawOverlay(me: SyncPlayer): void {
    const w = this.overlay.width;
    const h = this.overlay.height;
    const ctx = this.octx;
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.48;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy); ctx.lineTo(cx - 3, cy);
    ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy - 3);
    ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 12);
    ctx.stroke();
    ctx.strokeStyle = "rgba(245,245,245,0.95)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#e8a040";
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);

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
    const aim = this.worldAim();
    ctx.fillStyle = "#f2d48a";
    ctx.beginPath();
    ctx.arc(mx + eye.x * sx, my + eye.y * sy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f2d48a";
    ctx.beginPath();
    ctx.moveTo(mx + eye.x * sx, my + eye.y * sy);
    ctx.lineTo(mx + (eye.x + Math.cos(aim) * 220) * sx, my + (eye.y + Math.sin(aim) * 220) * sy);
    ctx.stroke();
    this.session.state?.players.forEach((p) => {
      if (p.id === me.id || p.alive === 0) return;
      if (!this.visible(me, p) && !p.blip) return;
      ctx.fillStyle = p.blip && !this.visible(me, p) ? "#ffb020" : "#e07060";
      ctx.beginPath();
      ctx.arc(mx + p.x * sx, my + p.y * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    if (!this.pointerLocked && !serverMenuOpen()) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, h * 0.72, w, 36);
      ctx.fillStyle = "#e8e0d0";
      ctx.font = `${Math.max(12, w * 0.013)}px Barlow, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Click to look · WASD move · mouse look · shoot where you aim", w * 0.5, h * 0.72 + 24);
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
