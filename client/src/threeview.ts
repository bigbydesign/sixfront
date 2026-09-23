/**
 * Three.js FPS view — Big Hersh House / Nuketown layout.
 * Keeps Colyseus Session + prediction.
 */
import * as THREE from "three";
import {
  CLASSES,
  IDENTITIES,
  WORLD_H,
  WORLD_W,
  blockedAt,
  footMul,
  getMap,
  ladderAt,
  roofAt,
  roofHeight,
  walkSolids,
  doorAt,
  floorUnder,
  circleHitsRect,
  segmentHitsRect,
  HERSH_SCALE,
  lerpAngle,
  SIM_DT,
  slotWeapon,
  stepInfantry,
  type ClassId,
  type MoveInput,
} from "@sixfront/shared";
import { audio } from "./audio";
import type { Session, SyncPlayer } from "./net";
import { bindDown, keys, loadPrefs, mouse } from "./settings";
import { serverMenuOpen, toggleServerMenu, openServerMenu, updateHud } from "./ui";
import { createHershHouse } from "./hershHouse";

const map = getMap();

/** 48 world px ≈ 1 m → Three world units. */
const WORLD_PER_M = 48;
const S = 1 / WORLD_PER_M;
const EYE = 1.55;
const BIKE_EYE = 0.35;
const WALL_H = 3.2;
const CEIL_H = 3.4;
const LOOK_SENS = 0.00215;
const PITCH_MAX = 1.05;
const WHEEL_COOLDOWN_MS = 180;
const JUMP_V = 5.2;
const JUMP_G = 16;
const TRAMP_V = 22.05;

interface GhostSample {
  t: number;
  x: number;
  y: number;
  z: number;
  aim: number;
  pitch: number;
}

interface Ghost {
  x: number;
  y: number;
  z: number;
  aim: number;
  samples: GhostSample[];
}

