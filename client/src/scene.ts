import Phaser from "phaser";
import {
  CLASSES,
  IDENTITIES,
  SHIRTS,
  WORLD_H,
  WORLD_W,
  blockedAt,
  footMul,
  getMap,
  lerpAngle,
  stepInfantry,
  type MoveInput,
} from "@sixfront/shared";
import { audio } from "./audio";
import type { Session, SyncPlayer, SyncVehicle } from "./net";
import { bindDown, keys, loadPrefs, mouse } from "./settings";
import { buildTextures, tileIndex } from "./sprites";
import { serverMenuOpen, toggleServerMenu, updateHud } from "./ui";

interface Ghost {
  x: number;
  y: number;
  aim: number;
  samples: { t: number; x: number; y: number; aim: number }[];
}

const map = getMap();

export class FrontScene extends Phaser.Scene {
  session!: Session;
  private bodies = new Map<string, Phaser.GameObjects.Container>();
  private bikes = new Map<string, Phaser.GameObjects.Container>();
  private shots = new Map<string, Phaser.GameObjects.Image>();
  private bars = new Map<string, Phaser.GameObjects.Rectangle>();
  private ghosts = new Map<string, Ghost>();
  private fx: Phaser.GameObjects.Image[] = [];
  private lampGlow!: Phaser.GameObjects.Graphics;
  private zones!: Phaser.GameObjects.Graphics;
  private minimap!: Phaser.GameObjects.Graphics;
  private crosshair!: Phaser.GameObjects.Graphics;
  private night?: Phaser.GameObjects.Rectangle;
  private pred = { x: 0, y: 0, aim: 0, acc: 0, ready: false };
  private seq = 1;
  private edges = { reload: false, ability: false, grenade: false, interact: false };
  private lastShot = 0;
  private cam = { x: 0, y: 0 };
  private viewRot = 0;
  private bigMap = false;
  private escDown = false;
  private radarPings: { x: number; y: number; until: number }[] = [];

  constructor() {
    super("front");
  }

  init(data: { session: Session }): void {
    this.session = data.session;
  }

  create(): void {
    buildTextures(this);
    this.drawGround();
    this.drawProps();
    this.zones = this.add.graphics().setDepth(4);
    this.lampGlow = this.add.graphics().setDepth(30);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(40);
    this.crosshair = this.add.graphics().setScrollFactor(0).setDepth(41);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor("#1d2a1c");
    this.input.addPointer(2);
  }

  update(_time: number, delta: number): void {
    const state = this.session.state;
    const me = this.session.mine;
    if (!state || !me) return;
    const dt = Math.min(0.05, delta / 1000);
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement;
    const esc = keys.has("Escape");
    if (esc && !this.escDown) toggleServerMenu(this.session);
    this.escDown = esc;
    const input = this.readInput(me, typing || serverMenuOpen());
    if (state.phase === "play" && me.alive === 1) {
      if (serverMenuOpen()) this.session.input({ ...input, fire: false, mx: 0, my: 0, throttle: 0, steer: 0, sprint: false, boost: false });
      else this.session.input(input);
    }
    this.follow(me, dt, input);
    this.syncPlayers(me);
    this.syncBikes();
    this.syncShots();
    this.syncBars();
    this.drawZones(state.night === 1);
    this.drawMinimap(me);
    this.drawCrosshair();
    updateHud(this.session, {
      prompt: this.prompt(me),
      pause: keys.has("Escape"),
      score: bindDown(loadPrefs().binds.score),
    });
    audio.motor(this.ridden(me)?.speed ?? 0, me.seat === 0 && me.alive === 1);
  }