function makeTex(
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
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Sunset Blvd grey horizontal clapboard. */
const TEX_SIDING = makeTex(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const seam = y % 7 < 1;
      const v = (seam ? 70 : 145) + n(x, y) * 16;
      ctx.fillStyle = rgb(v * 0.92, v * 0.94, v);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

const TEX_SHINGLE = makeTex(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const row = Math.floor(y / 5);
      const offset = (row % 2) * 4;
      const seam = (x + offset) % 10 < 1 || y % 5 < 1;
      const v = seam ? 42 : 58 + n(x, y) * 18;
      ctx.fillStyle = rgb(v, v * 0.98, v * 1.02);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

const TEX_ASPHALT = makeTex(128, (ctx, n) => {
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const grit = n(x, y);
      const patch = n(Math.floor(x / 8), Math.floor(y / 8));
      let g = 96 + patch * 46 + grit * 24;
      if (grit > 0.82) g = 140 + n(x * 2, y * 3) * 28;
      if (grit < 0.05) g = 62;
      if ((x * 3 + y) % 53 < 2) g *= 0.78;
      ctx.fillStyle = rgb(g * 0.38, g * 0.95, g * 0.22);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

const TEX_FLOOR = makeTex(64, (ctx, n) => {
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

const TEX_METAL = makeTex(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = 90 + n(x, y) * 40;
      ctx.fillStyle = rgb(v * 0.85, v * 0.88, v * 0.92);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

const TEX_WOOD = makeTex(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = 100 + n(x * 0.3, y) * 40;
      ctx.fillStyle = rgb(v, v * 0.65, v * 0.35);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

const TEX_BUS = makeTex(64, (ctx, n) => {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const band = y > 20 && y < 36;
      const v = band ? 200 + n(x, y) * 20 : 40 + n(x, y) * 20;
      ctx.fillStyle = band ? rgb(v * 0.95, v * 0.2, v * 0.15) : rgb(v, v, v * 1.05);
      ctx.fillRect(x, y, 1, 1);
    }
  }
});

function mat(tex: THREE.Texture, repeatX = 1, repeatY = 1, color = 0xffffff): THREE.MeshLambertMaterial {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(repeatX, repeatY);
  return new THREE.MeshLambertMaterial({ map: t, color });
}

function solidMat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

const groundMaterials = new Map<string, THREE.MeshBasicMaterial>();

function groundMaterial(tex: THREE.Texture): THREE.MeshBasicMaterial {
  const cached = groundMaterials.get(tex.uuid);
  if (cached) return cached;
  const map = tex.clone();
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  groundMaterials.set(tex.uuid, material);
  return material;
}

export class ThreeView {
  session: Session;
  private root: HTMLElement;
  private canvasHost: HTMLElement;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private gunRoot: THREE.Group;
  private muzzleFlash: THREE.Mesh;
  private worldRoot: THREE.Group;
  private entities = new Map<string, THREE.Object3D>();
  private bikes = new Map<string, THREE.Object3D>();
  private projectiles = new Map<string, THREE.Object3D>();
  private pickups = new Map<string, THREE.Object3D>();
  private smokeCloudMeshes = new Map<string, THREE.Object3D>();
  private ghosts = new Map<string, Ghost>();
  private tracers: { mesh: THREE.Object3D; until: number }[] = [];
  private splats: { mesh: THREE.Object3D; until: number }[] = [];
  private signRoot: THREE.Group | null = null;
  private signWorld = { x: 0, y: 0 };
  private signBroken = false;
  private doorRoots = new Map<string, THREE.Group>();
  private doorOpenLocal = new Map<string, number>();
  private hershDoorMesh: THREE.Object3D | null = null;
  private debris: { mesh: THREE.Object3D; vx: number; vy: number; vz: number; wx: number; wy: number; wz: number; until: number; slow?: boolean }[] = [];
  private bloodStains: THREE.Object3D[] = [];
  private clouds: { sprite: THREE.Sprite; speed: number }[] = [];
  private prevAlive = 1;
  private spectateId = "";
  private watch: SyncPlayer | null = null;
  private forceSpectate = false;
  private specLeft = false;
  private specRight = false;
  private pred = { x: 0, y: 0, aim: 0, acc: 0, ready: false };
  private yaw = 0;
  private pitch = 0;
  private seq = 1;
  private edges = { reload: false, ability: false, grenade: false, interact: false };
  private gunKick = 0;
  private gunSkin = "";
  private bob = 0;
  private jumpY = 0;
  private floorZ = 0;
  private climbing = false;
  private targetFov = 72;
  private jumpVel = 0;
  private jumpHeld = false;
  private escDown = false;
  private pendingMenuFromEsc = false;
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
    const locked = document.pointerLockElement === this.canvasHost;
    if (this.pointerLocked && !locked) {
      this.pitch *= 0.35;
      if (Math.abs(this.pitch) < 0.04) this.pitch = 0;
      if (this.pendingMenuFromEsc) {
        this.pendingMenuFromEsc = false;
        if (!serverMenuOpen()) openServerMenu(this.session);
      }
    }
    this.pointerLocked = locked;
  };
  private onEscKey = (event: KeyboardEvent) => {
    if (event.code !== "Escape") return;
    if (!this.running) return;
    event.preventDefault();
    if (this.pointerLocked) {
      this.pendingMenuFromEsc = true;
      document.exitPointerLock();
      return;
    }
    toggleServerMenu(this.session);
  };
  private onResize = () => this.resize();

  /** Full portrait in the sky, uncropped, facing the camera. */
  private addJesusSun(): void {
    const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}sun-jesus.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      depthWrite: false,
      fog: false,
    });
    const face = new THREE.Sprite(mat);
    const height = 46;
    const width = height * (647 / 1024);
    face.position.set(40, 68, 18);
    face.scale.set(width, height, 1);
    face.frustumCulled = false;
    face.renderOrder = 2;
    this.scene.add(face);
  }

  /** Round moon on the far side of the sky, this picture filling the disc. */
  private addMoon(): void {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const moon = new THREE.Sprite(mat);
    moon.position.set(10, 62, 50);
    moon.scale.set(22, 22, 1);
    moon.frustumCulled = false;
    moon.renderOrder = 2;
    this.scene.add(moon);

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cx = size / 2;
      const cy = size / 2;
      const r = 230;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
      tex.needsUpdate = true;
    };
    img.src = `${import.meta.env.BASE_URL}moon.jpg`;
  }

  /** Soft white clouds under the sun, drifting across the map. */
  private addClouds(): void {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const puff = (x: number, y: number, r: number) => {
      const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.96)");
      g.addColorStop(0.55, "rgba(255,255,255,0.72)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    puff(78, 72, 40);
    puff(118, 60, 50);
    puff(162, 70, 44);
    puff(198, 66, 32);
    puff(104, 86, 34);
    puff(150, 88, 30);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const mapW = WORLD_W * S;
    const mapH = WORLD_H * S;
    for (let i = 0; i < 14; i++) {
      const sprite = new THREE.Sprite(mat);
      const wide = 16 + (i % 5) * 5;
      sprite.position.set((i * 13.7 + 4) % mapW, 34 + (i % 4) * 5, (i * 9.4 + 6) % mapH);
      sprite.scale.set(wide * 1.7, wide, 1);
      sprite.frustumCulled = false;
      sprite.renderOrder = 1;
      this.scene.add(sprite);
      this.clouds.push({ sprite, speed: 1.1 + (i % 4) * 0.35 });
    }
  }

  private driftClouds(dt: number): void {
    const limit = WORLD_W * S + 24;
    for (const cloud of this.clouds) {
      cloud.sprite.position.x += cloud.speed * dt;
      if (cloud.sprite.position.x > limit) cloud.sprite.position.x = -20;
    }
  }

  constructor(session: Session, parent: HTMLElement) {
    this.session = session;
    parent.replaceChildren();

    this.root = document.createElement("div");
    this.root.className = "three-root";
    parent.appendChild(this.root);

    this.canvasHost = document.createElement("div");
    this.canvasHost.className = "three-view";
    this.canvasHost.tabIndex = 0;
    this.root.appendChild(this.canvasHost);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87a0b8);
    this.scene.fog = new THREE.Fog(0x9aafc4, 120, 260);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 220);
    this.camera.rotation.order = "YXZ";

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvasHost.appendChild(this.renderer.domElement);

    this.worldRoot = new THREE.Group();
    this.scene.add(this.worldRoot);

    const hemi = new THREE.HemisphereLight(0xc8d8f0, 0x1a1c1e, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.05);
    sun.position.set(40, 80, 20);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    this.addJesusSun();
    this.addMoon();
    this.addClouds();

    this.camera.rotation.order = "YXZ";

    this.gunRoot = new THREE.Group();
    this.camera.add(this.gunRoot);
    this.scene.add(this.camera);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0 }),
    );
    this.muzzleFlash.position.set(0.12, -0.12, -0.85);
    this.buildGun("rifle");

    const cross = document.createElement("div");
    cross.className = "three-cross";
    this.root.appendChild(cross);

    this.overlay = document.createElement("canvas");
    this.overlay.className = "three-overlay";
    this.root.appendChild(this.overlay);
    const octx = this.overlay.getContext("2d");
    if (!octx) throw new Error("overlay");
    this.octx = octx;

    this.buildWorld();
    this.resize();

    window.addEventListener("resize", this.onResize);
    this.canvasHost.addEventListener("click", this.onClick);
    this.canvasHost.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMove);
    window.addEventListener("keydown", this.onEscKey);

    this.running = true;
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onEscKey);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMove);
    this.canvasHost.removeEventListener("click", this.onClick);
    this.canvasHost.removeEventListener("wheel", this.onWheel);
    if (document.pointerLockElement === this.canvasHost) document.exitPointerLock();
    this.renderer.dispose();
    this.root.remove();
  }

  tracer(x: number, y: number, x2: number, y2: number, z1 = 74, z2 = 74): void {
    const group = new THREE.Group();
    const dx = (x2 - x) * S;
    const dz = (y2 - y) * S;
    const y0 = Math.max(0.15, z1 * S);
    const y1 = Math.max(0.08, z2 * S);
    const len = Math.hypot(dx, dz, y1 - y0);
    if (len > 0.08) {
      const streak = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.035, len),
        new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.92 }),
      );
      streak.position.set((x + x2) * 0.5 * S, (y0 + y1) * 0.5, (y + y2) * 0.5 * S);
      streak.lookAt(x2 * S, y1, y2 * S);
      group.add(streak);
    }
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb040 }),
    );
    spark.position.set(x2 * S, y1, y2 * S);
    group.add(spark);
    this.worldRoot.add(group);
    this.tracers.push({ mesh: group, until: performance.now() + 140 });
  }

  radarPing(x: number, y: number): void {
    this.radarPings.push({ x, y, until: performance.now() + 1600 });
    if (this.radarPings.length > 32) this.radarPings.splice(0, this.radarPings.length - 32);
  }

  burst(x: number, y: number, kind = ""): void {
    this.radarPing(x, y);
    if (kind === "smoke") {
      audio.play("empty");
      return;
    }
    if (kind === "hotdog" || kind === "grenade") {
      this.splatHotdog(x, y);
      audio.play("explode");
      this.tryBreakSign(x, y);
      return;
    }
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffaa44 }),
    );
    spark.position.set(x * S, 1.2, y * S);
    this.worldRoot.add(spark);
    this.tracers.push({ mesh: spark, until: performance.now() + 100 });
  }

  /** Shatter the welcome billboard if a hotdog blast lands nearby. */
  private tryBreakSign(wx: number, wy: number): void {
    if (this.signBroken || !this.signRoot) return;
    if (Math.hypot(wx - this.signWorld.x, wy - this.signWorld.y) > 130) return;
    this.signBroken = true;
    const cx = this.signWorld.x * S;
    const cz = this.signWorld.y * S;
    const pieces: THREE.Object3D[] = [];
    this.signRoot.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const clone = obj.clone();
        clone.position.set(obj.position.x, obj.position.y, obj.position.z);
        pieces.push(clone);
      }
    });
    this.worldRoot.remove(this.signRoot);
    this.signRoot = null;

    const boardMat = solidMat(0x5a3a22);
    for (let i = 0; i < 10; i++) {
      const shard = new THREE.Mesh(
        new THREE.BoxGeometry(0.35 + Math.random() * 0.7, 0.08, 0.25 + Math.random() * 0.5),
        boardMat,
      );
      shard.position.set(cx + (Math.random() - 0.5) * 2.2, 2.2 + Math.random() * 1.2, cz + (Math.random() - 0.5) * 0.6);
      pieces.push(shard);
    }

    const now = performance.now();
    for (const mesh of pieces) {
      this.worldRoot.add(mesh);
      const ang = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 4.5;
      this.debris.push({
        mesh,
        vx: Math.cos(ang) * speed,
        vy: 3 + Math.random() * 5,
        vz: Math.sin(ang) * speed,
        wx: (Math.random() - 0.5) * 10,
        wy: (Math.random() - 0.5) * 10,
        wz: (Math.random() - 0.5) * 10,
        until: now + 3500 + Math.random() * 1500,
      });
    }
  }

  private stepDebris(dt: number): void {
    const now = performance.now();
    this.debris = this.debris.filter((d) => {
      d.vy -= (d.slow ? 5.5 : 14) * (d.slow ? dt * 0.32 : dt);
      const step = d.slow ? dt * 0.32 : dt;
      d.mesh.position.x += d.vx * step;
      d.mesh.position.y += d.vy * step;
      d.mesh.position.z += d.vz * step;
      d.mesh.rotation.x += d.wx * step;
      d.mesh.rotation.y += d.wy * step;
      d.mesh.rotation.z += d.wz * step;
      if (d.mesh.position.y < 0.05) {
        d.mesh.position.y = 0.05;
        d.vy *= -0.25;
        d.vx *= 0.7;
        d.vz *= 0.7;
      }
      if (d.until > now) return true;
      this.worldRoot.remove(d.mesh);
      return false;
    });
  }

  /** Mustard/ketchup mess on the ground when a dog lands. */
  private splatHotdog(x: number, y: number): void {
    const group = new THREE.Group();
    group.position.set(x * S, 0.04, y * S);
    const mustard = new THREE.Mesh(
      new THREE.CircleGeometry(0.55 + Math.random() * 0.25, 12),
      new THREE.MeshBasicMaterial({ color: 0xf0c830, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
    );
    mustard.rotation.x = -Math.PI / 2;
    mustard.rotation.z = Math.random() * Math.PI;
    const ketchup = new THREE.Mesh(
      new THREE.CircleGeometry(0.28 + Math.random() * 0.15, 10),
      new THREE.MeshBasicMaterial({ color: 0xb02820, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
    );
    ketchup.rotation.x = -Math.PI / 2;
    ketchup.position.set(0.15, 0.01, -0.1);
    for (let i = 0; i < 5; i++) {
      const bit = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 5, 5),
        solidMat(0xd4a060),
      );
      bit.position.set((Math.random() - 0.5) * 0.7, 0.05, (Math.random() - 0.5) * 0.7);
      group.add(bit);
    }
    group.add(mustard, ketchup);
    this.worldRoot.add(group);
    this.splats.push({ mesh: group, until: performance.now() + 4500 });
  }

  /** Blood pool that stays on the ground where someone was hit. */
  blood(x: number, y: number, floorZ = 0): void {
    const group = new THREE.Group();
    group.position.set(x * S, Math.max(0.035, floorZ * S + 0.045), y * S);
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(0.22 + Math.random() * 0.28, 10),
      new THREE.MeshBasicMaterial({ color: 0x5a0a0c, transparent: true, opacity: 0.94, side: THREE.DoubleSide, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.rotation.z = Math.random() * Math.PI;
    group.add(pool);
    for (let i = 0; i < 4; i++) {
      const drop = new THREE.Mesh(
        new THREE.CircleGeometry(0.05 + Math.random() * 0.07, 6),
        new THREE.MeshBasicMaterial({ color: 0x7a1214, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      );
      drop.rotation.x = -Math.PI / 2;
      const ang = Math.random() * Math.PI * 2;
      const dist = 0.2 + Math.random() * 0.55;
      drop.position.set(Math.cos(ang) * dist, 0.008, Math.sin(ang) * dist);
      group.add(drop);
    }
    this.worldRoot.add(group);
    this.bloodStains.push(group);
    while (this.bloodStains.length > 48) {
      const old = this.bloodStains.shift();
      if (old) this.worldRoot.remove(old);
    }
  }

  /** Break a fighter into pieces and play the burst in slow motion. */
  private explodeBody(node: THREE.Object3D, floorZ: number, x?: number, y?: number): void {
    if (x != null && y != null) node.position.set(x * S, floorZ * S, y * S);
    const pieces: THREE.Object3D[] = [];
    node.updateMatrixWorld(true);
    node.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clone = mesh.clone();
      mesh.getWorldPosition(clone.position);
      mesh.getWorldQuaternion(clone.quaternion);
      clone.scale.copy(mesh.getWorldScale(new THREE.Vector3()));
      pieces.push(clone);
    });
    const bloodMat = solidMat(0x6a1012);
    const origin = node.position.clone();
    origin.y += 0.9;
    for (let i = 0; i < 7; i++) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.12, 6, 6), bloodMat);
      blob.position.copy(origin);
      pieces.push(blob);
    }
    if (node.parent) node.parent.remove(node);
    const now = performance.now();
    for (const mesh of pieces) {
      this.worldRoot.add(mesh);
      const ang = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 3.4;
      this.debris.push({
        mesh,
        slow: true,
        vx: Math.cos(ang) * speed,
        vy: 1.6 + Math.random() * 3.4,
        vz: Math.sin(ang) * speed,
        wx: (Math.random() - 0.5) * 8,
        wy: (Math.random() - 0.5) * 8,
        wz: (Math.random() - 0.5) * 8,
        until: now + 4600,
      });
    }
    const gx = (x != null ? x : node.position.x / S);
    const gy = (y != null ? y : node.position.z / S);
    this.blood(gx, gy, floorZ);
  }

  onShotFeedback(weapon?: string): void {
    this.gunKick = 1;
    const mat = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    const me = this.session.mine;
    if (weapon === "grenade" || weapon === "smoke" || me?.weaponSlot === 4) {
      mat.opacity = 0;
      this.gunKick = 1.35;
      audio.play("empty");
      return;
    }
    mat.opacity = 1;
    if (!me) return;
    audio.play(me.classId === "heavy" ? "lmg" : me.classId === "medic" ? "smg" : "shot");
  }

  get midX(): number {
    const me = this.session.mine;
    return me ? this.origin(me).x : 0;
  }

  private buildWorld(): void {
    this.buildSurfaces();

    for (const b of map.buildings) {
      let h = WALL_H * 0.85;
      let tex = TEX_SIDING;
      let roof = true;
      if (b.kind === "corn") continue;
      if (b.kind === "fence") {
        h = WALL_H * 0.42;
        tex = TEX_METAL;
        roof = false;
      } else if (b.kind === "bus") {
        h = WALL_H * 0.7;
        tex = TEX_BUS;
      } else if (b.kind === "attic") {
        h = CEIL_H * 1.15;
        tex = TEX_SIDING;
      } else if (b.kind === "garage") {
        h = WALL_H * 0.72;
      } else if (b.kind === "house") {
        h = WALL_H * 0.95;
      }
      this.addBox(b.x * S, b.y * S, b.w * S, b.h * S, h, tex, roof, b.kind === "house" || b.kind === "attic");
    }
    this.addCornfield();

    for (const d of map.decor) {
      if (d.kind === "crate") {
        const size = Math.max(0.4, Math.min(d.w, d.h) * S * 0.95);
        this.addBox(d.x * S - size / 2, d.y * S - size / 2, size, size, size * 0.95, TEX_WOOD, true);
      } else if (d.kind === "barrier") {
        const w = Math.max(0.5, d.w * S);
        const depth = Math.max(0.25, d.h * S);
        this.addBox(d.x * S - w / 2, d.y * S - depth / 2, w, depth, 0.55, TEX_METAL, true);
      } else if (d.kind === "car") {
        const w = Math.max(0.8, d.w * S);
        const depth = Math.max(0.5, d.h * S);
        this.addBox(d.x * S - w / 2, d.y * S - depth / 2, w, depth, 0.7, TEX_METAL, true);
      } else if (d.kind === "fusion") {
        this.addFusion(d.x * S, d.y * S, d.w * S, d.h * S, d.rot);
      } else if (d.kind === "sign") {
        this.addWelcomeSign(d.x * S, d.y * S, d.w * S);
      } else if (d.kind === "callboard") {
        this.addCallBillboard(d.x * S, d.y * S, d.w * S);
      } else if (d.kind === "tree") {
        this.addYardTree(d.x * S, d.y * S);
      } else if (d.kind === "lamp") {
        this.addLampPost(d.x * S, d.y * S);
      } else if (d.kind === "trampoline") {
        this.addTrampoline(d.x * S, d.y * S, Math.max(d.w, d.h) * S, d.variant);
      } else if (d.kind === "chimney") {
        this.addChimney(d.x * S, d.y * S, d.w * S);
      } else if (d.kind === "window") {
        this.addArchedWindow(d.x * S, d.y * S, d.h * S);
      } else if (d.kind === "bush") {
        this.addBush(d.x * S, d.y * S);
      } else if (d.kind === "pillar") {
        this.addPorchPillar(d.x * S, d.y * S);
      } else if (d.kind === "garagedoor") {
        this.addGarageDoor(d.x * S, d.y * S, d.h * S);
      } else if (d.kind === "step") {
        this.addYardStep(d.x * S, d.y * S, d.w * S, d.h * S, d.variant);
      } else if (d.kind === "door") {
        /* built from map.doors below */
      } else if (d.kind === "tower") {
        const size = 0.9;
        this.addBox(d.x * S - size / 2, d.y * S - size / 2, size, size, CEIL_H * 0.95, TEX_METAL, true);
      }
    }

    for (const door of map.doors) {
      if (door.house === "hersh") continue;
      this.addDoor(door);
    }

    const hershHome = createHershHouse();
    hershHome.scale.setScalar(HERSH_SCALE);
    hershHome.position.set(map.hersh.cx * S, 0, map.hersh.cy * S);
    hershHome.rotation.y = Math.PI / 2;
    this.worldRoot.add(hershHome);
    this.hershDoorMesh = hershHome.getObjectByName("FrontDoor") ?? null;

    for (const roof of map.roofs) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(roof.w * S, roof.h * S),
        mat(TEX_SHINGLE, Math.max(2, roof.w * S / 2), Math.max(2, roof.h * S / 2), 0x6a7078),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((roof.x + roof.w / 2) * S, roof.z * S + 0.02, (roof.y + roof.h / 2) * S);
      this.worldRoot.add(mesh);
      // Low gable ridge along longer axis
      const alongX = roof.w >= roof.h;
      const ridge = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? roof.w * S * 0.95 : 0.12, 0.35, alongX ? 0.12 : roof.h * S * 0.95),
        solidMat(0x3a3e44),
      );
      ridge.position.set((roof.x + roof.w / 2) * S, roof.z * S + 0.28, (roof.y + roof.h / 2) * S);
      this.worldRoot.add(ridge);
    }
    for (const lad of map.ladders) {
      this.addLadder(lad.x, lad.y, lad.w, lad.h, lad.topZ);
    }
  }

  /** Stalks along every corn-maze wall. Collision is the wall rect, not each plant. */
  private addCornfield(): void {
    const rows = map.buildings.filter((b) => b.kind === "corn");
    let count = 0;
    for (const row of rows) count += Math.max(1, Math.floor(Math.max(row.w, row.h) / 18)) * 2;
    const stalkGeo = new THREE.ConeGeometry(0.28, 2.8, 5);
    const tasselGeo = new THREE.ConeGeometry(0.1, 0.42, 4);
    const stalkMat = new THREE.MeshLambertMaterial({ color: 0x3fae32 });
    const tasselMat = new THREE.MeshLambertMaterial({ color: 0xe6d15a });
    const stalks = new THREE.InstancedMesh(stalkGeo, stalkMat, Math.max(1, count));
    const tassels = new THREE.InstancedMesh(tasselGeo, tasselMat, Math.max(1, count));
    stalks.frustumCulled = false;
    tassels.frustumCulled = false;
    const dummy = new THREE.Object3D();
    let i = 0;
    for (const row of rows) {
      const alongX = row.w >= row.h;
      const len = alongX ? row.w : row.h;
      const n = Math.max(1, Math.floor(len / 18));
      for (let k = 0; k < n; k++) {
        for (const side of [0.28, 0.72]) {
          if (i >= count) break;
          const t = (k + 0.5) / n;
          const x = (row.x + (alongX ? t * row.w : row.w * side)) * S;
          const z = (row.y + (alongX ? row.h * side : t * row.h)) * S;
          const tall = 0.9 + ((k + side * 3) % 3) * 0.15;
          dummy.position.set(x, 1.4 * tall, z);
          dummy.rotation.set(0, (k * 0.7) % Math.PI, 0);
          dummy.scale.set(1, tall, 1);
          dummy.updateMatrix();
          stalks.setMatrixAt(i, dummy.matrix);
          dummy.position.y = 2.8 * tall;
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          tassels.setMatrixAt(i, dummy.matrix);
          i++;
        }
      }
    }
    stalks.count = i;
    tassels.count = i;
    stalks.instanceMatrix.needsUpdate = true;
    tassels.instanceMatrix.needsUpdate = true;
    this.worldRoot.add(stalks, tassels);
  }

  private addLadder(x: number, y: number, w: number, h: number, topZ: number): void {
    const rail = solidMat(0x6a7078);
    const rung = solidMat(0x8a9098);
    const tall = topZ * S;
    const cx = (x + w / 2) * S;
    const cz = (y + h / 2) * S;
    const alongX = w >= h;
    const railGap = 0.28;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, tall, 0.06), rail);
      if (alongX) post.position.set(cx + side * railGap, tall / 2, cz);
      else post.position.set(cx, tall / 2, cz + side * railGap);
      this.worldRoot.add(post);
    }
    const steps = Math.max(6, Math.floor(tall / 0.35));
    for (let i = 0; i < steps; i++) {
      const bar = new THREE.Mesh(
        alongX ? new THREE.BoxGeometry(railGap * 2 + 0.08, 0.04, 0.05) : new THREE.BoxGeometry(0.05, 0.04, railGap * 2 + 0.08),
        rung,
      );
      bar.position.set(cx, 0.2 + (i / Math.max(1, steps - 1)) * (tall - 0.3), cz);
      this.worldRoot.add(bar);
    }
  }

  /** Green outdoor ground. The house interior is left open. */
  private buildSurfaces(): void {
    const cell = map.cell * S;
    const skirt = 18;
    const hx0 = map.hersh.cx - 4.2 * 48 * HERSH_SCALE;
    const hx1 = map.hersh.cx + 4.2 * 48 * HERSH_SCALE;
    const hy0 = map.hersh.cy - 5.95 * 48 * HERSH_SCALE;
    const hy1 = map.hersh.cy + 5.95 * 48 * HERSH_SCALE;
    const inHouse = (x: number, y: number) => x > hx0 && x < hx1 && y > hy0 && y < hy1;

    const layers: { id: number; tex: THREE.Texture; y: number }[] = [
      { id: 0, tex: TEX_ASPHALT, y: 0 },
    ];
    for (const layer of layers) {
      const positions: number[] = [];
      const uvs: number[] = [];
      const push = (x0: number, z0: number, x1: number, z1: number, y: number) => {
        positions.push(
          x0, y, z0, x1, y, z0, x1, y, z1,
          x0, y, z0, x1, y, z1, x0, y, z1,
        );
        const u = (x: number) => x / 2.5;
        const v = (z: number) => z / 2.5;
        uvs.push(u(x0), v(z0), u(x1), v(z0), u(x1), v(z1), u(x0), v(z0), u(x1), v(z1), u(x0), v(z1));
      };
      if (layer.id === 0) {
        const x1 = WORLD_W * S;
        const z1 = WORLD_H * S;
        push(-skirt, -skirt, x1 + skirt, 0, 0);
        push(-skirt, z1, x1 + skirt, z1 + skirt, 0);
        push(-skirt, 0, 0, z1, 0);
        push(x1, 0, x1 + skirt, z1, 0);
      }
      for (let row = 0; row < map.rows; row++) {
        for (let col = 0; col < map.cols; col++) {
          const wx = (col + 0.5) * map.cell;
          const wy = (row + 0.5) * map.cell;
          if (inHouse(wx, wy)) continue;
          const x0 = col * cell;
          const z0 = row * cell;
          push(x0, z0, x0 + cell, z0 + cell, layer.y);
        }
      }
      if (!positions.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.computeVertexNormals();
      this.worldRoot.add(new THREE.Mesh(geo, groundMaterial(layer.tex)));
    }
  }

  private addBox(
    x: number, z: number, w: number, d: number, h: number,
    tex: THREE.Texture, roof: boolean, shingle = false,
  ): void {
    if (w < 0.02 || d < 0.02 || h < 0.02) return;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat(tex, Math.max(1, w), Math.max(1, h)));
    mesh.position.set(x + w / 2, h / 2, z + d / 2);
    this.worldRoot.add(mesh);
    if (roof) {
      if (shingle && w > 1.2 && d > 1.2) {
        // Simple gable ridge along the longer plan axis
        const alongX = w >= d;
        const ridge = Math.max(w, d) * 0.52;
        const span = Math.min(w, d) * 0.55;
        const peak = 0.55;
        for (const side of [-1, 1] as const) {
          const slope = new THREE.Mesh(
            new THREE.BoxGeometry(alongX ? ridge : span, 0.08, alongX ? span : ridge),
            mat(TEX_SHINGLE, 3, 2, 0x4a4e54),
          );
          slope.rotation[alongX ? "z" : "x"] = side * 0.42;
          slope.position.set(
            x + w / 2 + (alongX ? 0 : side * span * 0.22),
            h + peak * 0.35,
            z + d / 2 + (alongX ? side * span * 0.22 : 0),
          );
          this.worldRoot.add(slope);
        }
      } else {
        const top = new THREE.Mesh(
          new THREE.BoxGeometry(w * 1.02, 0.08, d * 1.02),
          solidMat(0x5a4030),
        );
        top.position.set(x + w / 2, h + 0.04, z + d / 2);
        this.worldRoot.add(top);
      }
    }
  }

  /** Derko's dark Ford Fusion sedan. */
  private addFusion(cx: number, cz: number, w: number, d: number, rot: number): void {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rot || 0;
    const body = solidMat(0x2a2c30);
    const glass = solidMat(0x1a2838);
    const chrome = solidMat(0xc8d0d8);
    const tire = solidMat(0x111111);
    const len = Math.max(w, 2.2);
    const wid = Math.max(d, 1.05);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(len, 0.42, wid), body);
    chassis.position.y = 0.38;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.55, 0.38, wid * 0.88), glass);
    cabin.position.set(-len * 0.05, 0.72, 0);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(len * 0.28, 0.12, wid * 0.9), body);
    hood.position.set(len * 0.28, 0.52, 0);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(len * 0.22, 0.14, wid * 0.9), body);
    trunk.position.set(-len * 0.32, 0.5, 0);
    g.add(chassis, cabin, hood, trunk);
    for (const [lx, lz] of [
      [len * 0.28, wid * 0.48],
      [len * 0.28, -wid * 0.48],
      [-len * 0.28, wid * 0.48],
      [-len * 0.28, -wid * 0.48],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10), tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(lx, 0.22, lz);
      g.add(wheel);
    }
    const grill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, wid * 0.7), chrome);
    grill.position.set(len * 0.48, 0.4, 0);
    g.add(grill);
    this.worldRoot.add(g);
  }

  private addYardTree(cx: number, cz: number): void {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.8, 6), solidMat(0x5a3a22));
    trunk.position.set(cx, 0.9, cz);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.35, 8, 8), solidMat(0x3a7a38));
    canopy.position.set(cx, 2.35, cz);
    const canopy2 = new THREE.Mesh(new THREE.SphereGeometry(0.95, 8, 8), solidMat(0x2e6a2e));
    canopy2.position.set(cx + 0.4, 2.1, cz - 0.3);
    this.worldRoot.add(trunk, canopy, canopy2);
  }

  private addTrampoline(cx: number, cz: number, diameter: number, variant: number): void {
    const colors = [0x2f7dff, 0xe23b3b, 0xf0c030];
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(diameter * 0.5, diameter * 0.52, 0.08, 20),
      solidMat(0x1a1c1e),
    );
    pad.position.set(cx, 0.06, cz);
    const mat = new THREE.Mesh(
      new THREE.CircleGeometry(diameter * 0.42, 20),
      solidMat(colors[variant % colors.length]),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(cx, 0.11, cz);
    this.worldRoot.add(pad, mat);
  }

  private addLampPost(cx: number, cz: number): void {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 6), solidMat(0x1a1a1a));
    pole.position.set(cx, 1.2, cz);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, 0.28), solidMat(0xf0e8c0));
    lamp.position.set(cx, 2.45, cz);
    this.worldRoot.add(pole, lamp);
  }

  private addChimney(cx: number, cz: number, size: number): void {
    const w = Math.max(0.55, size * 0.55);
    const stack = new THREE.Mesh(new THREE.BoxGeometry(w, 2.8, w), solidMat(0x8a4030));
    stack.position.set(cx, 2.4, cz);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.15, 0.12, w * 1.15), solidMat(0x6a3020));
    cap.position.set(cx, 3.85, cz);
    this.worldRoot.add(stack, cap);
  }

  private addArchedWindow(cx: number, cz: number, height: number): void {
    const h = Math.max(1.4, height * 0.55);
    const w = h * 0.72;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, w), solidMat(0xf0f0f0));
    frame.position.set(cx, h * 0.55 + 0.35, cz);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 0.85, w * 0.85), solidMat(0x6a90b0));
    glass.position.set(cx + 0.04, h * 0.55 + 0.35, cz);
    const arch = new THREE.Mesh(new THREE.SphereGeometry(w * 0.42, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), solidMat(0xf0f0f0));
    arch.rotation.x = -Math.PI / 2;
    arch.position.set(cx, h * 0.55 + 0.35 + h * 0.42, cz);
    this.worldRoot.add(frame, glass, arch);
  }

  private addWelcomeSign(x: number, z: number, width: number): void {
    const w = Math.max(width, 2.8);
    const h = 1.9;
    const postH = 1.7;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = Math.PI / 2;
    const postMat = solidMat(0x6a6a6a);
    const postGeo = new THREE.BoxGeometry(0.16, postH, 0.16);
    const left = new THREE.Mesh(postGeo, postMat);
    left.position.set(-w * 0.38, postH / 2, 0);
    const right = new THREE.Mesh(postGeo, postMat);
    right.position.set(w * 0.38, postH / 2, 0);
    root.add(left, right);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#5a3a22";
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#2a1810";
    ctx.fillRect(12, 12, 488, 232);
    ctx.fillStyle = "#f0e0b8";
    ctx.font = "bold 42px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("Welcome to", 256, 90);
    ctx.font = "bold 48px Georgia, serif";
    ctx.fillStyle = "#ffd070";
    ctx.fillText("Big Hersh's House", 256, 155);
    ctx.font = "28px Georgia, serif";
    ctx.fillStyle = "#c8b090";
    ctx.fillText("Derko's Attic upstairs", 256, 205);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    face.position.set(0, postH + h * 0.42, 0.02);
    root.add(face);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      solidMat(0x3a2414),
    );
    back.position.set(0, postH + h * 0.42, -0.02);
    back.rotation.y = Math.PI;
    root.add(back);
    this.worldRoot.add(root);
    this.signRoot = root;
    this.signWorld = { x: x / S, y: z / S };
    this.signBroken = false;
  }

  private addCallBillboard(x: number, z: number, width: number): void {
    const w = Math.max(width, 5.4);
    const h = w * 0.5;
    const postH = 2.4;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = Math.PI / 2;
    const postMat = solidMat(0x6a6a6a);
    const postGeo = new THREE.BoxGeometry(0.18, postH, 0.18);
    const left = new THREE.Mesh(postGeo, postMat);
    left.position.set(-w * 0.38, postH / 2, 0);
    const right = new THREE.Mesh(postGeo, postMat);
    right.position.set(w * 0.38, postH / 2, 0);
    root.add(left, right);

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 640;
    const ctx = canvas.getContext("2d")!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const paint = (img?: HTMLImageElement) => {
      ctx.fillStyle = "#c81e1e";
      ctx.fillRect(0, 0, 1280, 640);
      if (img) ctx.drawImage(img, 24, 24, 592, 592);
      ctx.fillStyle = "#fff4c8";
      ctx.textAlign = "center";
      ctx.font = "bold 52px Impact, Arial Black, sans-serif";
      ctx.fillText("FOR A GOOD TIME", 960, 230);
      ctx.fillText("CALL", 960, 310);
      ctx.font = "bold 58px Impact, Arial Black, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText("567.274.0137", 960, 450);
    };
    paint();
    const img = new Image();
    img.onload = () => {
      paint(img);
      tex.needsUpdate = true;
    };
    img.src = `${import.meta.env.BASE_URL}call-billboard.jpg`;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    face.position.set(0, postH + h * 0.42, 0.03);
    root.add(face);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), solidMat(0x3a2414));
    back.position.set(0, postH + h * 0.42, -0.03);
    back.rotation.y = Math.PI;
    root.add(back);
    this.worldRoot.add(root);
  }

  private buildGun(skin: string): void {
    for (const c of [...this.gunRoot.children]) {
      if (c !== this.muzzleFlash) this.gunRoot.remove(c);
    }
    if (!this.muzzleFlash.parent) this.gunRoot.add(this.muzzleFlash);

    if (skin === "hotdog") {
      const held = this.makeHotdogMesh();
      held.scale.setScalar(1.15);
      held.rotation.set(0.35, -0.4, 0.9);
      held.position.set(0.18, -0.16, -0.42);
      this.gunRoot.add(held);
      this.addGunHands(0.12, -0.22, -0.35, false);
      this.muzzleFlash.position.set(0.18, -0.12, -0.55);
      return;
    }
    if (skin === "cheese") {
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.28), solidMat(0xf0c040));
      block.position.set(0.14, -0.14, -0.48);
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), solidMat(0xd4a020));
      hole.position.set(0.18, -0.1, -0.42);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), solidMat(0xe8b830));
      barrel.position.set(0.14, -0.12, -0.72);
      this.gunRoot.add(block, hole, barrel);
      this.addGunHands(0.1, -0.22, -0.4, false);
      this.muzzleFlash.position.set(0.14, -0.12, -0.95);
      return;
    }
    if (skin === "pistol") {
      this.buildPistolView();
      return;
    }
    if (skin === "rocket") {
      this.buildGenericGun(skin);
      return;
    }
    // Default rifles / carbines / SMG / LMG / shotgun / sniper — AK-style primary look
    this.buildRifleView(skin);
  }

  /** Olive sleeves + fingerless tactical gloves (FPS viewmodel). */
  private addGunHands(gx: number, gy: number, gz: number, twoHand: boolean): void {
    const sleeve = solidMat(0x4a5a38);
    const glove = solidMat(0x1a1a1a);
    const skinTone = solidMat(0xd4a574);

    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.28, 6), sleeve);
    rightArm.rotation.z = 1.15;
    rightArm.rotation.x = 0.35;
    rightArm.position.set(gx + 0.16, gy - 0.08, gz + 0.12);
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.11), glove);
    rightHand.position.set(gx + 0.08, gy - 0.02, gz - 0.02);
    rightHand.rotation.set(0.2, 0.1, 0.4);
    const fingerR = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.07), skinTone);
    fingerR.position.set(gx + 0.05, gy + 0.01, gz - 0.08);
    this.gunRoot.add(rightArm, rightHand, fingerR);

    if (twoHand) {
      const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.32, 6), sleeve);
      leftArm.rotation.set(0.5, 0, -0.9);
      leftArm.position.set(gx - 0.18, gy - 0.06, gz - 0.05);
      const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.1), glove);
      leftHand.position.set(gx - 0.02, gy - 0.04, gz - 0.18);
      leftHand.rotation.set(0.35, -0.2, -0.5);
      const fingerL = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.06), skinTone);
      fingerL.position.set(gx - 0.04, gy - 0.01, gz - 0.24);
      this.gunRoot.add(leftArm, leftHand, fingerL);
    } else {
      const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.3, 6), sleeve);
      leftArm.rotation.set(0.2, 0, -1.1);
      leftArm.position.set(gx - 0.14, gy - 0.02, gz - 0.22);
      const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.1), glove);
      leftHand.position.set(gx + 0.02, gy - 0.02, gz - 0.38);
      leftHand.rotation.set(0.15, 0, -0.3);
      this.gunRoot.add(leftArm, leftHand);
    }
  }

  private buildRifleView(skin: string): void {
    const wood = solidMat(0xb05028);
    const woodDark = solidMat(0x8a3a18);
    const metal = solidMat(0x2e2e2c);
    const metalLite = solidMat(0x3a3a38);
    const long =
      skin === "sniper" ? 1.05
        : skin === "shotgun" ? 0.72
          : skin === "smg" ? 0.58
            : skin === "lmg" ? 0.85
              : 0.78;

    const g = new THREE.Group();
    g.position.set(0.12, -0.16, -0.2);

    // Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.34), wood);
    stock.position.set(0, -0.02, 0.22);
    stock.rotation.x = 0.08;
    const stockToe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.08), woodDark);
    stockToe.position.set(0, -0.04, 0.38);
    // Receiver
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.38), metal);
    receiver.position.set(0, 0.01, -0.08);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.28), metalLite);
    cover.position.set(0, 0.08, -0.06);
    // Handguard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.28), wood);
    guard.position.set(0, 0.0, -0.38);
    // Gas tube
    const gas = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 6), metal);
    gas.rotation.x = Math.PI / 2;
    gas.position.set(0, 0.07, -0.42);
    // Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, long * 0.55, 8), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.55 - long * 0.22);
    // Mag (curved AK look via tilted box)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), metal);
    mag.position.set(0, -0.14, -0.12);
    mag.rotation.x = 0.35;
    // Grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.08), metal);
    grip.position.set(0, -0.12, 0.06);
    grip.rotation.x = 0.45;
    // Sights
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.04), metal);
    rear.position.set(0, 0.1, -0.02);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), metal);
    front.position.set(0, 0.08, -0.55 - long * 0.2);

    g.add(stock, stockToe, receiver, cover, guard, gas, barrel, mag, grip, rear, front);

    if (skin === "sniper") {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), metal);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.12, -0.28);
      g.add(scope);
    }
    if (skin === "shotgun") {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.2), woodDark);
      pump.position.set(0, -0.02, -0.42);
      g.add(pump);
    }
    if (skin === "lmg") {
      const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), metal);
      bipod.position.set(0, -0.08, -0.7);
      g.add(bipod);
    }

    this.gunRoot.add(g);
    this.addGunHands(0.12, -0.18, -0.35, false);
    this.muzzleFlash.position.set(0.12, -0.14, -0.55 - long * 0.45);
  }

  private buildPistolView(): void {
    const metal = solidMat(0x3a3a3c);
    const dark = solidMat(0x222224);
    const gripMat = solidMat(0x2a2a28);
    const g = new THREE.Group();
    g.position.set(0.1, -0.14, -0.35);

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.28), metal);
    slide.position.set(0, 0.04, -0.08);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.07, 0.22), dark);
    frame.position.set(0, -0.02, -0.04);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.28);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), gripMat);
    grip.position.set(0, -0.12, 0.04);
    grip.rotation.x = 0.25;
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.03), metal);
    hammer.position.set(0, 0.06, 0.08);
    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), dark);
    rearSight.position.set(0, 0.09, 0.02);
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.015), dark);
    frontSight.position.set(0, 0.09, -0.2);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), dark);
    trigger.position.set(0, -0.05, -0.02);

    g.add(slide, frame, barrel, grip, hammer, rearSight, frontSight, trigger);
    this.gunRoot.add(g);
    this.addGunHands(0.08, -0.16, -0.32, true);
    this.muzzleFlash.position.set(0.1, -0.12, -0.72);
  }

  private buildGenericGun(skin: string): void {
    const dark = solidMat(0x2a2a28);
    const wood = solidMat(0x6a4a28);
    const metal = solidMat(0x4a4a48);
    const accent = solidMat(0x8a3020);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.28), wood);
    stock.position.set(0.08, -0.18, -0.25);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.42), dark);
    body.position.set(0.1, -0.14, -0.52);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, 10), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0.1, -0.12, -0.7);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.1), accent);
    mag.position.set(0.1, -0.28, -0.48);
    this.gunRoot.add(stock, body, tube, mag);
    this.addGunHands(0.1, -0.2, -0.4, false);
    this.muzzleFlash.position.set(0.1, -0.1, -1.1);
  }

  private resize(): void {
    const parent = this.root.parentElement;
    const w = Math.max(320, parent?.clientWidth || window.innerWidth);
    const h = Math.max(240, parent?.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.overlay.width = w;
    this.overlay.height = h;
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
  }

  private frame(ts: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.driftClouds(dt);
    this.tick(dt);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private tick(dt: number): void {
    const state = this.session.state;
    const me = this.session.mine;
    if (!state || !me) return;
    if (me.alive === 0 && this.prevAlive !== 0) {
      this.explodeBody(this.makeSoldier(), this.floorZ, this.origin(me).x, this.origin(me).y);
      this.spectateId = "";
    }
    if (me.alive !== 1 || this.forceSpectate) {
      this.pred.ready = false;
      if (mouse.left && !this.specLeft) this.cycleSpectate(1);
      if (mouse.right && !this.specRight) this.cycleSpectate(-1);
    }
    this.specLeft = mouse.left;
    this.specRight = mouse.right;
    this.prevAlive = me.alive;
    const typing =
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLSelectElement;
    // Esc handled by onEscKey / pointerlockchange — don't double-toggle here.
    this.stepClimb(me, dt, typing || serverMenuOpen());
    const input = this.readInput(me, typing || serverMenuOpen());
    if (state.phase === "play" && me.alive === 1 && !this.forceSpectate) {
      if (serverMenuOpen()) {
        this.session.input({
          ...input, fire: false, mx: 0, my: 0, throttle: 0, steer: 0, brake: false, boost: false,
        });
      } else this.session.input(input);
    }
    this.predict(me, dt, input);
    this.stepJump(me, dt, typing || serverMenuOpen());
    if (me.alive === 1 && mouse.left && me.weaponSlot !== 4) this.gunKick = Math.max(this.gunKick, 0.45);
    this.gunKick = Math.max(0, this.gunKick - dt * 7);
    const flashMat = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    flashMat.opacity = Math.max(0, flashMat.opacity - dt * 12);
    const moving = Math.hypot(input.mx, input.my) > 0.1 || Math.abs(input.throttle) > 0.1;
    const sprinting = !!input.sprint && me.seat < 0 && moving;
    this.bob += dt * (sprinting ? 14 : moving ? 9 : 1.4);
    const watching = this.forceSpectate || me.alive !== 1;
    this.watch = watching ? this.spectateOf(me) : null;
    this.syncEntities(me, dt);
    this.syncDoors(dt);
    if (this.watch) this.applySpectate(this.watch, dt);
    else this.updateCamera(me, dt, input);
    this.syncGun(this.watch ?? me);
    if (me.alive !== 1 && !this.watch) this.gunRoot.visible = false;
    if (this.forceSpectate && me.alive === 1 && !this.watch) this.gunRoot.visible = false;
    this.stepDebris(dt);
    this.pruneTracers();
    this.pruneSplats();
    this.drawOverlay(me);
    this.renderer.render(this.scene, this.camera);
    updateHud(this.session, {
      prompt: this.prompt(me),
      pause: keys.has("Escape"),
      score: bindDown(loadPrefs().binds.score),
      spectate: this.watch
        ? `SPECTATING ${this.watch.name}    SCROLL OR CLICK TO SWITCH`
        : (this.forceSpectate || me.alive !== 1) ? "SPECTATOR    WAITING FOR A PLAYER" : "",
    });
    audio.motor(this.ridden(me)?.speed ?? 0, me.seat === 0 && me.alive === 1);
  }

  private pruneTracers(): void {
    const now = performance.now();
    this.tracers = this.tracers.filter((t) => {
      const life = t.until - now;
      if (life > 0) {
        t.mesh.traverse((obj) => {
          const m = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m && "opacity" in m) m.opacity = Math.min(m.opacity, Math.max(0.05, life / 140));
        });
        return true;
      }
      this.worldRoot.remove(t.mesh);
      t.mesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      return false;
    });
  }

  private pruneSplats(): void {
    const now = performance.now();
    this.splats = this.splats.filter((s) => {
      if (s.until > now) {
        const life = (s.until - now) / 4500;
        s.mesh.traverse((obj) => {
          const m = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m && "opacity" in m && life < 0.35) m.opacity = Math.max(0, life / 0.35) * 0.9;
        });
        return true;
      }
      this.worldRoot.remove(s.mesh);
      return false;
    });
  }

  private stepJump(me: SyncPlayer, dt: number, blocked: boolean): void {
    if (me.alive !== 1 || me.seat >= 0 || blocked) {
      this.jumpY = 0;
      this.jumpVel = 0;
      this.jumpHeld = keys.has(loadPrefs().binds.brake);
      return;
    }
    const want = keys.has(loadPrefs().binds.brake);
    if (want && !this.jumpHeld && this.jumpY <= 0.001) this.jumpVel = JUMP_V;
    this.jumpHeld = want;
    this.jumpVel -= JUMP_G * dt;
    this.jumpY += this.jumpVel * dt;
    const pos = this.origin(me);
    const roof = roofAt(map, pos.x, pos.y, 64);
    if (roof && this.jumpVel < 0) {
      const hz = roofHeight(roof, pos.x, pos.y);
      const feet = this.floorZ + this.jumpY * WORLD_PER_M;
      const prevFeet = this.floorZ + (this.jumpY - this.jumpVel * dt) * WORLD_PER_M;
      if (prevFeet >= hz - 12 && feet <= hz + 24) {
        this.floorZ = hz;
        this.jumpY = 0;
        this.jumpVel = 0;
        return;
      }
    }
    if (this.jumpY <= 0) {
      this.jumpY = 0;
      this.jumpVel = 0;
    }
    if (this.jumpY <= 0.001 && this.onTrampoline()) this.jumpVel = TRAMP_V;
  }

  private onTrampoline(): boolean {
    if (this.floorZ > 24) return false;
    const pos = this.origin(this.session.mine!);
    for (const pad of map.decor) {
      if (pad.kind !== "trampoline") continue;
      const r = Math.max(pad.w, pad.h) * 0.42;
      if (Math.hypot(pos.x - pad.x, pos.y - pad.y) <= r) return true;
    }
    return false;
  }

  private stepClimb(me: SyncPlayer, dt: number, blocked: boolean): void {
    if (me.alive !== 1 || me.seat >= 0 || blocked) {
      if (me.seat >= 0) {
        const ride = me.vehicleId ? this.session.state?.vehicles.get(me.vehicleId) : undefined;
        this.floorZ = ride?.kind === "heli" ? ride.z : 0;
      }
      this.climbing = false;
      return;
    }
    if (this.jumpY > 0.2) {
      this.climbing = false;
      return;
    }
    const pos = this.origin(me);
    const lad = ladderAt(map, pos.x, pos.y, 22);
    const roof = roofAt(map, pos.x, pos.y, 64);
    const prefs = loadPrefs();
    const up = keys.has(prefs.binds.up) || keys.has("ArrowUp");
    const down = keys.has(prefs.binds.down) || keys.has("ArrowDown");

    if (lad) {
      this.climbing = true;
      const dir = (up ? 1 : 0) + (down ? -1 : 0);
      this.floorZ = Math.max(0, Math.min(lad.topZ, this.floorZ + dir * 95 * dt));
      if (this.floorZ >= lad.topZ - 20) {
        const stand = roofAt(map, pos.x, pos.y, 56);
        if (stand) this.floorZ = roofHeight(stand, pos.x, pos.y);
      }
      return;
    }
    this.climbing = false;
    const deck = floorUnder(map, pos.x, pos.y, this.floorZ, 20);
    const stand = roof;
    const hz = stand ? roofHeight(stand, pos.x, pos.y) : 0;
    if (stand && Math.abs(this.floorZ - hz) <= 56 && this.floorZ >= hz - 24) {
      this.floorZ = hz;
      return;
    }
    const onInterior = !!deck && (!stand || Math.abs(this.floorZ - deck.z) <= Math.abs(this.floorZ - hz) + 12);
    if (deck && onInterior) {
      if (deck.z + 8 >= this.floorZ) this.floorZ = deck.z;
      else this.floorZ = Math.max(deck.z, this.floorZ - 220 * dt);
      return;
    }
    if (stand && Math.abs(this.floorZ - hz) <= 36 && this.floorZ >= hz - 28) {
      this.floorZ = hz;
      return;
    }
    if (this.floorZ > 0) {
      this.floorZ = Math.max(0, this.floorZ - 220 * dt);
    }
  }

  enterSpectate(): void {
    this.forceSpectate = true;
    this.spectateId = "";
  }

  rejoin(): void {
    this.forceSpectate = false;
    this.spectateId = "";
    this.watch = null;
    const me = this.session.mine;
    if (me && me.alive !== 1) this.session.send("rejoin", {});
  }

  private livingPlayers(me: SyncPlayer): SyncPlayer[] {
    const humans: SyncPlayer[] = [];
    const bots: SyncPlayer[] = [];
    this.session.state?.players.forEach((p) => {
      if (p.id === me.id || p.alive !== 1) return;
      if (p.bot) bots.push(p);
      else humans.push(p);
    });
    return humans.length ? humans : bots;
  }

  private spectateOf(me: SyncPlayer): SyncPlayer | null {
    const list = this.livingPlayers(me);
    if (!list.length) return null;
    const current = list.find((p) => p.id === this.spectateId);
    if (current) return current;
    const killer = list.find((p) => p.name === me.killerName);
    const next = killer ?? list[0];
    this.spectateId = next.id;
    return next;
  }

  private cycleSpectate(dir: number): void {
    const me = this.session.mine;
    if (!me || (me.alive === 1 && !this.forceSpectate)) return;
    const list = this.livingPlayers(me);
    if (!list.length) return;
    const at = list.findIndex((p) => p.id === this.spectateId);
    const next = list[(Math.max(0, at) + dir + list.length) % list.length];
    this.spectateId = next.id;
    this.watch = next;
  }

  /** First person on another player: their position, aim, and pitch. */
  private applySpectate(p: SyncPlayer, dt: number): void {
    const ghost = this.ghosts.get(p.id);
    const sample = ghost?.samples.length ? this.sample(ghost) : null;
    const x = sample?.x ?? p.x;
    const y = sample?.y ?? p.y;
    const feet = sample?.z ?? p.floorZ + (p.jumpZ || 0);
    const aim = sample?.aim ?? p.aim;
    const pitch = sample?.pitch ?? p.pitch ?? 0;
    const ride = p.vehicleId ? this.session.state?.vehicles.get(p.vehicleId) : undefined;
    const seatEye = p.seat < 0 ? 0 : ride?.kind === "heli" ? 0.25 : BIKE_EYE;
    this.camera.position.set(x * S, EYE + feet * S + seatEye, y * S);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = -(aim + Math.PI / 2);
    this.camera.rotation.x = pitch;
    this.camera.rotation.z = 0;
    this.targetFov = 72;
    this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();
  }

  private seenFrom(viewer: SyncPlayer, other: SyncPlayer): boolean {
    if (other.alive === 0) return false;
    const dist = Math.hypot(other.x - viewer.x, other.y - viewer.y);
    if (dist < 140) return true;
    for (const wall of map.buildings) {
      if (segmentHitsRect(viewer.x, viewer.y, other.x, other.y, wall)) return false;
    }
    return dist < 2200;
  }

  private updateCamera(me: SyncPlayer, dt: number, input: MoveInput): void {
    const eye = this.origin(me);
    const ride = me.vehicleId ? this.session.state?.vehicles.get(me.vehicleId) : undefined;
    const flying = ride?.kind === "heli";
    const pitch = this.pitch;
    const crouch = !!input.crouch && me.seat < 0;
    const moving = Math.hypot(input.mx, input.my) > 0.1;
    const sprinting = !!input.sprint && me.seat < 0 && moving && !crouch;
    const bobAmp = me.seat >= 0 ? 0.015 : sprinting ? 0.07 : crouch ? 0.02 : 0.04;
    const bobY = Math.sin(this.bob) * bobAmp;
    const crouchDrop = crouch ? 0.55 : 0;
    const seatEye = me.seat < 0 ? 0 : ride?.kind === "heli" ? 0.25 : BIKE_EYE;
    const eyeY = EYE - crouchDrop + bobY + this.jumpY + this.floorZ * S + seatEye;
    this.camera.position.set(eye.x * S, eyeY, eye.y * S);
    // YXZ: +X looks up. Same sign the server uses, so the crosshair and the bullet match.
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = -this.yaw;
    this.camera.rotation.x = pitch;
    this.camera.rotation.z = 0;

    const def = CLASSES[me.classId as ClassId];
    const slotted = def ? slotWeapon(def, me.weaponSlot || 1) : null;
    const sniper = slotted === "sniper" && me.weaponSlot === 1;
    let fov = 72;
    if (sprinting) fov = 80;
    if (input.ads && me.seat < 0) fov = sniper ? 28 : 55;
    this.targetFov = fov;
    this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();
  }

  private syncGun(me: SyncPlayer): void {
    const ride = me.vehicleId ? this.session.state?.vehicles.get(me.vehicleId) : undefined;
    const heliPilot = me.seat === 0 && ride?.kind === "heli";
    const def = CLASSES[me.classId as ClassId];
    const slotted = def ? slotWeapon(def, me.weaponSlot || 1) : null;
    const skin = heliPilot ? "smg"
      : me.weaponSlot === 4 ? "hotdog"
        : me.weaponSlot === 5 ? "cheese"
        : slotted === "barricade" ? "barricade"
          : slotted === "rocket" ? "rocket"
            : slotted === "sniper" ? "sniper"
              : slotted === "pistol" ? "pistol"
                : slotted === "lmg" ? "lmg"
                  : slotted === "smg" ? "smg"
                    : slotted === "shotgun" ? "shotgun"
                      : "rifle";
    if (skin !== this.gunSkin) {
      this.gunSkin = skin;
      this.buildGun(skin);
    }
    const bobX = Math.cos(this.bob * 0.5) * 0.012;
    const bobY = 0.02 + this.gunKick * 0.06 + Math.sin(this.bob) * 0.008;
    const ads = mouse.right && me.seat < 0;
    // ADS pulls the viewmodel toward the crosshair axis so the muzzle tracks aim.
    if (ads) {
      this.gunRoot.position.set(0.06 + bobX * 0.3, -0.14 - bobY * 0.5, -0.42 - this.gunKick * 0.03);
      this.gunRoot.rotation.set(0.02 + this.gunKick * 0.08, -0.04, -0.02);
    } else {
      this.gunRoot.position.set(0.16 + bobX, -0.18 - bobY, -0.38 - this.gunKick * 0.04);
      this.gunRoot.rotation.set(0.02 + this.gunKick * 0.08, -0.06, -0.02);
    }
    this.gunRoot.visible = me.alive === 1;
  }

  private handleLook(e: MouseEvent): void {
    if (!this.pointerLocked || serverMenuOpen()) return;
    this.yaw += e.movementX * LOOK_SENS;
    // Positive pitch = look up (matches server MoveInput / hitscan).
    this.pitch -= e.movementY * LOOK_SENS;
    this.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.pitch));
  }

  private requestLock(): void {
    if (serverMenuOpen()) return;
    if (!this.pointerLocked) void this.canvasHost.requestPointerLock();
  }

  private handleWheel(event: WheelEvent): void {
    const me = this.session.mine;
    if (me && (me.alive !== 1 || this.forceSpectate) && !serverMenuOpen()) {
      event.preventDefault();
      const now = performance.now();
      this.wheelPending += event.deltaY;
      if (now - this.wheelAt < WHEEL_COOLDOWN_MS) return;
      if (Math.abs(this.wheelPending) < 20) return;
      const dir = this.wheelPending > 0 ? 1 : -1;
      this.wheelPending = 0;
      this.wheelAt = now;
      this.cycleSpectate(dir);
      return;
    }
    if (!this.pointerLocked || serverMenuOpen()) return;
    event.preventDefault();
    if (!me || me.alive !== 1) return;
    const def = CLASSES[me.classId as ClassId];
    if (!def) return;
    const slots: number[] = [];
    if (def.primary) slots.push(1);
    if (def.secondary) slots.push(2);
    if (def.special) slots.push(3);
    if (def.grenades > 0) slots.push(4);
    slots.push(5); // cheese gun
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
    const rideEarly = me.vehicleId ? this.session.state?.vehicles.get(me.vehicleId) : undefined;
    const aim = look.aim;
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
    if (down(b.slot4)) slot = 4;
    if (down(b.slot5)) slot = 5;
    if (this.wheelSlot) {
      slot = this.wheelSlot;
      this.wheelSlot = 0;
    }
    const throttle = (down(b.up) || down("ArrowUp") ? 1 : 0) + (down(b.down) || down("ArrowDown") ? -1 : 0);
    const steer = (down(b.right) || down("ArrowRight") ? 1 : 0) + (down(b.left) || down("ArrowLeft") ? -1 : 0);
    const onBike = me.seat >= 0;
    const ride = rideEarly;
    const flying = ride?.kind === "heli";
    const crouching = !onBike && down(b.crouch);
    const pitch = this.pitch;
    return {
      seq: this.seq++,
      mx, my, aim, ax, ay, throttle, steer,
      pitch,
      jumpZ: onBike ? 0 : this.jumpY * WORLD_PER_M,
      floorZ: flying ? (ride?.z ?? this.floorZ) : onBike ? 0 : this.floorZ,
      crouch: flying ? down(b.crouch) : crouching,
      fire: !typing && mouse.left,
      // Hold state — server rising-edge latch is more reliable than a 1-frame edge over the net
      reload: reload.edge, ability: ability.edge, grenade: grenade.now, interact: interact.edge,
      sprint: !crouching && down(b.sprint), boost: down(b.sprint),
      brake: onBike && down(b.brake),
      ads: mouse.right, slot,
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
      const err2 = dx * dx + dy * dy;
      const feetZ = this.floorZ + this.jumpY * WORLD_PER_M;
      const walk = walkSolids(map, this.pred.x, this.pred.y, this.floorZ, this.jumpY * WORLD_PER_M, this.localSolids());
      const inside = walk.some((s) => circleHitsRect(this.pred.x, this.pred.y, 15, s));
      if (inside || err2 > 96 * 96) {
        this.pred.x = me.x;
        this.pred.y = me.y;
      } else if (err2 > 28 * 28) {
        const t = Math.min(0.2, dt * 3);
        this.pred.x += dx * t;
        this.pred.y += dy * t;
      }
      let speed = def.speed;
      if (input.sprint) speed *= 1.45;
      if (input.ads) speed *= 0.74;
      this.pred.acc += dt;
      while (this.pred.acc >= SIM_DT) {
        this.pred.acc -= SIM_DT;
        const env = {
          dt: SIM_DT,
          solids: walkSolids(map, this.pred.x, this.pred.y, this.floorZ, feetZ - this.floorZ, this.localSolids()),
          blocked: (x: number, y: number) => blockedAt(map, x, y),
          footMul: (x: number, y: number) => footMul(map, x, y),
          bikeMul: () => 1,
        };
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

  private makeSoldier(): THREE.Group {
    const g = new THREE.Group();
    g.name = "cheezit";
    const orange = solidMat(0xf07818);
    const orangeDark = solidMat(0xd45810);
    const white = solidMat(0xfff8ee);
    const black = solidMat(0x1a1a1a);
    const gunMetal = solidMat(0x2a2a28);
    const wood = solidMat(0x6a4a28);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 6, 10), orange);
    body.position.y = 1.05;
    body.scale.set(1.2, 1, 0.86);
    body.name = "body";

    const salt = (x: number, y: number, z: number) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.05), orangeDark);
      s.position.set(x, y, z);
      return s;
    };

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), white);
    eyeL.position.set(-0.12, 1.28, 0.3);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), white);
    eyeR.position.set(0.13, 1.28, 0.3);
    const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), black);
    pupilL.position.set(-0.1, 1.28, 0.37);
    const pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), black);
    pupilR.position.set(0.15, 1.28, 0.37);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.04), black);
    brow.position.set(0.01, 1.4, 0.32);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 6, 8, Math.PI), black);
    smile.position.set(0.01, 1.08, 0.3);
    smile.rotation.z = Math.PI;

    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.32, 7), orange);
    armL.position.set(-0.42, 1.12, 0.02);
    armL.rotation.z = 0.7;
    const foreL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 7), orange);
    foreL.position.set(-0.58, 0.9, 0.08);
    foreL.rotation.z = 0.35;
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 7), orangeDark);
    handL.position.set(-0.64, 0.76, 0.12);

    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 7), orange);
    armR.position.set(0.38, 1.16, 0.16);
    armR.rotation.set(1.15, 0.2, -0.45);
    const foreR = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 7), orange);
    foreR.position.set(0.42, 1.02, 0.38);
    foreR.rotation.x = 1.35;
    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 7), orangeDark);
    handR.position.set(0.4, 0.98, 0.52);

    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.42, 7), orange);
    legL.position.set(-0.14, 0.42, 0.02);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.42, 7), orange);
    legR.position.set(0.15, 0.42, 0.02);
    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.28), white);
    shoeL.position.set(-0.14, 0.16, 0.06);
    const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.28), white);
    shoeR.position.set(0.15, 0.16, 0.06);

    const gun = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.36), gunMetal);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.34), gunMetal);
    barrel.position.z = 0.32;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), wood);
    grip.position.set(0, -0.08, -0.04);
    grip.rotation.x = -0.35;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.07), gunMetal);
    mag.position.set(0, -0.1, 0.04);
    gun.add(receiver, barrel, grip, mag);
    gun.position.set(0.4, 0.96, 0.58);

    g.add(
      body,
      salt(-0.16, 1.42, 0.28), salt(0.18, 1.18, 0.28), salt(-0.08, 0.86, 0.26),
      eyeL, eyeR, pupilL, pupilR, brow, smile,
      armL, foreL, handL, armR, foreR, handR,
      legL, legR, shoeL, shoeR, gun,
    );
    return g;
  }

  private makeDerl(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 4, 8), solidMat(0x6a2040));
    body.position.y = 0.95;
    body.name = "body";
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8), solidMat(0xd4a574));
    head.position.y = 1.7;
    g.add(body, head);
    return g;
  }

  /** Mr. Cheese Curl mascot — orange puff body, pink hat, blue sneakers. */
  private makeCheeseCurl(): THREE.Group {
    const g = new THREE.Group();
    g.name = "cheese-curl";
    const orange = solidMat(0xf07820);
    const orangeDark = solidMat(0xd45810);
    const pink = solidMat(0xe85878);
    const white = solidMat(0xf8f8f8);
    const black = solidMat(0x1a1a1a);
    const blue = solidMat(0x2a6ad4);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.85, 6, 10), orange);
    body.position.y = 1.05;
    body.rotation.z = 0.18;
    body.name = "body";
    const bump = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), orangeDark);
    bump.position.set(0.12, 1.35, 0.18);
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.42), pink);
    hat.position.set(0.05, 1.72, 0);
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), white);
    eyeL.position.set(-0.12, 1.28, 0.32);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), white);
    eyeR.position.set(0.14, 1.28, 0.32);
    const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), black);
    pupilL.position.set(-0.1, 1.28, 0.4);
    const pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), black);
    pupilR.position.set(0.16, 1.28, 0.4);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.04), black);
    brow.position.set(0.02, 1.42, 0.34);

    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 6), black);
    armL.position.set(-0.42, 1.05, 0.05);
    armL.rotation.z = 0.9;
    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), black);
    armR.position.set(0.45, 1.05, 0.1);
    armR.rotation.z = -1.1;
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), black);
    handL.position.set(-0.62, 0.82, 0.05);
    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), black);
    handR.position.set(0.68, 0.85, 0.15);

    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6), black);
    legL.position.set(-0.12, 0.35, 0.05);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6), black);
    legR.position.set(0.16, 0.35, -0.05);
    legR.rotation.x = 0.4;
    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.32), blue);
    shoeL.position.set(-0.12, 0.1, 0.08);
    const soleL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.34), white);
    soleL.position.set(-0.12, 0.04, 0.08);
    const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.32), blue);
    shoeR.position.set(0.16, 0.12, 0.12);
    const soleR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.34), white);
    soleR.position.set(0.16, 0.06, 0.12);

    g.add(
      body, bump, hat, eyeL, eyeR, pupilL, pupilR, brow,
      armL, armR, handL, handR, legL, legR, shoeL, soleL, shoeR, soleR,
    );
    return g;
  }

  private makeBike(): THREE.Group {
    const g = new THREE.Group();
    const yellow = solidMat(0xf0c020);
    const yellowDark = solidMat(0xd4a010);
    const black = solidMat(0x1a1a1a);
    const rim = solidMat(0xc8d0d8);
    const hub = solidMat(0x2a2a2a);

    const wheel = (x: number, z: number) => {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 16), black);
      tire.rotation.y = Math.PI / 2;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), rim);
      disc.rotation.z = Math.PI / 2;
      const center = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), hub);
      center.rotation.z = Math.PI / 2;
      w.add(tire, disc, center);
      w.position.set(x, 0.28, z);
      return w;
    };
    g.add(wheel(0, 0.55), wheel(0, -0.55));

    // Step-through frame (chunky yellow)
    const down = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7), yellow);
    down.position.set(0, 0.38, 0.05);
    down.rotation.x = 0.35;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.45), yellow);
    top.position.set(0, 0.62, -0.15);
    top.rotation.x = -0.15;
    const seatTube = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.38, 0.09), yellow);
    seatTube.position.set(0, 0.55, -0.35);
    const headTube = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.1), yellow);
    headTube.position.set(0, 0.58, 0.42);
    g.add(down, top, seatTube, headTube);

    // Rear rack
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.32), yellowDark);
    rack.position.set(0, 0.72, -0.55);
    const rackPostL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04), yellow);
    rackPostL.position.set(-0.1, 0.58, -0.55);
    const rackPostR = rackPostL.clone();
    rackPostR.position.x = 0.1;
    g.add(rack, rackPostL, rackPostR);

    // Battery on downtube
    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.32), black);
    battery.position.set(0, 0.42, 0.08);
    battery.rotation.x = 0.35;
    g.add(battery);

    // Crank / hub motor housing
    const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12), black);
    crank.rotation.z = Math.PI / 2;
    crank.position.set(0, 0.3, 0);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.06), black);
    pedal.position.set(0.14, 0.28, 0);
    g.add(crank, pedal);

    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.28), black);
    seat.position.set(0, 0.82, -0.32);
    seat.rotation.x = -0.2;
    g.add(seat);

    // Handlebars
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), black);
    stem.position.set(0, 0.78, 0.42);
    const bars = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.04), black);
    bars.position.set(0, 0.9, 0.42);
    const gripL = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6), black);
    gripL.rotation.z = Math.PI / 2;
    gripL.position.set(-0.28, 0.9, 0.42);
    const gripR = gripL.clone();
    gripR.position.x = 0.28;
    g.add(stem, bars, gripL, gripR);

    // Front basket / headlight box
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.22), yellow);
    basket.position.set(0, 0.72, 0.62);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), solidMat(0xf8f0c8));
    light.position.set(0, 0.72, 0.74);
    g.add(basket, light);

    // Fenders
    const fenderF = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 12, Math.PI * 0.7), yellow);
    fenderF.rotation.set(0, Math.PI / 2, 0.2);
    fenderF.position.set(0, 0.36, 0.55);
    const fenderR = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 12, Math.PI * 0.7), yellow);
    fenderR.rotation.set(0, Math.PI / 2, -0.15);
    fenderR.position.set(0, 0.36, -0.55);
    g.add(fenderF, fenderR);

    g.scale.setScalar(1.15);
    return g;
  }

  private makeHeli(): THREE.Group {
    const g = new THREE.Group();
    const olive = solidMat(0x5c6b3a);
    const dark = solidMat(0x2c3324);
    const glass = new THREE.MeshLambertMaterial({ color: 0xb7d7ea, transparent: true, opacity: 0.72 });
    const black = solidMat(0x141414);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.85, 1.7), olive);
    cabin.position.set(0, 1.15, 0.15);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.55, 0.7), olive);
    nose.position.set(0, 1.05, 1.15);
    const window = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.38, 0.08), glass);
    window.position.set(0, 1.28, 1.48);
    g.add(cabin, nose, window);

    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.8), olive);
    boom.position.set(0, 1.25, -1.35);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.45), dark);
    fin.position.set(0, 1.55, -2.15);
    g.add(boom, fin);

    const skid = (x: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 2.1), black);
      bar.position.set(x, 0.18, 0.1);
      const postA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), black);
      postA.position.set(x, 0.42, 0.45);
      const postB = postA.clone();
      postB.position.z = -0.35;
      g.add(bar, postA, postB);
    };
    skid(-0.55);
    skid(0.55);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8), dark);
    mast.position.set(0, 1.75, 0.05);
    g.add(mast);
    const rotor = new THREE.Group();
    rotor.name = "rotor";
    const bladeA = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.04, 0.18), black);
    const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 4.4), black);
    rotor.add(bladeA, bladeB);
    rotor.position.set(0, 1.95, 0.05);
    g.add(rotor);

    const tailRotor = new THREE.Group();
    tailRotor.name = "tailRotor";
    const tBlade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.08), black);
    tailRotor.add(tBlade);
    tailRotor.position.set(0.16, 1.55, -2.15);
    g.add(tailRotor);
    const podL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.55), dark);
    podL.position.set(-0.55, 0.72, 0.85);
    const podR = podL.clone();
    podR.position.x = 0.55;
    g.add(podL, podR);

    const sideTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}heli-side.jpg`);
    sideTex.colorSpace = THREE.SRGBColorSpace;
    const sideMat = new THREE.MeshBasicMaterial({ map: sideTex });
    const sideH = 0.82;
    const sideW = sideH * (747 / 1024);
    const sideL = new THREE.Mesh(new THREE.PlaneGeometry(sideW, sideH), sideMat);
    sideL.position.set(-0.7, 1.15, 0.2);
    sideL.rotation.y = -Math.PI / 2;
    const sideR = new THREE.Mesh(new THREE.PlaneGeometry(sideW, sideH), sideMat);
    sideR.position.set(0.7, 1.15, 0.2);
    sideR.rotation.y = Math.PI / 2;
    g.add(sideL, sideR);
    return g;
  }

  private makeCar(): THREE.Group {
    const g = new THREE.Group();
    const fusionTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}fusion-tex.png`);
    fusionTex.colorSpace = THREE.SRGBColorSpace;
    const body = new THREE.MeshBasicMaterial({ map: fusionTex });
    const glass = solidMat(0x1a2838);
    const chrome = solidMat(0xc8d0d8);
    const tire = solidMat(0x111111);
    const len = 4.6;
    const wid = 1.9;
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.42, len), body);
    chassis.position.y = 0.38;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.88, 0.38, len * 0.5), glass);
    cabin.position.set(0, 0.72, -0.15);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.9, 0.12, len * 0.28), body);
    hood.position.set(0, 0.52, len * 0.28);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.9, 0.14, len * 0.2), body);
    trunk.position.set(0, 0.5, -len * 0.32);
    g.add(chassis, cabin, hood, trunk);
    for (const [lx, lz] of [
      [wid * 0.46, len * 0.28],
      [-wid * 0.46, len * 0.28],
      [wid * 0.46, -len * 0.28],
      [-wid * 0.46, -len * 0.28],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10), tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(lx, 0.22, lz);
      g.add(wheel);
    }
    const grill = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.7, 0.16, 0.06), chrome);
    grill.position.set(0, 0.4, len * 0.48);
    g.add(grill);
    return g;
  }

  private makeHotdogMesh(): THREE.Group {
    const g = new THREE.Group();
    // Bottom bun
    const bunBot = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.32, 6, 10),
      solidMat(0xe0b070),
    );
    bunBot.rotation.z = Math.PI / 2;
    bunBot.position.y = -0.035;
    bunBot.scale.set(1, 0.72, 1.05);
    // Top bun
    const bunTop = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.32, 6, 10),
      solidMat(0xebb878),
    );
    bunTop.rotation.z = Math.PI / 2;
    bunTop.position.y = 0.055;
    bunTop.scale.set(1, 0.55, 1.05);
    // Sausage
    const meat = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.055, 0.3, 6, 10),
      solidMat(0xb04830),
    );
    meat.rotation.z = Math.PI / 2;
    meat.position.y = 0.012;
    // Mustard squiggle (a few blobs)
    const mustardMat = solidMat(0xf2d23a);
    for (let i = 0; i < 5; i++) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), mustardMat);
      blob.position.set(-0.12 + i * 0.06, 0.07, 0.02 + Math.sin(i) * 0.01);
      blob.scale.set(1.6, 0.55, 0.7);
      g.add(blob);
    }
    // Sesame seeds on top bun
    const seedMat = solidMat(0xf5e6c8);
    for (let i = 0; i < 8; i++) {
      const seed = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), seedMat);
      const t = (i / 8) * Math.PI * 2;
      seed.position.set(Math.cos(t) * 0.1, 0.1, Math.sin(t) * 0.04);
      g.add(seed);
    }
    g.add(bunBot, bunTop, meat);
    return g;
  }

  private makeHotdog(): THREE.Group {
    const g = this.makeHotdogMesh();
    g.scale.setScalar(1.35);
    g.userData.spin = Math.random() * Math.PI * 2;
    return g;
  }

  /** Tallboy Four Loco can — camo label matching the real orange / fruit punch / watermelon skins. */
  private makeFourLoco(variant = 0): THREE.Group {
    const g = new THREE.Group();
    const pals = [
      { bright: "#f07818", mid: "#e8a838", dark: "#2c2c2c", band: "#d06010" },
      { bright: "#c82028", mid: "#707070", dark: "#1a1a1a", band: "#a01820" },
      { bright: "#58b028", mid: "#6a4820", dark: "#222222", band: "#3a8020" },
    ] as const;
    const pal = pals[variant % pals.length];

    const w = 256;
    const h = 512;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = pal.dark;
    ctx.fillRect(0, 0, w, h);
    const colors = [pal.bright, pal.mid, pal.dark, "#141414", pal.bright];
    for (let i = 0; i < 48; i++) {
      const n1 = Math.sin(i * 12.9898) * 43758.5453;
      const n2 = Math.sin(i * 78.233) * 23421.631;
      const fx = n1 - Math.floor(n1);
      const fy = n2 - Math.floor(n2);
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.ellipse(fx * w, fy * h, 18 + (i % 6) * 10, 14 + (i % 5) * 9, i * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = pal.band;
    ctx.fillRect(0, 0, w, 38);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("• CONTAINS ALCOHOL • CONTAINS ALCOHOL •", w / 2, 19);

    ctx.save();
    ctx.translate(68, h - 48);
    ctx.rotate(-Math.PI / 2);
    ctx.font = "bold 96px Impact, Arial Black, sans-serif";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 12;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.strokeText("four", 0, 0);
    ctx.fillText("four", 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(100, 168);
    ctx.rotate(-0.32);
    ctx.font = "italic 900 46px Georgia, 'Brush Script MT', serif";
    ctx.fillStyle = "#0a0a0a";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.strokeText("Loko", 0, 0);
    ctx.fillText("Loko", 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(w - 26, h - 36);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#f0f0f0";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("12.0% ALC/VOL  •  GUARANA • TAURINE • CAFFEINE", 0, 0);
    ctx.restore();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.42, 24, 1, true),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    body.position.y = 0.22;

    const silver = solidMat(0xc8c8cc);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.098, 0.028, 24), silver);
    top.position.y = 0.43;
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.09, 0.022, 24), silver);
    bot.position.y = 0.01;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.01, 0.022), solidMat(0xa8a8ac));
    tab.position.set(0.025, 0.448, 0);

    g.add(body, top, bot, tab);
    g.userData.spin = Math.random() * Math.PI * 2;
    return g;
  }

  private trackGhost(p: SyncPlayer): Ghost {
    let ghost = this.ghosts.get(p.id);
    if (!ghost) {
      ghost = { x: p.x, y: p.y, z: p.floorZ + (p.jumpZ || 0), aim: p.aim, samples: [] };
      this.ghosts.set(p.id, ghost);
    }
    const now = performance.now();
    const last = ghost.samples[ghost.samples.length - 1];
    const aimStep = Math.abs(lerpAngle(last?.aim ?? p.aim, p.aim, 1) - (last?.aim ?? p.aim));
    const air = p.floorZ + (p.jumpZ || 0);
    const pitchStep = Math.abs((last?.pitch ?? 0) - (p.pitch || 0));
    if (!last || last.x !== p.x || last.y !== p.y || last.z !== air || aimStep > 0.03 || pitchStep > 0.02) {
      ghost.samples.push({ t: now, x: p.x, y: p.y, z: air, aim: p.aim, pitch: p.pitch || 0 });
      if (ghost.samples.length > 10) ghost.samples.shift();
    }
    ghost.x = p.x;
    ghost.y = p.y;
    ghost.z = air;
    ghost.aim = p.aim;
    return ghost;
  }

  private syncEntities(me: SyncPlayer, dt: number): void {
    const seen = new Set<string>();
    const watch = this.watch;
    this.session.state?.players.forEach((p, id) => {
      if (p.alive === 0) {
        const dead = this.entities.get(id);
        if (dead) {
          this.explodeBody(dead, p.floorZ);
          this.entities.delete(id);
          this.ghosts.delete(id);
        }
        return;
      }
      if (p.id === me.id) return;
      const cheese = p.id === "cheese-curl" || p.name === "Mr. Cheese Curl";
      const derl = p.id === "derl-boss" || p.name === "Derl";
      if (watch && p.id === watch.id) {
        this.trackGhost(p);
        seen.add(id);
        const head = this.entities.get(id);
        if (head) {
          this.worldRoot.remove(head);
          this.entities.delete(id);
        }
        return;
      }
      if (watch) {
        if (!this.seenFrom(watch, p)) return;
      } else if (p.id !== "derl-boss" && !cheese && !this.visible(me, p) && !p.blip) return;
      seen.add(id);
      const ghost = this.trackGhost(p);
      const now = performance.now();
      const sample = this.sample(ghost);
      let node = this.entities.get(id);
      if (!node) {
        node = cheese ? this.makeCheeseCurl() : derl ? this.makeDerl() : this.makeSoldier();
        this.worldRoot.add(node);
        this.entities.set(id, node);
      }
      const stand = p.alive === 2 ? 0.55 : 1;
      node.scale.setScalar(derl ? 1.85 * stand : cheese ? 1.15 * stand : 1.05 * stand);
      const bob = cheese ? Math.sin(now * 0.012) * 0.08 : 0;
      node.position.set(sample.x * S, sample.z * S + bob, sample.y * S);
      node.rotation.y = Math.PI / 2 - sample.aim;
      node.visible = true;
      const body = node.getObjectByName("body") as THREE.Mesh | undefined;
      if (body && derl) {
        (body.material as THREE.MeshLambertMaterial).color.setHex(0x6a2040);
      } else if (body && !cheese && !derl) {
        (body.material as THREE.MeshLambertMaterial).color.setHex(
          p.blip && !this.visible(me, p) ? 0xffb020 : 0xf07818,
        );
      }
    });
    for (const [id, node] of this.entities) {
      if (!seen.has(id)) {
        this.worldRoot.remove(node);
        this.entities.delete(id);
        this.ghosts.delete(id);
      }
    }

    const bikeSeen = new Set<string>();
    this.session.state?.vehicles.forEach((bike, id) => {
      if (!bike.alive) return;
      if ((me.seat === 0 && me.vehicleId === id) || (this.watch?.seat === 0 && this.watch.vehicleId === id)) return;
      bikeSeen.add(id);
      let node = this.bikes.get(id);
      if (!node || node.userData.kind !== bike.kind) {
        if (node) this.worldRoot.remove(node);
        node = bike.kind === "heli" ? this.makeHeli() : bike.kind === "car" ? this.makeCar() : this.makeBike();
        node.userData.kind = bike.kind;
        this.worldRoot.add(node);
        this.bikes.set(id, node);
      }
      node.position.set(bike.x * S, (bike.z || 0) * S, bike.y * S);
      node.rotation.y = -bike.heading + Math.PI / 2;
      if (bike.kind === "heli") {
        const spinning = !!bike.driver || Math.abs(bike.speed) > 12 || bike.z > 8;
        const rotor = node.getObjectByName("rotor");
        const tail = node.getObjectByName("tailRotor");
        if (rotor) rotor.rotation.y += (spinning ? 22 : 0.6) * dt;
        if (tail) tail.rotation.x += (spinning ? 28 : 0.8) * dt;
      }
    });
    for (const [id, node] of this.bikes) {
      if (!bikeSeen.has(id)) {
        this.worldRoot.remove(node);
        this.bikes.delete(id);
      }
    }

    const projSeen = new Set<string>();
    this.session.state?.projectiles.forEach((shot, id) => {
      projSeen.add(id);
      const hotdog = shot.kind === "grenade" || shot.weapon === "grenade";
      const smoke = shot.kind === "smoke" || shot.weapon === "smoke";
      let node = this.projectiles.get(id);
      if (!node) {
        if (hotdog) node = this.makeHotdog();
        else if (smoke) node = this.makeSmokeCanister();
        else if (shot.kind === "rocket" || shot.weapon === "rocket") {
          node = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.42, 8), solidMat(0xd24a2a));
          node.rotation.x = Math.PI / 2;
        } else {
          node = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), solidMat(0xffcc44));
        }
        this.worldRoot.add(node);
        this.projectiles.set(id, node);
      }
      // World z is in map units (~48/m); lift into Three meters
      const height = Math.max(0.08, (shot.z || 8) / WORLD_PER_M);
      node.position.set(shot.x * S, height, shot.y * S);
      if (hotdog) {
        const yaw = Math.atan2(shot.vx || 0, shot.vy || 1);
        node.userData.spin = (node.userData.spin || 0) + 0.28;
        // Long axis along travel, end-over-end tumble
        node.rotation.set(node.userData.spin, yaw, Math.sin(node.userData.spin * 0.7) * 0.35);
      } else if (smoke) {
        node.userData.spin = (node.userData.spin || 0) + 0.2;
        node.rotation.set(0.4, node.userData.spin, 0.2);
      }
    });
    for (const [id, node] of this.projectiles) {
      if (!projSeen.has(id)) {
        this.worldRoot.remove(node);
        this.projectiles.delete(id);
      }
    }

    const pickSeen = new Set<string>();
    this.session.state?.pickups?.forEach((pick, id) => {
      if (!pick.alive) return;
      pickSeen.add(id);
      let node = this.pickups.get(id);
      if (!node) {
        if (pick.kind === "colt") {
          node = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.45, 10), solidMat(0xc8a050));
          node.position.y = 0.25;
        } else if (pick.kind === "smoke") {
          node = this.makeSmokeCanister();
          node.scale.setScalar(1.35);
        } else {
          let hash = 0;
          for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * (i + 3)) | 0;
          node = this.makeFourLoco(Math.abs(hash));
        }
        this.worldRoot.add(node);
        this.pickups.set(id, node);
      }
      const baseY = pick.kind === "colt" ? 0.25 : pick.kind === "smoke" ? 0.28 : 0;
      node.position.set(pick.x * S, baseY, pick.y * S);
      if (pick.kind === "loco" && node.userData.spin != null) {
        node.userData.spin += 0.012;
        node.rotation.y = node.userData.spin;
      } else if (pick.kind === "smoke") {
        node.userData.spin = (node.userData.spin || 0) + 0.018;
        node.rotation.y = node.userData.spin;
      }
    });
    for (const [id, node] of this.pickups) {
      if (!pickSeen.has(id)) {
        this.worldRoot.remove(node);
        this.pickups.delete(id);
      }
    }

    this.syncSmokeClouds(dt);
  }

  private syncSmokeClouds(dt: number): void {
    const seen = new Set<string>();
    this.session.state?.smokeClouds?.forEach((cloud, id) => {
      seen.add(id);
      let node = this.smokeCloudMeshes.get(id);
      if (!node) {
        node = this.makeSmokeCloudMesh(cloud.r * S);
        this.worldRoot.add(node);
        this.smokeCloudMeshes.set(id, node);
      }
      node.position.set(cloud.x * S, 1.1, cloud.y * S);
      node.userData.age = (node.userData.age || 0) + dt;
      const age = node.userData.age as number;
      const swell = Math.min(1, age / 0.55);
      node.scale.setScalar(0.35 + swell * 0.65);
      node.rotation.y += dt * 0.15;
      for (const child of node.children) {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (mat?.opacity != null) mat.opacity = 0.42 + Math.sin(age * 1.4 + child.position.x) * 0.06;
      }
    });
    for (const [id, node] of this.smokeCloudMeshes) {
      if (!seen.has(id)) {
        this.worldRoot.remove(node);
        this.smokeCloudMeshes.delete(id);
      }
    }
  }

  /** Gray canister — ground pickup and in-flight smoke grenade. */
  private makeSmokeCanister(): THREE.Group {
    const root = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.12, 0.42, 10),
      solidMat(0x6a6e72),
    );
    body.position.y = 0.21;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.08, 10),
      solidMat(0x3a3d40),
    );
    cap.position.y = 0.46;
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.125, 0.125, 0.06, 10),
      solidMat(0xb8bcc0),
    );
    stripe.position.y = 0.28;
    const pin = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.015, 6, 10),
      solidMat(0xd0d4d8),
    );
    pin.position.set(0.08, 0.48, 0);
    pin.rotation.y = Math.PI / 2;
    root.add(body, cap, stripe, pin);
    return root;
  }

  private makeSmokeCloudMesh(radius: number): THREE.Group {
    const root = new THREE.Group();
    const mat = () => new THREE.MeshBasicMaterial({
      color: 0x9aa0a6,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const blobs = [
      [0, 0.6, 0, 1],
      [0.55, 0.45, 0.2, 0.72],
      [-0.5, 0.5, -0.25, 0.78],
      [0.15, 0.85, -0.55, 0.65],
      [-0.25, 0.35, 0.55, 0.7],
      [0.4, 0.7, 0.45, 0.6],
    ] as const;
    for (const [x, y, z, s] of blobs) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.55 * s, 12, 10), mat());
      puff.position.set(x * radius * 0.55, y * radius * 0.35, z * radius * 0.55);
      root.add(puff);
    }
    return root;
  }

  private sample(ghost: Ghost): { x: number; y: number; z: number; aim: number; pitch: number } {
    const when = performance.now() - 100;
    const list = ghost.samples;
    const pack = (s: GhostSample) => ({ x: s.x, y: s.y, z: s.z, aim: s.aim, pitch: s.pitch || 0 });
    if (list.length < 2) return pack(list[0] ?? { t: 0, x: ghost.x, y: ghost.y, z: ghost.z, aim: ghost.aim, pitch: 0 });
    if (when <= list[0].t) return pack(list[0]);
    for (let i = 1; i < list.length; i++) {
      if (when <= list[i].t) {
        const a = list[i - 1];
        const b = list[i];
        const u = (when - a.t) / Math.max(1, b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * u,
          y: a.y + (b.y - a.y) * u,
          z: a.z + (b.z - a.z) * u,
          aim: lerpAngle(a.aim, b.aim, u),
          pitch: (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * u,
        };
      }
    }
    return pack(list[list.length - 1]);
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
      if (p.id !== "derl-boss" && !this.visible(me, p) && !p.blip) return;
      ctx.fillStyle = p.blip && !this.visible(me, p) ? "#ffb020" : "#e07060";
      ctx.beginPath();
      ctx.arc(mx + p.x * sx, my + p.y * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
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
    if (me.seat >= 0) {
      const ride = me.vehicleId ? this.session.state?.vehicles.get(me.vehicleId) : undefined;
      if (me.seat === 0 && ride?.kind === "heli") return "FREE LOOK    HOLD CLICK SMG    E DISMOUNT";
      if (me.seat === 0) return "FREE LOOK    W DRIVE    A D STEER    E DISMOUNT";
      return "FREE LOOK    E DISMOUNT";
    }
    const door = doorAt(map, me.x, me.y, 48);
    if (door) {
      const st = this.session.state?.doors?.get(door.id);
      const open = st ? st.open : 0;
      return open ? "E  CLOSE DOOR" : "E  OPEN DOOR";
    }
    let nearBike = false;
    let nearHeli = false;
    let nearCar = false;
    this.session.state?.vehicles.forEach((bike) => {
      if (!bike.alive || bike.z > 64) return;
      const d = (bike.x - me.x) ** 2 + (bike.y - me.y) ** 2;
      const reach = bike.kind === "heli" ? 78 : bike.kind === "car" ? 96 : 56;
      if (d < reach * reach) {
        if (bike.kind === "heli") nearHeli = true;
        else if (bike.kind === "car") nearCar = true;
        else nearBike = true;
      }
    });
    if (nearHeli) return "E  FLY HELICOPTER";
    if (nearCar) return "E  DRIVE FUSION";
    return nearBike ? "E  RIDE EBIKE" : "";
  }

  private localSolids() {
    const solids = map.solids.slice();
    for (const door of map.doors) {
      const st = this.session.state?.doors?.get(door.id);
      if (st && st.open) continue;
      solids.push({ x: door.x, y: door.y, w: door.w, h: door.h });
    }
    return solids;
  }

  private syncDoors(dt: number): void {
    for (const door of map.doors) {
      const st = this.session.state?.doors?.get(door.id);
      const target = st && st.open ? 1 : 0;
      const cur = this.doorOpenLocal.get(door.id) ?? 0;
      const next = cur + (target - cur) * Math.min(1, dt * 8);
      this.doorOpenLocal.set(door.id, next);
      if (door.id === "hersh-front" && this.hershDoorMesh) {
        this.hershDoorMesh.rotation.y = next * -1.2;
        continue;
      }
      const root = this.doorRoots.get(door.id);
      if (!root) continue;
      const outward = door.house === "hersh" ? -1 : 1;
      root.rotation.y = next * outward * (Math.PI * 0.72);
    }
  }

  private addDoor(door: { id: string; x: number; y: number; w: number; h: number; house: string }): void {
    const hinge = new THREE.Group();
    // Hinge at north edge of door frame
    hinge.position.set(door.x * S, 0, door.y * S);
    const wood = solidMat(0x6a3a22);
    const trim = solidMat(0xf2f2f0);
    const panelW = Math.max(0.08, door.w * S);
    const panelD = Math.max(0.9, door.h * S);
    const panelH = WALL_H * 0.88;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, panelH, panelD * 0.96), wood);
    panel.position.set(panelW * 0.5, panelH / 2, panelD * 0.5);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(panelW * 1.4, panelH * 1.02, 0.06), trim);
    frame.position.set(panelW * 0.5, panelH / 2, 0.02);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), solidMat(0xd4b060));
    knob.position.set(panelW + 0.02, panelH * 0.45, panelD * 0.7);
    hinge.add(panel, frame, knob);
    this.worldRoot.add(hinge);
    this.doorRoots.set(door.id, hinge);
    this.doorOpenLocal.set(door.id, 0);
  }

  private addBush(cx: number, cz: number): void {
    const leaf = solidMat(0x3a8a3a);
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 5), leaf);
    a.position.set(cx, 0.45, cz);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 5), solidMat(0x2e7a2e));
    b.position.set(cx + 0.25, 0.35, cz + 0.1);
    this.worldRoot.add(a, b);
  }

  private addPorchPillar(cx: number, cz: number): void {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), solidMat(0xf0f0ee));
    post.position.set(cx, 1.3, cz);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.28), solidMat(0xe8e8e4));
    cap.position.set(cx, 2.65, cz);
    this.worldRoot.add(post, cap);
  }

  private addGarageDoor(cx: number, cz: number, height: number): void {
    const h = Math.max(1.6, height * 0.45);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, Math.max(1.4, height * 0.55)), solidMat(0xe8e8e8));
    door.position.set(cx, h / 2, cz);
    this.worldRoot.add(door);
  }

  private addYardStep(cx: number, cz: number, w: number, d: number, variant: number): void {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.4, w), 0.14 + variant * 0.04, Math.max(0.35, d)),
      solidMat(0xb0b4b8),
    );
    step.position.set(cx, 0.08 + variant * 0.05, cz);
    this.worldRoot.add(step);
  }

  private ridden(me: SyncPlayer) {
    if (!me.vehicleId) return undefined;
    return this.session.state?.vehicles.get(me.vehicleId);
  }
}