  private drawGround(): void {
    const rows: number[][] = [];
    for (let r = 0; r < map.rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < map.cols; c++) row.push(tileIndex(map.surface[r * map.cols + c], c, r));
      rows.push(row);
    }
    const tilemap = this.make.tilemap({ data: rows, tileWidth: 48, tileHeight: 48 });
    const tiles = tilemap.addTilesetImage("ground", "tiles", 48, 48, 0, 0);
    if (tiles) tilemap.createLayer(0, tiles, 0, 0)?.setDepth(0);
  }

  private drawProps(): void {
    for (const b of map.buildings) {
      const sprite = this.add.image(b.x + b.w / 2, b.y + b.h / 2, `b-${b.kind}`).setDepth(3);
      sprite.setDisplaySize(b.w, b.h);
    }
    for (const d of map.decor) {
      const key = d.kind === "fence" ? "barrier" : d.kind === "trench" ? "" : d.kind;
      if (!key || !this.textures.exists(key)) continue;
      this.add.image(d.x, d.y, key).setDepth(d.kind === "tree" ? 6 : 3).setRotation(d.rot).setDisplaySize(Math.max(12, d.w), Math.max(12, d.h));
    }
  }

  private readInput(me: SyncPlayer, typing: boolean): MoveInput {
    const prefs = loadPrefs();
    const b = prefs.binds;
    const down = (code: string) => !typing && keys.has(code);
    const world = this.cameras.main.getWorldPoint(mouse.x, mouse.y);
    mouse.worldX = world.x;
    mouse.worldY = world.y;
    const origin = this.origin(me);
    const aim = Math.atan2(world.y - origin.y, world.x - origin.x);
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
      const moveMag = Math.hypot(mx, my);
      if (moveMag > 1) { mx /= moveMag; my /= moveMag; }
    } else {
      if (down(b.left) || down("ArrowLeft")) mx -= 1;
      if (down(b.right) || down("ArrowRight")) mx += 1;
      if (down(b.up) || down("ArrowUp")) my -= 1;
      if (down(b.down) || down("ArrowDown")) my += 1;
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
      ax: world.x,
      ay: world.y,
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

  private follow(me: SyncPlayer, dt: number, input: MoveInput): void {
    const def = CLASSES[me.classId as keyof typeof CLASSES] ?? CLASSES.rifleman;
    if (me.alive === 1 && me.seat < 0) {
      if (!this.pred.ready) {
        this.pred.x = me.x;
        this.pred.y = me.y;
        this.pred.aim = me.aim;
        this.pred.ready = true;
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
        this.pred.aim = body.aim;
      }
    } else {
      this.pred.ready = false;
      this.pred.x = me.x;
      this.pred.y = me.y;
      this.pred.aim = me.aim;
    }
    const focus = this.origin(me);
    const viewAim = this.viewAim(me, input);
    this.cam.x += (focus.x - this.cam.x) * 0.18;
    this.cam.y += (focus.y - this.cam.y) * 0.18;
    const cam = this.cameras.main;
    cam.centerOn(this.cam.x || focus.x, this.cam.y || focus.y);
    this.viewRot = viewAim + Math.PI / 2;
    cam.setRotation(this.viewRot);
  }

  private viewAim(me: SyncPlayer, input: MoveInput): number {
    if (me.seat >= 0 && me.vehicleId) {
      const bike = this.session.state?.vehicles.get(me.vehicleId);
      if (bike && me.seat === 0) return bike.heading;
    }
    if (me.seat >= 0) return input.aim;
    return this.pred.ready ? this.pred.aim : me.aim;
  }

  private syncPlayers(me: SyncPlayer): void {
    const seen = new Set<string>();
    this.session.state?.players.forEach((p, id) => {
      seen.add(id);
      let view = this.bodies.get(id);
      if (!view) {
        view = this.makeSoldier();
        this.bodies.set(id, view);
        this.ghosts.set(id, { x: p.x, y: p.y, aim: p.aim, samples: [] });
      }
      const ghost = this.ghosts.get(id)!;
      ghost.samples.push({ t: performance.now(), x: p.x, y: p.y, aim: p.aim });
      if (ghost.samples.length > 12) ghost.samples.shift();
      const mine = id === me.id;
      const show = this.visible(me, p);
      const hideSelf = mine && me.alive === 1;
      view.setVisible((show || mine) && !hideSelf);
      if (!show && !mine) return;
      if (hideSelf) {
        if (mouse.left && p.alive === 1 && performance.now() - this.lastShot > 90) {
          this.lastShot = performance.now();
          const x = this.pred.x;
          const y = this.pred.y;
          const aim = this.pred.aim;
          this.muzzle(x, y, aim);
          audio.play(p.classId === "heavy" ? "lmg" : p.classId === "medic" ? "smg" : "shot");
        }
        return;
      }
      let x = p.x;
      let y = p.y;
      let aim = p.aim;
      if (mine && me.seat < 0 && me.alive === 1) {
        x = this.pred.x;
        y = this.pred.y;
        aim = this.pred.aim;
      } else if (!mine) {
        const sample = this.sample(ghost);
        x = sample.x;
        y = sample.y;
        aim = sample.aim;
      }
      view.setPosition(x, y);
      view.setRotation(aim);
      view.setAlpha(p.alive === 0 ? 0.35 : 1);
      const torso = view.getByName("torso") as Phaser.GameObjects.Image;
      torso.setTint(Phaser.Display.Color.HexStringToColor(SHIRTS[p.shirt] || "#cccccc").color);
      const moved = Math.hypot(x - Number(view.getData("lx") || x), y - Number(view.getData("ly") || y)) > 0.8;
      view.setData("lx", x);
      view.setData("ly", y);
      (view.getByName("legs") as Phaser.GameObjects.Image).setTexture(moved ? `legs-${Math.floor(performance.now() / 120) % 4}` : "legs-1");
      this.part(view, "helmet", p.helmet ? `helmet-${p.helmet}` : "");
      this.part(view, "hat", p.hat ? `hat-${p.hat}` : "");
      this.part(view, "vest", p.vest ? `vest-${p.vest}` : "");
      this.part(view, "face", p.face ? `face-${p.face}` : "");
      const gun = view.getByName("gun") as Phaser.GameObjects.Image;
      const weapon = p.weaponSlot === 3 && p.classId === "at" ? "rocket" : p.weaponSlot === 2 ? "pistol" : p.classId === "medic" ? "smg" : p.classId === "heavy" ? "lmg" : p.classId === "scout" ? "scout" : p.classId === "engineer" || p.classId === "at" ? "carbine" : "rifle";
      gun.setTexture(`gun-${weapon}`);
      gun.setVisible(p.alive === 1);
      view.setScale(p.alive === 2 ? 0.9 : 1, p.alive === 2 ? 0.55 : 1);
      if (mine && mouse.left && p.alive === 1 && performance.now() - this.lastShot > 90) {
        this.lastShot = performance.now();
        this.muzzle(x, y, aim);
        audio.play(p.classId === "heavy" ? "lmg" : p.classId === "medic" ? "smg" : "shot");
      }
    });
    for (const [id, view] of this.bodies) {
      if (!seen.has(id)) {
        view.destroy();
        this.bodies.delete(id);
        this.ghosts.delete(id);
      }
    }
  }

  private makeSoldier(): Phaser.GameObjects.Container {
    const root = this.add.container(0, 0).setDepth(8).setScale(1.35);
    root.add(this.add.image(0, 8, "shadow").setName("shadow"));
    root.add(this.add.image(0, 6, "legs-0").setName("legs"));
    root.add(this.add.image(0, -2, "torso").setName("torso"));
    root.add(this.add.image(0, -8, "vest-1").setName("vest").setVisible(false));
    root.add(this.add.image(10, -16, "head").setName("head"));
    root.add(this.add.image(10, -22, "helmet-1").setName("helmet").setVisible(false));
    root.add(this.add.image(8, -24, "hat-1").setName("hat").setVisible(false));
    root.add(this.add.image(12, -14, "face-1").setName("face").setVisible(false));
    root.add(this.add.image(18, -2, "gun-rifle").setName("gun"));
    return root;
  }

  private part(view: Phaser.GameObjects.Container, name: string, texture: string): void {
    const image = view.getByName(name) as Phaser.GameObjects.Image;
    if (!texture) {
      image.setVisible(false);
      return;
    }
    image.setTexture(texture);
    image.setVisible(true);
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
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, aim: lerpAngle(a.aim, b.aim, u) };
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

  private syncBikes(): void {
    const seen = new Set<string>();
    this.session.state?.vehicles.forEach((bike, id) => {
      seen.add(id);
      let view = this.bikes.get(id);
      if (!view) {
        view = this.add.container(bike.x, bike.y).setDepth(7).setScale(1.25);
        view.add(this.add.image(0, 10, "shadow"));
        view.add(this.add.image(0, 0, "ebike").setName("body"));
        this.bikes.set(id, view);
      }
      const mine = this.session.mine;
      const driving = mine && mine.seat === 0 && mine.vehicleId === id;
      view.setVisible(bike.alive === 1 && !driving);
      view.setPosition(bike.x, bike.y);
      view.setRotation(bike.heading);
      if (bike.braking) this.puff(bike.x, bike.y, 0xff5530, 0.4);
      if (Math.abs(bike.speed) > 80) this.puff(bike.x, bike.y, 0xcbb892, 0.25);
    });
    for (const [id, view] of this.bikes) if (!seen.has(id)) { view.destroy(); this.bikes.delete(id); }
  }

  private syncShots(): void {
    const seen = new Set<string>();
    this.session.state?.projectiles.forEach((shot, id) => {
      seen.add(id);
      let view = this.shots.get(id);
      if (!view) {
        view = this.add.image(shot.x, shot.y, shot.kind === "grenade" ? "grenade" : "bullet").setDepth(9);
        this.shots.set(id, view);
      }
      view.setPosition(shot.x, shot.y - shot.z * 0.25);
      view.setRotation(Math.atan2(shot.vy, shot.vx));
    });
    for (const [id, view] of this.shots) if (!seen.has(id)) { view.destroy(); this.shots.delete(id); }
  }

  private syncBars(): void {
    const seen = new Set<string>();
    this.session.state?.barricades.forEach((bar, id) => {
      seen.add(id);
      let view = this.bars.get(id);
      if (!view) {
        view = this.add.rectangle(bar.x, bar.y, bar.w, bar.h, 0x8d8678, 0.95).setOrigin(0, 0).setDepth(5);
        this.bars.set(id, view);
      }
      view.setPosition(bar.x, bar.y);
      view.setSize(bar.w, bar.h);
    });
    for (const [id, view] of this.bars) if (!seen.has(id)) { view.destroy(); this.bars.delete(id); }
  }

  private drawZones(night: boolean): void {
    this.zones.clear();
    this.session.state?.objectives.forEach((zone) => {
      if (!zone.active) return;
      const color = zone.owner < 0 ? 0xf2f2f2 : [0x3d7ec4, 0xd06048, 0xd4a017][zone.owner] ?? 0xffffff;
      this.zones.lineStyle(2, color, 0.85);
      this.zones.strokeCircle(zone.x, zone.y, zone.r);
      this.zones.fillStyle(color, 0.12);
      this.zones.fillCircle(zone.x, zone.y, zone.r);
    });
    if (!this.night && night) this.night = this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x070b16, 0.45).setDepth(20);
    if (this.night) this.night.setVisible(night);
    this.lampGlow.clear();
    if (!night) return;
    this.lampGlow.fillStyle(0xffe2a8, 0.18);
    for (const lamp of map.lights) this.lampGlow.fillCircle(lamp.x, lamp.y, 90);
    this.session.state?.vehicles.forEach((bike) => {
      if (!bike.alive) return;
      this.lampGlow.fillStyle(0xd6ecff, 0.2);
      this.lampGlow.fillCircle(bike.x + Math.cos(bike.heading) * 40, bike.y + Math.sin(bike.heading) * 40, 70);
    });
  }

  private drawFlatUi(draw: () => void): void {
    const cam = this.cameras.main;
    cam.setRotation(0);
    draw();
    cam.setRotation(this.viewRot);
  }

  private drawCrosshair(): void {
    this.drawFlatUi(() => {
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;
    const cy = h / 2;
    this.crosshair.clear();
    this.crosshair.lineStyle(2, 0xf4f4f4, 0.9);
    this.crosshair.lineBetween(cx - 12, cy, cx - 4, cy);
    this.crosshair.lineBetween(cx + 4, cy, cx + 12, cy);
    this.crosshair.lineBetween(cx, cy - 12, cx, cy - 4);
    this.crosshair.lineBetween(cx, cy + 4, cx, cy + 12);
    this.crosshair.fillStyle(0xf2d48a, 0.95);
    this.crosshair.fillCircle(cx, cy, 2);
    });
  }

  private drawMinimap(me: SyncPlayer): void {
    this.drawFlatUi(() => {
    const prefs = loadPrefs();
    this.bigMap = keys.has(prefs.binds.map);
    const w = this.bigMap ? 520 : 210;
    const h = this.bigMap ? 360 : 150;
    const pad = 16;
    const x = this.scale.width - w - pad;
    const y = pad;
    this.minimap.clear();
    this.minimap.fillStyle(0x12160f, 0.78);
    this.minimap.fillRoundedRect(x, y, w, h, 8);
    const sx = w / WORLD_W;
    const sy = h / WORLD_H;
    const now = this.time.now;
    this.radarPings = this.radarPings.filter((ping) => ping.until > now);
    for (const ping of this.radarPings) {
      const life = (ping.until - now) / 1600;
      const mx = x + ping.x * sx;
      const my = y + ping.y * sy;
      const ring = 5 + (1 - life) * 9;
      this.minimap.lineStyle(2, 0xff9020, Math.min(1, life * 1.1));
      this.minimap.strokeCircle(mx, my, ring);
      this.minimap.fillStyle(0xffc040, Math.min(1, 0.35 + life * 0.55));
      this.minimap.fillCircle(mx, my, 4);
    }
    const dot = (px: number, py: number, color: number, r = 3) => {
      this.minimap.fillStyle(color, 1);
      this.minimap.fillCircle(x + px * sx, y + py * sy, r);
    };
    this.session.state?.objectives.forEach((zone) => {
      if (!zone.active) return;
      dot(zone.x, zone.y, zone.owner < 0 ? 0xf4f4f4 : [0x3d7ec4, 0xd06048, 0xd4a017][zone.owner] ?? 0xffffff, 5);
    });
    this.session.state?.players.forEach((p) => {
      if (p.alive === 0) return;
      const ally = p.id === me.id || (p.team === me.team && this.session.state?.teamMode !== "ffa");
      if (!ally && !this.visible(me, p) && !p.blip) return;
      dot(p.x, p.y, p.id === me.id ? 0xf2d48a : ally ? 0x8ec6ff : p.blip && !this.visible(me, p) ? 0xffb020 : 0xe07060, p.id === me.id ? 4 : 3);
    });
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
    let downed = false;
    this.session.state?.players.forEach((p) => {
      if (p.alive === 2 && p.team === me.team && (p.x - me.x) ** 2 + (p.y - me.y) ** 2 < 56 * 56) downed = true;
    });
    if (downed && me.classId === "medic") return "HOLD E  REVIVE";
    return "";
  }

  private ridden(me: SyncPlayer): SyncVehicle | undefined {
    if (!me.vehicleId) return undefined;
    return this.session.state?.vehicles.get(me.vehicleId);
  }

  radarPing(x: number, y: number): void {
    this.radarPings.push({ x, y, until: this.time.now + 1600 });
    if (this.radarPings.length > 32) this.radarPings.splice(0, this.radarPings.length - 32);
  }

  tracer(x: number, y: number, x2: number, y2: number): void {
    const dx = x2 - x;
    const dy = y2 - y;
    const len = Math.hypot(dx, dy);
    if (len < 8) return;
    const line = this.borrow((x + x2) / 2, (y + y2) / 2, "bullet");
    line.setRotation(Math.atan2(dy, dx)).setScale(len / 10, 2.2).setTint(0xfff3b0);
    this.tweens.add({ targets: line, alpha: 0, duration: 90, onComplete: () => this.release(line) });
  }

  private muzzle(x: number, y: number, aim: number): void {
    const flash = this.borrow(x + Math.cos(aim) * 26, y + Math.sin(aim) * 26, "bullet");
    flash.setTint(0xfff1c4).setScale(1.8);
    this.tweens.add({ targets: flash, alpha: 0, duration: 70, onComplete: () => this.release(flash) });
    const casing = this.borrow(x, y, "bullet");
    casing.setTint(0xd4b06a).setScale(0.6);
    this.tweens.add({
      targets: casing,
      x: x + Math.cos(aim + 1.6) * 18,
      y: y + Math.sin(aim + 1.6) * 18,
      alpha: 0,
      duration: 280,
      onComplete: () => this.release(casing),
    });
  }

  puff(x: number, y: number, color: number, alpha: number): void {
    if (Math.random() > 0.35) return;
    const puff = this.borrow(x, y, "bush");
    puff.setTint(color).setAlpha(alpha).setScale(0.4);
    this.tweens.add({ targets: puff, y: y - 10, alpha: 0, duration: 320, onComplete: () => this.release(puff) });
  }

  burst(x: number, y: number): void {
    audio.play("explode");
    for (let i = 0; i < 8; i++) {
      const bit = this.borrow(x, y, "bullet");
      bit.setTint(i % 2 ? 0xfff2c4 : 0xe07040).setScale(1.4);
      this.tweens.add({
        targets: bit,
        x: x + Math.cos(i) * 36,
        y: y + Math.sin(i) * 36,
        alpha: 0,
        duration: 280,
        onComplete: () => this.release(bit),
      });
    }
    if (loadPrefs().shake) this.cameras.main.shake(120, 0.004);
  }

  private borrow(x: number, y: number, key: string): Phaser.GameObjects.Image {
    const found = this.fx.find((item) => !item.active);
    const image = found ?? this.add.image(0, 0, key).setDepth(12);
    if (!found) this.fx.push(image);
    image.setActive(true).setVisible(true).setAlpha(1).setScale(1).setTint(0xffffff).setPosition(x, y).setTexture(key);
    return image;
  }

  private release(image: Phaser.GameObjects.Image): void {
    image.setActive(false).setVisible(false);
  }
}
