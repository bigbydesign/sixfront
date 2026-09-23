import {
  CLASSES,
  CLASS_LIST,
  DEFAULT_LOOK,
  IDENTITIES,
  MODE_MAP,
  VEHICLES,
  WEAPONS,
  bikeMul,
  blockedAt,
  clampLook,
  emptyInput,
  falloff,
  footMul,
  GUN_RANGE,
  doorAt,
  ladderAt,
  onRoofWalk,
  walkSolids,
  getMap,
  MAP_SCALE,
  isClassId,
  isIdentity,
  objectiveActive,
  sanitizeInput,
  sanitizeSettings,
  rayCircle,
  rayRect,
  seatPoint,
  segmentHitsCircle,
  segmentHitsRect,
  stepBike,
  stepHeli,
  SIM_DT,
  stepInfantry,
  surfaceAt,
  type ClassId,
  type GameEvent,
  type Identity,
  type MatchSettings,
  type ModeId,
  type MoveInput,
  type WeaponId,
} from "@sixfront/shared";
import { BarricadeState, DoorState, ObjectiveState, PickupState, PlayerState, ProjectileState, SmokeCloudState, TowerState, VehicleState, WarState } from "./schema";
import {
  CHEESE_BUFF_SEC,
  CHEESE_WEAKEN_SEC,
  COLT45_STOCK,
  DERL_ID,
  DERL_MAX_HP,
  DERL_SPAWN,
  DERL_SPAWN_DELAY,
  LOCO_SPOTS,
  isDerl,
} from "./derl";
import {
  CHEESE_CURL_HP,
  CHEESE_CURL_ID,
  CHEESE_CURL_NAME,
  CHEESE_CURL_SPAWN,
  isCheeseCurl,
} from "./cheeseCurl";
import {
  SMOKE_CARRY_MAX,
  SMOKE_DURATION,
  SMOKE_NEAR,
  SMOKE_RADIUS,
  SMOKE_RESPAWN,
  SMOKE_SPOTS,
} from "./smoke";

interface RT {
  mags: number[];
  reserves: number[];
  cooldown: number;
  reloading: boolean;
  reloadLeft: number;
  reloadDur: number;
  heat: number;
  grenadeCd: number;
  abilityCd: number;
  abilityLeft: number;
  suppressLeft: number;
  pulseLeft: number;
  lockLeft: number;
  sprintLeft: number;
  slowLeft: number;
  ramLeft: number;
  barricades: number;
  interactLatch: boolean;
  abilityLatch: boolean;
  fireLatch: boolean;
  grenadeLatch: boolean;
  input: MoveInput;
  livesLeft: number;
  downedLeft: number;
  invulnLeft: number;
  reviveLeft: number;
  noiseLeft: number;
  nadeUsed: number;
  smokes: number;
  colt45: number;
  cheeseWeakenLeft: number;
  damageBuffLeft: number;
  lastHitId: string;
  lastHitName: string;
  lastHitWeapon: string;
  lastHitDist: number;
}

interface Proj {
  id: string;
  x: number;
  y: number;
  z: number;
  vz: number;
  vx: number;
  vy: number;
  team: number;
  ownerId: string;
  weapon: string;
  ttl: number;
  radius: number;
  damage: number;
  splash: number;
  splashDamage: number;
  vehicleMul: number;
  kind: string;
  bounces?: number;
}

interface BikeRT {
  boostLeft: number;
  boostCd: number;
  homeX: number;
  homeY: number;
  vz: number;
  rocketCd: number;
}

const TICK = SIM_DT;

export class WarSim {
  readonly map = getMap();
  readonly rt = new Map<string, RT>();
  readonly bikes = new Map<string, BikeRT>();
  readonly projs: Proj[] = [];
  settings: MatchSettings;
  tickCount = 0;
  warmup = 0;
  clock = 15 * 60;
  endLeft = 0;
  scoreAcc = 0;
  seq = 1;
  aiN = 0;
  missLog = 0;
  derlSpawnAt = 0;
  derlConfidence = 1;
  private cheeseGoal = { x: 0, y: 0, until: 0 };
  private readonly spotUntil = new Map<string, number>();
  /** Smoke canister pad → seconds until respawn while alive=0. */
  private readonly smokeRespawn = new Map<string, number>();
  /** Active smoke clouds with remaining lifetime (schema mirrors x/y/r). */
  private readonly smokeTtl = new Map<string, number>();

  constructor(
    readonly state: WarState,
    readonly emit: (evt: GameEvent) => void,
  ) {
    this.settings = sanitizeSettings(undefined);
    this.applySettings(this.settings);
    for (const src of this.map.objectives) {
      const o = new ObjectiveState();
      o.id = src.id;
      o.name = src.name;
      o.x = src.x;
      o.y = src.y;
      o.r = src.r;
      o.group = src.group;
      o.owner = -1;
      this.state.objectives.push(o);
    }
    for (const t of this.map.towers) {
      const tower = new TowerState();
      tower.id = t.id;
      tower.x = t.x;
      tower.y = t.y;
      tower.r = t.r;
      tower.owner = -1;
      this.state.towers.set(t.id, tower);
    }
    this.resetVehicles();
    this.resetDoors();
  }

  private resetDoors(): void {
    this.state.doors.clear();
    for (const src of this.map.doors) {
      const d = new DoorState();
      d.id = src.id;
      d.open = 0;
      this.state.doors.set(src.id, d);
    }
  }

  applySettings(raw: Partial<MatchSettings>): void {
    const prevMinutes = this.settings.minutes;
    const prevMode = this.settings.mode;
    const prevTeams = this.settings.teamMode;
    this.settings = sanitizeSettings({ ...this.settings, ...raw });
    const s = this.settings;
    this.state.mode = s.mode;
    this.state.mapId = s.mapId;
    this.state.minutes = s.minutes;
    this.state.scoreLimit = s.scoreLimit;
    this.state.teamMode = s.teamMode;
    this.state.friendlyFire = s.friendlyFire ? 1 : 0;
    this.state.aiCount = s.aiCount;
    this.state.respawn = s.respawn;
    this.state.night = s.night ? 1 : 0;
    if (this.state.phase !== "play" || s.minutes !== prevMinutes) {
      this.clock = s.minutes * 60;
      this.state.timeLeft = s.minutes * 60;
    }
    if (s.teamMode !== prevTeams || s.teamMode === "ffa") {
      this.state.players.forEach((p) => {
        if (p.bot) {
          p.team = s.teamMode === "ffa" ? (Number(p.id.replace(/\D/g, "")) % 6) : s.teamMode === "three" ? (p.team % 3) : (p.team % 2);
          return;
        }
        if (s.teamMode === "ffa") p.team = Math.max(0, IDENTITIES.indexOf(p.identity as Identity));
        else if (s.teamMode === "three") p.team = Math.max(0, Math.min(2, p.team));
        else p.team = p.team > 0 ? 1 : 0;
      });
    }
    if (this.state.phase === "play") {
      if (s.mode !== prevMode) this.resetObjectives();
      this.syncBots();
    }
  }

  addHuman(id: string, name: string, identity: string, classId: string, look: ReturnType<typeof clampLook>): PlayerState {
    const ident: Identity = isIdentity(identity) && !this.identityTaken(identity) ? identity : this.freeIdentity();
    const p = new PlayerState();
    p.id = id;
    p.name = ident;
    p.identity = ident;
    p.bot = 0;
    p.classId = isClassId(classId) ? classId : "rifleman";
    p.team = this.settings.teamMode === "ffa" ? IDENTITIES.indexOf(ident) : 0;
    const face = clampLook(look, DEFAULT_LOOK[ident]);
    this.writeLook(p, face);
    p.ready = 0;
    p.alive = 0;
    p.seat = -1;
    this.state.players.set(id, p);
    this.rt.set(id, this.freshRT(p.classId as ClassId));
    this.syncHud(p);
    return p;
  }

  remove(id: string): void {
    this.dismount(id);
    this.state.players.delete(id);
    this.rt.delete(id);
    this.state.barricades.forEach((b, bid) => {
      if (b.owner === id) this.state.barricades.delete(bid);
    });
  }

  setInput(id: string, raw: Partial<MoveInput>): void {
    const rt = this.rt.get(id);
    if (!rt) return;
    rt.input = sanitizeInput(raw, rt.input.seq);
  }

  setPing(id: string, ping: number): void {
    const p = this.state.players.get(id);
    if (p) p.ping = Math.max(0, Math.min(999, Math.round(ping)));
  }

  loadout(id: string, body: {
    identity?: string;
    classId?: string;
    team?: number;
    ready?: boolean;
    look?: Partial<ReturnType<typeof clampLook>>;
    name?: string;
  }): void {
    const p = this.state.players.get(id);
    const rt = this.rt.get(id);
    if (!p || !rt || p.bot) return;
    if (body.identity && isIdentity(body.identity) && (body.identity === p.identity || !this.identityTaken(body.identity))) {
      p.identity = body.identity;
      p.name = body.identity;
      if (!body.look) this.writeLook(p, DEFAULT_LOOK[body.identity]);
      if (this.settings.teamMode === "ffa") p.team = IDENTITIES.indexOf(body.identity);
    } else if (body.name) {
      p.name = body.name.slice(0, 16);
    }
    if (body.classId && isClassId(body.classId) && (this.state.phase !== "play" || p.alive === 0)) {
      p.classId = body.classId;
      const next = this.freshRT(body.classId);
      next.input = rt.input;
      next.livesLeft = rt.livesLeft;
      this.rt.set(id, next);
    }
    if (body.look) this.writeLook(p, clampLook(body.look, this.readLook(p)));
    if (typeof body.team === "number" && this.settings.teamMode !== "ffa" && (this.state.phase !== "play" || p.alive === 0)) {
      const max = this.settings.teamMode === "three" ? 2 : 1;
      p.team = Math.max(0, Math.min(max, Math.floor(body.team)));
    }
    if (typeof body.ready === "boolean" && this.state.phase === "lobby") p.ready = body.ready ? 1 : 0;
  }

  start(): string | null {
    if (this.state.phase !== "lobby") return "Match already running.";
    const humans = this.humans();
    if (!humans.length) return "Need a player.";
    this.state.score0 = 0;
    this.state.score1 = 0;
    this.state.score2 = 0;
    this.state.winnerTeam = -1;
    this.state.winnerName = "";
    this.clock = this.settings.minutes * 60;
    this.state.timeLeft = this.settings.minutes * 60;
    this.warmup = 0;
    this.scoreAcc = 0;
    this.endLeft = 0;
    this.clearProjectiles();
    this.state.barricades.clear();
    this.state.pickups.clear();
    this.clearSmokeClouds();
    this.smokeRespawn.clear();
    this.resetVehicles();
    this.resetDoors();
    this.resetObjectives();
    this.removeBots();
    this.removeDerl();
    this.removeCheeseCurl();
    this.spawnLocoPickups();
    this.spawnSmokePickups();
    this.derlSpawnAt = this.clock - DERL_SPAWN_DELAY;
    this.derlConfidence = 1;
    this.state.derlAlive = 0;
    this.state.derlHp = 0;
    this.state.derlMaxHp = DERL_MAX_HP;
    this.state.derlConfidence = 1;
    const mode = MODE_MAP[this.settings.mode];
    for (const p of humans) {
      p.kills = 0;
      p.deaths = 0;
      p.score = 0;
      p.ready = 1;
      const rt = this.freshRT(p.classId as ClassId);
      rt.livesLeft = mode.lives;
      rt.colt45 = COLT45_STOCK;
      rt.input = this.rt.get(p.id)?.input ?? emptyInput();
      this.rt.set(p.id, rt);
      this.spawn(p);
    }
    this.removeBots();
    this.state.phase = "play";
    this.emit({ t: "notice", id: "", text: "Fight's on. 4Loco and smoke are on the map." });
    return null;
  }

  toLobby(): void {
    this.state.phase = "lobby";
    this.clearProjectiles();
    this.state.barricades.clear();
    this.state.pickups.clear();
    this.clearSmokeClouds();
    this.smokeRespawn.clear();
    this.resetVehicles();
    this.resetDoors();
    this.resetObjectives();
    this.removeBots();
    this.removeDerl();
    this.removeCheeseCurl();
    this.state.derlAlive = 0;
    this.state.derlHp = 0;
    this.state.derlConfidence = 1;
    this.state.winnerTeam = -1;
    this.state.winnerName = "";
    this.clock = this.settings.minutes * 60;
    this.state.timeLeft = this.settings.minutes * 60;
    this.state.players.forEach((p) => {
      p.alive = 0;
      p.hp = 0;
      p.vehicleId = "";
      p.seat = -1;
      p.ready = 0;
      p.respawnLeft = 0;
      p.smokes = 0;
    });
  }

  tick(): void {
    this.tickCount++;
    const dt = TICK;
    if (this.state.phase === "end") {
      this.endLeft -= dt;
      if (this.endLeft <= 0) this.toLobby();
      return;
    }
    if (this.state.phase !== "play") return;
    this.warmup = Math.max(0, this.warmup - dt);
    this.clock = Math.max(0, this.clock - dt);
    this.state.timeLeft = Math.ceil(this.clock);
    this.thinkAi(dt);
    this.stepDerl(dt);
    this.moveAll(dt);
    this.combat(dt);
    this.stepPickups();
    this.stepSmokeClouds(dt);
    this.capture(dt);
    this.scoreTick(dt);
    this.life(dt);
    this.visibility();
    this.syncAll();
    this.checkWin();
  }

  private humans(): PlayerState[] {
    const list: PlayerState[] = [];
    this.state.players.forEach((p) => { if (!p.bot) list.push(p); });
    return list;
  }

  private eachPlayer(fn: (p: PlayerState) => void): void {
    this.state.players.forEach(fn);
  }

  private identityTaken(identity: string): boolean {
    let taken = false;
    this.state.players.forEach((p) => { if (!p.bot && p.identity === identity) taken = true; });
    return taken;
  }

  private freeIdentity(): Identity {
    for (const id of IDENTITIES) if (!this.identityTaken(id)) return id;
    return "Derek";
  }

  private writeLook(p: PlayerState, look: ReturnType<typeof clampLook>): void {
    p.helmet = look.helmet;
    p.hat = look.hat;
    p.shirt = look.shirt;
    p.vest = look.vest;
    p.pants = look.pants;
    p.face = look.face;
  }

  private readLook(p: PlayerState): ReturnType<typeof clampLook> {
    return { helmet: p.helmet, hat: p.hat, shirt: p.shirt, vest: p.vest, pants: p.pants, face: p.face };
  }

  rejoin(id: string): void {
    const p = this.state.players.get(id);
    if (!p || p.alive === 1) return;
    if (p.seat >= 0) this.dismount(p.id);
    const rt = this.rt.get(id);
    if (rt) rt.downedLeft = 0;
    p.alive = 0;
    p.respawnLeft = 0;
    this.spawn(p);
  }

  private freshRT(classId: ClassId): RT {
    const def = CLASSES[classId];
    const slots = [def.primary, def.secondary, def.special];
    const mags = [0, 0, 0, 0, WEAPONS.cheese.mag];
    const reserves = [0, 0, 0, 0, WEAPONS.cheese.reserve];
    slots.forEach((w, i) => {
      if (w && w !== "barricade") {
        mags[i] = WEAPONS[w].mag;
        reserves[i] = WEAPONS[w].reserve;
      }
    });
    return {
      mags, reserves, cooldown: 0, reloading: false, reloadLeft: 0, reloadDur: 1, heat: 0,
      grenadeCd: 0, abilityCd: 0, abilityLeft: 0, suppressLeft: 0, pulseLeft: 0, lockLeft: 0, sprintLeft: 0,
      slowLeft: 0, ramLeft: 0, barricades: 2, interactLatch: false, abilityLatch: false, fireLatch: false,
      grenadeLatch: false, input: emptyInput(), livesLeft: 0, downedLeft: 0, invulnLeft: 0,
      reviveLeft: 0, noiseLeft: 0, nadeUsed: 0, smokes: 0, colt45: 0, cheeseWeakenLeft: 0, damageBuffLeft: 0,
      lastHitId: "", lastHitName: "", lastHitWeapon: "", lastHitDist: 0,
    };
  }

  private resetVehicles(): void {
    this.state.vehicles.clear();
    this.bikes.clear();
    for (const src of this.map.bikes) {
      const v = new VehicleState();
      v.id = src.id;
      const kind = src.kind ?? "ebike";
      const def = VEHICLES[kind];
      v.kind = kind;
      v.x = src.x;
      v.y = src.y;
      v.z = 0;
      v.heading = 0;
      v.hp = def.hp;
      v.maxHp = def.hp;
      v.battery = 100;
      v.seats = src.seats;
      v.base = src.base ? 1 : 0;
      v.alive = 1;
      this.state.vehicles.set(src.id, v);
      this.bikes.set(src.id, { boostLeft: 0, boostCd: 0, homeX: src.x, homeY: src.y, vz: 0, rocketCd: 0 });
    }
  }

  private resetObjectives(): void {
    const mode = this.state.mode as ModeId;
    this.state.objectives.forEach((o) => {
      o.owner = -1;
      o.progress = 0;
      o.progressTeam = -1;
      o.active = objectiveActive(o.group as "front" | "center" | "base", mode) ? 1 : 0;
    });
    this.state.towers.forEach((t) => { t.owner = -1; t.progress = 0; t.progressTeam = -1; });
  }

  private syncBots(): void {
    const want = 0;
    const drop: string[] = [];
    this.state.players.forEach((p) => {
      if (!p.bot) return;
      const n = Number(p.id.replace(/\D/g, ""));
      if (n > want) drop.push(p.id);
    });
    for (const id of drop) this.remove(id);
    for (let i = 0; i < want; i++) {
      if (!this.state.players.has(`ai-${i + 1}`)) this.spawnAi(i);
    }
  }

  private removeBots(): void {
    const drop: string[] = [];
    this.state.players.forEach((p) => { if (p.bot) drop.push(p.id); });
    for (const id of drop) this.remove(id);
  }

  private spawnAi(index: number): void {
    const id = `ai-${index + 1}`;
    const classId = CLASS_LIST[index % CLASS_LIST.length].id;
    const p = new PlayerState();
    p.id = id;
    p.bot = 1;
    p.identity = "";
    p.name = `${CLASSES[classId].name} Bot`;
    p.classId = classId;
    const teamMode = this.settings.teamMode;
    p.team = teamMode === "ffa" ? (index % 6) : teamMode === "three" ? (index % 3) : (index % 2);
    p.shirt = 6;
    p.pants = 0;
    p.helmet = 1;
    p.vest = 1;
    this.state.players.set(id, p);
    const mode = MODE_MAP[this.settings.mode];
    const rt = this.freshRT(classId);
    rt.livesLeft = mode.lives;
    this.rt.set(id, rt);
    this.spawn(p);
  }

  private spawn(p: PlayerState): void {
    const rt = this.rt.get(p.id);
    if (!rt) return;
    const def = CLASSES[p.classId as ClassId] ?? CLASSES.rifleman;
    const refilled = this.freshRT(def.id);
    refilled.input = rt.input;
    refilled.livesLeft = rt.livesLeft;
    refilled.invulnLeft = 0.35;
    this.rt.set(p.id, refilled);
    const pool = this.map.spawns.filter((s) => {
      if (this.personal()) return s.ffa;
      if (this.settings.teamMode === "three") return s.team === p.team;
      if (p.team === 0 || p.team === 1) return s.team === p.team;
      return s.ffa;
    });
    const options = pool.length ? pool : this.map.spawns;
    let spot = options[this.tickCount % options.length];
    for (let n = 0; n < options.length; n++) {
      const candidate = options[(this.tickCount + n + p.team) % options.length];
      let crowded = false;
      this.state.players.forEach((other) => {
        if (other.id !== p.id && other.alive === 1) {
          const dx = other.x - candidate.x;
          const dy = other.y - candidate.y;
          if (dx * dx + dy * dy < 70 * 70) crowded = true;
        }
      });
      if (!crowded) { spot = candidate; break; }
    }
    p.x = spot.x + (this.tickCount % 5) * 8;
    p.y = spot.y + (p.team * 10);
    p.aim = 0;
    p.hp = def.hp;
    p.maxHp = def.hp;
    if (isCheeseCurl(p.id)) {
      p.hp = CHEESE_CURL_HP;
      p.maxHp = CHEESE_CURL_HP;
      p.name = CHEESE_CURL_NAME;
      p.identity = CHEESE_CURL_NAME;
      p.team = 8;
      p.seat = -1;
      p.vehicleId = "";
    }
    p.alive = 1;
    p.vehicleId = "";
    p.seat = -1;
    p.weaponSlot = 1;
    p.smokes = 0;
    p.killerName = "";
    p.respawnLeft = 0;
    // Bikes stay parked on the map — walk up and press E to mount.
    this.syncHud(p);
  }

  private giveBike(p: PlayerState): void {
    let bike: VehicleState | undefined;
    this.state.vehicles.forEach((v) => {
      if (bike || !v.alive || v.driver) return;
      bike = v;
    });
    if (!bike) return;
    bike.x = p.x;
    bike.y = p.y;
    bike.heading = 0;
    bike.speed = 0;
    bike.battery = 100;
    bike.hp = bike.maxHp;
    bike.driver = p.id;
    if (bike.passenger === p.id) bike.passenger = "";
    p.vehicleId = bike.id;
    p.seat = 0;
  }

  private personal(): boolean {
    return this.settings.teamMode === "ffa" || MODE_MAP[this.settings.mode].personal;
  }

  private sameTeam(a: PlayerState, b: PlayerState): boolean {
    if (isDerl(a.id) || isDerl(b.id)) return a.id === b.id;
    if (isCheeseCurl(a.id) || isCheeseCurl(b.id)) return a.id === b.id;
    if (this.personal()) return a.id === b.id;
    return a.team === b.team;
  }

  private envSolids() {
    const solids = this.map.solids.slice();
    this.state.barricades.forEach((b) => solids.push({ x: b.x, y: b.y, w: b.w, h: b.h }));
    for (const src of this.map.doors) {
      const st = this.state.doors.get(src.id);
      if (!st || st.open) continue;
      solids.push({ x: src.x, y: src.y, w: src.w, h: src.h });
    }
    return solids;
  }

  private envFor(dt: number) {
    const solids = this.envSolids();
    return {
      dt,
      solids,
      blocked: (x: number, y: number) => blockedAt(this.map, x, y),
      footMul: (x: number, y: number) => footMul(this.map, x, y),
      bikeMul: (x: number, y: number) => bikeMul(this.map, x, y),
    };
  }

  private moveAll(dt: number): void {
    const env = this.envFor(dt);
    this.eachPlayer((p) => {
      const rt = this.rt.get(p.id);
      if (!rt || p.alive !== 1 || p.seat >= 0) return;
      const def = CLASSES[p.classId as ClassId] ?? CLASSES.rifleman;
      let speed = def.speed;
      if (rt.input.sprint && !rt.input.crouch) speed *= 1.45;
      if (rt.sprintLeft > 0) speed *= 1.34;
      if (rt.input.ads) speed *= 0.74;
      if (rt.input.crouch) speed *= 0.68;
      if (rt.slowLeft > 0) speed *= 0.68;
      if (rt.suppressLeft > 0 && def.id === "heavy") speed *= 0.82;
      const roofWalking = onRoofWalk(this.map, p.x, p.y, rt.input.floorZ);
      const body = { x: p.x, y: p.y, aim: p.aim };
      const useEnv = {
        ...env,
        solids: walkSolids(this.map, p.x, p.y, rt.input.floorZ, rt.input.jumpZ, env.solids),
      };
      const onLadder = !!ladderAt(this.map, p.x, p.y, 18) && !roofWalking && rt.input.floorZ > 8;
      const input = onLadder
        ? { ...rt.input, mx: rt.input.mx * 0.35, my: rt.input.my * 0.35 }
        : rt.input;
      stepInfantry(body, input, speed * (roofWalking ? 0.9 : 1), useEnv);
      p.x = body.x;
      p.y = body.y;
      p.aim = this.aimAt(p.x, p.y, rt.input);
      p.pitch = rt.input.pitch;
      p.sprinting = rt.input.sprint || rt.sprintLeft > 0 ? 1 : 0;
      p.floorZ = rt.input.floorZ;
      p.jumpZ = rt.input.jumpZ;
    });

    this.state.vehicles.forEach((bike) => {
      const br = this.bikes.get(bike.id);
      if (!br) return;
      if (!bike.alive) {
        if (bike.base && bike.respawn > 0) {
          bike.respawn -= dt;
          if (bike.respawn <= 0) {
            bike.alive = 1;
            bike.hp = bike.maxHp;
            bike.battery = 100;
            bike.x = br.homeX;
            bike.y = br.homeY;
            bike.z = 0;
            bike.speed = 0;
            br.vz = 0;
            bike.driver = "";
            bike.passenger = "";
          }
        }
        return;
      }
      const driver = bike.driver ? this.state.players.get(bike.driver) : undefined;
      const input = driver && driver.alive === 1 ? this.rt.get(driver.id)?.input ?? emptyInput() : emptyInput();
      const body = {
        x: bike.x, y: bike.y, heading: bike.heading, speed: bike.speed, battery: bike.battery,
        hp: bike.hp, boostLeft: br.boostLeft, boostCd: br.boostCd, braking: false, boosting: false,
      };
      if (bike.kind === "heli") {
        const heli = { x: bike.x, y: bike.y, z: bike.z, vz: br.vz, heading: bike.heading, speed: bike.speed };
        if (driver) stepHeli(heli, input, env);
        else {
          heli.speed *= Math.max(0, 1 - 1.4 * dt);
          heli.z = Math.max(0, heli.z - 110 * dt);
          heli.vz = 0;
        }
        br.vz = heli.vz;
        bike.z = heli.z;
        bike.x = heli.x;
        bike.y = heli.y;
        bike.heading = heli.heading;
        bike.speed = heli.speed;
      } else if (driver) stepBike(body, input, bike.seats, env, bike.kind === "car" ? "car" : "ebike");
      else body.speed *= Math.max(0, 1 - 2.2 * dt);
      if (bike.kind !== "heli") {
        br.boostLeft = body.boostLeft;
        br.boostCd = body.boostCd;
        bike.x = body.x;
        bike.y = body.y;
        bike.heading = body.heading;
        bike.speed = body.speed;
        bike.braking = body.braking ? 1 : 0;
        bike.boosting = body.boosting ? 1 : 0;
      }
      bike.battery = 100;
      for (const charger of this.map.chargers) {
        const dx = charger.x - bike.x;
        const dy = charger.y - bike.y;
        if (dx * dx + dy * dy < 80 * 80 && Math.abs(bike.speed) < 50) {
          bike.battery = Math.min(100, bike.battery + 32 * dt);
        }
      }
      this.ram(bike, driver);
    });

    this.eachPlayer((p) => {
      if (p.seat < 0 || !p.vehicleId) return;
      const bike = this.state.vehicles.get(p.vehicleId);
      if (!bike || !bike.alive) {
        this.dismount(p.id);
        return;
      }
      const seat = seatPoint(bike.x, bike.y, bike.heading, p.seat);
      p.x = seat.x;
      p.y = seat.y;
      p.floorZ = bike.kind === "heli" ? bike.z : 0;
      const rt = this.rt.get(p.id);
      if (rt) {
        p.aim = this.aimAt(p.x, p.y, rt.input);
        p.pitch = rt.input.pitch;
      }
    });

    this.eachPlayer((p) => {
      const rt = this.rt.get(p.id);
      if (!rt || p.alive !== 1) return;
      const rising = rt.input.interact && !rt.interactLatch;
      if (p.seat >= 0) {
        if (rising) this.dismount(p.id);
      } else if (this.tryRevive(p, rt, dt)) {
        /* channel */
      } else if (rising) {
        if (!this.tryToggleDoor(p)) this.tryMount(p);
      }
      if (!rt.input.interact) rt.reviveLeft = 0;
      rt.interactLatch = rt.input.interact;
    });
  }

  private tryToggleDoor(p: PlayerState): boolean {
    const door = doorAt(this.map, p.x, p.y, 48);
    if (!door) return false;
    const st = this.state.doors.get(door.id);
    if (!st) return false;
    st.open = st.open ? 0 : 1;
    this.emit({
      t: "notice",
      id: p.id,
      text: st.open ? "Door opened." : "Door closed.",
    });
    return true;
  }

  private ram(bike: VehicleState, driver: PlayerState | undefined): void {
    const speed = Math.abs(bike.speed);
    if (!bike.alive || speed < 120 || bike.z > 70) return;
    const reach = 40;
    this.state.players.forEach((p) => {
      if (p.alive === 0 || p.id === bike.driver || p.id === bike.passenger) return;
      const dx = p.x - bike.x;
      const dy = p.y - bike.y;
      if (dx * dx + dy * dy > reach * reach) return;
      const rt = this.rt.get(p.id);
      if (rt && rt.ramLeft > 0) return;
      const dmg = Math.round(Math.min(72, 10 + (speed - 120) * 0.16));
      const before = p.hp;
      const label = bike.kind === "heli" ? "Helicopter" : bike.kind === "car" ? "Ford Fusion" : bike.kind === "ebike" ? "eBike" : "Vehicle";
      const landed = this.hurt(p, dmg, driver, label, bike.x, bike.y, false, true);
      if (!landed) return;
      if (rt) rt.ramLeft = 0.55;
      const push = 16 + Math.min(28, speed * 0.04);
      const nx = p.x + Math.cos(bike.heading) * Math.sign(bike.speed || 1) * push;
      const ny = p.y + Math.sin(bike.heading) * Math.sign(bike.speed || 1) * push;
      if (!blockedAt(this.map, nx, ny)) {
        p.x = nx;
        p.y = ny;
      }
      bike.speed *= 0.62;
      console.log(`[ram] ${label} ${Math.round(speed)} ${driver?.name || "empty"} -> ${p.name} ${before}->${p.hp}`);
    });
  }

  private tryMount(p: PlayerState): void {
    let best: VehicleState | null = null;
    let bestD = 54 * 54;
    this.state.vehicles.forEach((bike) => {
      if (!bike.alive || bike.z > 64) return;
      const dx = bike.x - p.x;
      const dy = bike.y - p.y;
      const reach = bike.kind === "heli" ? 78 : bike.kind === "car" ? 96 : 54;
      const d = dx * dx + dy * dy;
      if (d < reach * reach && d < bestD) { best = bike; bestD = d; }
    });
    if (!best) return;
    const bike: VehicleState = best;
    if (!bike.driver) {
      bike.driver = p.id;
      p.vehicleId = bike.id;
      p.seat = 0;
    } else if (bike.seats > 1 && !bike.passenger && bike.driver !== p.id) {
      bike.passenger = p.id;
      p.vehicleId = bike.id;
      p.seat = 1;
    }
  }

  private dismount(id: string): void {
    const p = this.state.players.get(id);
    if (!p || p.seat < 0) return;
    const bike = this.state.vehicles.get(p.vehicleId);
    if (bike) {
      if (bike.driver === id) bike.driver = "";
      if (bike.passenger === id) bike.passenger = "";
      const side = (bike.heading || 0) + Math.PI / 2;
      let x = bike.x + Math.cos(side) * 34;
      let y = bike.y + Math.sin(side) * 34;
      if (blockedAt(this.map, x, y)) {
        x = bike.x - Math.cos(side) * 34;
        y = bike.y - Math.sin(side) * 34;
      }
      p.x = x;
      p.y = y;
      if (bike.kind === "heli") p.floorZ = bike.z;
    }
    p.vehicleId = "";
    p.seat = -1;
  }

  private tryRevive(p: PlayerState, rt: RT, dt: number): boolean {
    if ((p.classId as ClassId) !== "medic" || p.seat >= 0 || !rt.input.interact) return false;
    let target: PlayerState | null = null;
    let best = 56 * 56;
    this.state.players.forEach((other) => {
      if (other.alive !== 2 || !this.sameTeam(p, other)) return;
      const dx = other.x - p.x;
      const dy = other.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; target = other; }
    });
    if (!target) return false;
    const downed: PlayerState = target;
    rt.reviveLeft += dt;
    if (rt.reviveLeft >= 2.1) {
      downed.alive = 1;
      downed.hp = 45;
      downed.respawnLeft = 0;
      const tr = this.rt.get(downed.id);
      if (tr) tr.downedLeft = 0;
      rt.reviveLeft = 0;
      this.emit({ t: "notice", id: downed.id, text: `${p.name} revived you` });
    }
    return true;
  }

  private combat(dt: number): void {
    this.eachPlayer((p) => {
      const rt = this.rt.get(p.id);
      if (!rt) return;
      rt.cooldown = Math.max(0, rt.cooldown - dt);
      rt.heat = Math.max(0, rt.heat - dt * 0.08);
      rt.grenadeCd = Math.max(0, rt.grenadeCd - dt);
      rt.abilityCd = Math.max(0, rt.abilityCd - dt);
      rt.abilityLeft = Math.max(0, rt.abilityLeft - dt);
      rt.suppressLeft = Math.max(0, rt.suppressLeft - dt);
      rt.pulseLeft = Math.max(0, rt.pulseLeft - dt);
      rt.lockLeft = Math.max(0, rt.lockLeft - dt);
      rt.sprintLeft = Math.max(0, rt.sprintLeft - dt);
      rt.slowLeft = Math.max(0, rt.slowLeft - dt);
      rt.ramLeft = Math.max(0, rt.ramLeft - dt);
      rt.noiseLeft = Math.max(0, rt.noiseLeft - dt);
      rt.invulnLeft = Math.max(0, rt.invulnLeft - dt);
      rt.cheeseWeakenLeft = Math.max(0, rt.cheeseWeakenLeft - dt);
      rt.damageBuffLeft = Math.max(0, rt.damageBuffLeft - dt);
      if (p.alive !== 1) {
        rt.fireLatch = rt.input.fire;
        return;
      }
      if (!this.tryPlaceColt(p, rt)) this.ability(p, rt);
      this.reload(p, rt, dt);
      const ride = p.vehicleId ? this.state.vehicles.get(p.vehicleId) : undefined;
      if (p.seat === 0 && ride?.kind === "heli") this.fireHeliSmg(p, rt, ride, dt);
      else this.fire(p, rt);
      this.throwGrenade(p, rt);
      this.tryPlaceColt(p, rt);
      rt.fireLatch = rt.input.fire;
      rt.abilityLatch = rt.input.ability;
      rt.grenadeLatch = rt.input.grenade;
      if (rt.input.slot !== p.weaponSlot && !rt.reloading) {
        const def = CLASSES[p.classId as ClassId];
        if (rt.input.slot === 4) {
          if (def.grenades > 0) p.weaponSlot = 4;
        } else if (rt.input.slot === 5) {
          p.weaponSlot = 5; // cheese gun
        } else {
          const item = rt.input.slot === 1 ? def.primary : rt.input.slot === 2 ? def.secondary : def.special;
          if (item) p.weaponSlot = rt.input.slot;
        }
      }
    });
    this.stepProjectiles(dt);
    this.decayBarricades(dt);
  }

  private ability(p: PlayerState, rt: RT): void {
    const rising = rt.input.ability && !rt.abilityLatch;
    if (!rising || rt.abilityCd > 0) return;
    const def = CLASSES[p.classId as ClassId];
    if (def.ability === "sprint") {
      rt.sprintLeft = 2.2;
      rt.abilityCd = def.abilityCd;
      this.emit({ t: "ability", id: p.id, kind: "sprint" });
    } else if (def.ability === "heal") {
      let target = p;
      let missing = p.maxHp - p.hp;
      this.state.players.forEach((other) => {
        if (other.alive !== 1 || !this.sameTeam(p, other)) return;
        const dx = other.x - p.x;
        const dy = other.y - p.y;
        if (dx * dx + dy * dy > 110 * 110) return;
        const gap = other.maxHp - other.hp;
        if (gap > missing) { missing = gap; target = other; }
      });
      if (missing > 0) {
        target.hp = Math.min(target.maxHp, target.hp + 45);
        rt.abilityCd = def.abilityCd;
        this.emit({ t: "ability", id: p.id, kind: "heal" });
      }
    } else if (def.ability === "suppress") {
      rt.suppressLeft = 3.2;
      rt.abilityCd = def.abilityCd;
      this.emit({ t: "ability", id: p.id, kind: "suppress" });
    } else if (def.ability === "pulse") {
      rt.pulseLeft = 4;
      rt.abilityCd = def.abilityCd;
      this.emit({ t: "ability", id: p.id, kind: "pulse" });
    } else if (def.ability === "repair") {
      let done = false;
      this.state.vehicles.forEach((bike) => {
        if (done || !bike.alive || bike.hp >= bike.maxHp) return;
        const dx = bike.x - p.x;
        const dy = bike.y - p.y;
        if (dx * dx + dy * dy < 80 * 80) {
          bike.hp = Math.min(bike.maxHp, bike.hp + 48);
          done = true;
          this.emit({ t: "repair", x: bike.x, y: bike.y });
        }
      });
      if (!done) {
        this.state.barricades.forEach((b) => {
          if (done || b.hp >= 90) return;
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          if (dx * dx + dy * dy < 80 * 80) {
            b.hp = Math.min(90, b.hp + 40);
            done = true;
            this.emit({ t: "repair", x: b.x, y: b.y });
          }
        });
      }
      if (done) rt.abilityCd = def.abilityCd;
    } else if (def.ability === "lock") {
      rt.lockLeft = 6;
      rt.abilityCd = def.abilityCd;
      this.emit({ t: "ability", id: p.id, kind: "lock" });
    }
  }

  private reload(p: PlayerState, rt: RT, dt: number): void {
    if (p.weaponSlot === 4) {
      if (rt.reloading) {
        rt.reloading = false;
        rt.reloadLeft = 0;
      }
      return;
    }
    const idx = p.weaponSlot - 1;
    const weapon = this.weaponInSlot(p, p.weaponSlot);
    if (rt.reloading) {
      rt.reloadLeft -= dt;
      if (rt.reloadLeft <= 0 && weapon) {
        const need = weapon.mag - rt.mags[idx];
        const take = Math.max(0, Math.min(need, rt.reserves[idx]));
        rt.mags[idx] += take;
        rt.reserves[idx] -= take;
        rt.reloading = false;
      }
      return;
    }
    if (!weapon) return;
    const want = rt.input.reload || (rt.input.fire && rt.mags[idx] <= 0);
    if (want && rt.mags[idx] < weapon.mag && rt.reserves[idx] > 0) {
      rt.reloading = true;
      rt.reloadDur = weapon.reload * (p.seat === 0 ? 1.25 : 1);
      rt.reloadLeft = rt.reloadDur;
    }
  }

  private aimAt(x: number, y: number, input: MoveInput): number {
    if (Number.isFinite(input.aim)) return input.aim;
    if (Number.isFinite(input.ax) && Number.isFinite(input.ay)) return Math.atan2(input.ay - y, input.ax - x);
    return 0;
  }

  /** Shooter/target eye & body heights in world px (z up). */
  private stanceOf(rt: RT | undefined, onBike: boolean): {
    eye: number; feet: number; head: number; torso: number;
  } {
    const crouch = !!rt?.input.crouch && !onBike;
    const jumpZ = rt?.input.jumpZ ?? 0;
    const floorZ = rt?.input.floorZ ?? 0;
    const bike = onBike ? 18 : 0;
    const feet = floorZ + jumpZ + bike;
    if (crouch) {
      return { eye: feet + 46, feet, head: feet + 54, torso: feet + 40 };
    }
    return { eye: feet + 74, feet, head: feet + 86, torso: feet + 66 };
  }

  private traceShot(p: PlayerState, ang: number, weapon: import("@sixfront/shared").WeaponDef): { x: number; y: number; z: number; z0: number } {
    const range = (weapon.falloffEnd + 120) * GUN_RANGE;
    const atkRt = this.rt.get(p.id);
    const pitch = atkRt?.input.pitch ?? 0;
    const stance = this.stanceOf(atkRt, p.seat >= 0);
    const z0 = stance.eye;
    // Ray origin at shooter feet/eye XY — matches camera crosshair axis (no lateral muzzle bias).
    const x1 = p.x;
    const y1 = p.y;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    // pitch > 0 = look up (MoveInput); height rises along the aim ray.
    const tanP = Math.tan(pitch);
    let best = range;
    let victim: PlayerState | undefined;
    let head = false;
    let bikeHit: VehicleState | undefined;
    let barricade: BarricadeState | undefined;
    const nearer = (dist: number | null): dist is number => dist !== null && dist >= 0 && dist < best;
    const zAt = (s: number) => z0 + s * tanP;

    // Ground intercept when aiming down
    if (tanP < -0.02) {
      const sGround = (2 - z0) / tanP;
      if (sGround > 8 && sGround < best) best = sGround;
    }

    for (const solid of this.map.solids) {
      const dist = rayRect(x1, y1, dx, dy, best, solid);
      if (!nearer(dist)) continue;
      const zh = zAt(dist);
      // Tall walls (~3.2m); shots above crest can clear
      if (zh > 155) continue;
      best = dist;
      victim = undefined;
      bikeHit = undefined;
      barricade = undefined;
    }
    for (const src of this.map.doors) {
      const st = this.state.doors.get(src.id);
      if (!st || st.open) continue;
      const dist = rayRect(x1, y1, dx, dy, best, src);
      if (!nearer(dist)) continue;
      if (zAt(dist) > 155) continue;
      best = dist;
      victim = undefined;
      bikeHit = undefined;
      barricade = undefined;
    }
    this.state.barricades.forEach((bar) => {
      const dist = rayRect(x1, y1, dx, dy, best, bar);
      if (!nearer(dist)) return;
      if (zAt(dist) > 70) return;
      best = dist;
      victim = undefined;
      bikeHit = undefined;
      barricade = bar;
    });
    for (let step = 10; step < best; step += 12) {
      if (blockedAt(this.map, x1 + dx * step, y1 + dy * step)) {
        if (zAt(step) <= 155) {
          best = step;
          victim = undefined;
          bikeHit = undefined;
          barricade = undefined;
          break;
        }
      }
    }
    let nearest = Infinity;
    let nearestName = "";
    this.state.players.forEach((other) => {
      if (other.id === p.id || other.alive === 0) return;
      const gap = Math.hypot(other.x - p.x, other.y - p.y);
      if (gap < nearest) {
        nearest = gap;
        nearestName = other.name;
      }
      const dist = rayCircle(x1, y1, dx, dy, other.x, other.y, isDerl(other.id) ? 48 : 32);
      if (!nearer(dist)) return;
      const oRt = this.rt.get(other.id);
      const body = this.stanceOf(oRt, other.seat >= 0);
      const zh = zAt(dist);
      const top = isDerl(other.id) ? body.head + 48 : body.head + 18;
      const bot = body.feet - 4;
      if (zh < bot || zh > top) return;
      best = dist;
      victim = other;
      bikeHit = undefined;
      barricade = undefined;
      head = zh >= body.torso;
    });
    this.state.vehicles.forEach((bike) => {
      if (!bike.alive) return;
      const dist = rayCircle(x1, y1, dx, dy, bike.x, bike.y, 22);
      if (!nearer(dist)) return;
      const zh = zAt(dist);
      if (zh < 4 || zh > 55) return;
      best = dist;
      victim = undefined;
      bikeHit = bike;
      barricade = undefined;
    });
    const hx = x1 + dx * best;
    const hy = y1 + dy * best;
    const hz = zAt(best);
    if (barricade) barricade.hp -= Math.round(weapon.damage * 0.5);
    if (victim) {
      const before = victim.hp;
      let amount = weapon.damage * falloff(weapon, Math.hypot(p.x - victim.x, p.y - victim.y)) * (head ? 1.35 : 1);
      if (atkRt && atkRt.damageBuffLeft > 0) amount *= 1.25;
      this.hurt(victim, amount, p, weapon.id, hx, hy, head);
      if (weapon.id === "cheese" && isDerl(victim.id)) {
        const vRt = this.rt.get(victim.id);
        if (vRt) vRt.cheeseWeakenLeft = CHEESE_WEAKEN_SEC;
        if (atkRt) atkRt.damageBuffLeft = CHEESE_BUFF_SEC;
        this.emit({ t: "notice", id: p.id, text: "Derl weakened — vile fluids! +25% damage" });
      }
      const why = victim.hp === before ? "no-damage" : "hit";
      console.log(`[shot] ${why} ${p.name} -> ${victim.name} ${before}->${victim.hp} teams ${p.team}/${victim.team} mode ${this.state.mode}`);
    } else if (bikeHit) {
      bikeHit.hp -= Math.max(1, Math.round(weapon.damage * weapon.vehicleMul));
      this.emit({ t: "impact", x: bikeHit.x, y: bikeHit.y, kind: "metal" });
      if (bikeHit.hp <= 0) this.destroyBike(bikeHit, p.id);
    } else if (this.missLog++ % 25 === 0) {
      console.log(`[shot] miss ${p.name} nearest ${nearestName || "nobody"} ${Number.isFinite(nearest) ? Math.round(nearest) : "-"}px`);
    }
    if (!victim && !bikeHit) this.emit({ t: "impact", x: hx, y: hy, kind: weapon.id });
    return { x: hx, y: hy, z: hz, z0 };
  }

  private fireHeliSmg(p: PlayerState, rt: RT, heli: VehicleState, dt: number): void {
    const br = this.bikes.get(heli.id);
    if (!br) return;
    br.rocketCd = Math.max(0, br.rocketCd - dt);
    if (!rt.input.fire) return;
    const weapon = WEAPONS.smg;
    const step = 60 / weapon.rpm;
    let guard = 0;
    while (br.rocketCd <= 0 && guard < 2) {
      guard++;
      br.rocketCd += step;
      const ang = p.aim;
      const savedX = p.x;
      const savedY = p.y;
      p.x = heli.x;
      p.y = heli.y;
      const end = this.traceShot(p, ang, weapon);
      p.x = savedX;
      p.y = savedY;
      this.emit({
        t: "shoot", id: p.id, x: heli.x, y: heli.y, aim: ang, weapon: "smg",
        x2: end.x, y2: end.y, z1: end.z0, z2: end.z,
      });
    }
  }

  private fire(p: PlayerState, rt: RT): void {
    if (p.weaponSlot === 4) return; // hotdog selected — throwGrenade handles LMB
    if (p.weaponSlot === 3 && (p.classId as ClassId) === "engineer") {
      if (rt.input.fire && !rt.fireLatch) this.deployBarricade(p, rt);
      return;
    }
    const weapon = this.weaponInSlot(p, p.weaponSlot);
    const idx = p.weaponSlot - 1;
    if (!weapon || rt.reloading) return;
    const shooting = weapon.auto ? rt.input.fire : rt.input.fire && !rt.fireLatch;
    if (!shooting) return;
    let guard = 0;
    while (rt.cooldown <= 0 && rt.mags[idx] > 0 && guard < 3) {
      guard++;
      rt.mags[idx]--;
      rt.cooldown += 60 / weapon.rpm;
      rt.noiseLeft = 1.4;
      rt.heat = Math.min(0.05, rt.heat + weapon.heat);
      for (let pellet = 0; pellet < weapon.pellets; pellet++) {
        const ang = p.aim;
        if (weapon.kind === "bullet") {
          const end = this.traceShot(p, ang, weapon);
          this.emit({
            t: "shoot", id: p.id, x: p.x, y: p.y, aim: ang, weapon: weapon.id,
            x2: end.x, y2: end.y, z1: end.z0, z2: end.z,
          });
          continue;
        }
        const id = `b${this.seq++}`;
        const speed = weapon.speed;
        const pitch = rt.input.pitch;
        const cosP = Math.cos(pitch);
        const stance = this.stanceOf(rt, p.seat >= 0);
        const proj: Proj = {
          id, x: p.x + Math.cos(ang) * 18, y: p.y + Math.sin(ang) * 18, z: stance.eye * 0.85,
          vz: Math.sin(pitch) * speed, vx: Math.cos(ang) * speed * cosP, vy: Math.sin(ang) * speed * cosP,
          team: p.team, ownerId: p.id,
          weapon: weapon.id, ttl: 1.6, radius: weapon.radius,
          damage: weapon.damage, splash: weapon.splash, splashDamage: weapon.splashDamage,
          vehicleMul: weapon.vehicleMul * (rt.lockLeft > 0 && weapon.id === "rocket" ? 1.2 : 1),
          kind: weapon.kind,
        };
        this.projs.push(proj);
        const view = new ProjectileState();
        view.id = id;
        view.kind = proj.kind;
        view.owner = p.id;
        view.team = p.team;
        view.weapon = weapon.id;
        view.x = proj.x;
        view.y = proj.y;
        view.vx = proj.vx;
        view.vy = proj.vy;
        this.state.projectiles.set(id, view);
        this.emit({
          t: "shoot", id: p.id, x: p.x, y: p.y, aim: ang, weapon: weapon.id,
          x2: p.x + Math.cos(ang) * 80, y2: p.y + Math.sin(ang) * 80,
        });
      }
      if (rt.suppressLeft > 0) this.applySuppress(p);
      if (!weapon.auto) break;
    }
  }

  private applySuppress(p: PlayerState): void {
    this.state.players.forEach((other) => {
      if (other.alive !== 1 || this.sameTeam(p, other)) return;
      const dx = other.x - p.x;
      const dy = other.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 460 || dist < 1) return;
      const aim = Math.atan2(dy, dx);
      let delta = aim - p.aim;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) < 0.7) {
        const rt = this.rt.get(other.id);
        if (rt) rt.slowLeft = 0.4;
        other.blip = 1;
      }
    });
  }

  private throwGrenade(p: PlayerState, rt: RT): void {
    const gKey = rt.input.grenade && !rt.grenadeLatch;
    const gFire = p.weaponSlot === 4 && rt.input.fire && !rt.fireLatch;
    // G with a smoke canister → smoke. Hotdog stays on key 4 (LMB) and on G when empty-handed.
    if (gKey && rt.smokes > 0) {
      this.throwSmoke(p, rt);
      return;
    }
    const rising = gKey || gFire;
    if (!rising || rt.grenadeCd > 0) return;
    if (this.grenadesLeft(p, rt) <= 0) return;
    rt.grenadeCd = 0.55;
    rt.nadeUsed += 1;
    const g = WEAPONS.grenade;
    const id = `g${this.seq++}`;
    // Longer fuse so it can arc + bounce, but splat forces detonate on 2nd ground hit
    const fuse = 2.4;
    const hand = 40;
    const stance = this.stanceOf(rt, p.seat >= 0);
    const loft = 290 + Math.sin(rt.input.pitch) * 180;
    const speed = g.speed * Math.cos(rt.input.pitch);
    const proj: Proj = {
      id,
      x: p.x + Math.cos(p.aim) * hand,
      y: p.y + Math.sin(p.aim) * hand,
      z: stance.eye,
      vz: loft,
      vx: Math.cos(p.aim) * speed,
      vy: Math.sin(p.aim) * speed,
      team: p.team, ownerId: p.id, weapon: "grenade", ttl: fuse, radius: 6, damage: 0,
      splash: g.splash, splashDamage: g.splashDamage, vehicleMul: g.vehicleMul, kind: "grenade",
      bounces: 0,
    };
    this.projs.push(proj);
    const view = new ProjectileState();
    view.id = id;
    view.kind = "grenade";
    view.owner = p.id;
    view.team = p.team;
    view.weapon = "grenade";
    this.state.projectiles.set(id, view);
    this.emit({ t: "shoot", id: p.id, x: p.x, y: p.y, aim: p.aim, weapon: "grenade", x2: proj.x, y2: proj.y });
  }

  /** Arc throw — pops a vision-blocking smoke cloud on first ground contact. */
  private throwSmoke(p: PlayerState, rt: RT): void {
    if (rt.grenadeCd > 0 || rt.smokes <= 0) return;
    rt.grenadeCd = 0.55;
    rt.smokes -= 1;
    p.smokes = rt.smokes;
    const g = WEAPONS.grenade;
    const id = `sm${this.seq++}`;
    const hand = 40;
    const stance = this.stanceOf(rt, p.seat >= 0);
    const loft = 290 + Math.sin(rt.input.pitch) * 180;
    const speed = g.speed * Math.cos(rt.input.pitch);
    const proj: Proj = {
      id,
      x: p.x + Math.cos(p.aim) * hand,
      y: p.y + Math.sin(p.aim) * hand,
      z: stance.eye,
      vz: loft,
      vx: Math.cos(p.aim) * speed,
      vy: Math.sin(p.aim) * speed,
      team: p.team, ownerId: p.id, weapon: "smoke", ttl: 3.2, radius: 6, damage: 0,
      splash: 0, splashDamage: 0, vehicleMul: 0, kind: "smoke",
      bounces: 0,
    };
    this.projs.push(proj);
    const view = new ProjectileState();
    view.id = id;
    view.kind = "smoke";
    view.owner = p.id;
    view.team = p.team;
    view.weapon = "smoke";
    this.state.projectiles.set(id, view);
    this.emit({ t: "shoot", id: p.id, x: p.x, y: p.y, aim: p.aim, weapon: "smoke", x2: proj.x, y2: proj.y });
  }

  private grenadesLeft(p: PlayerState, rt: RT): number {
    const max = CLASSES[p.classId as ClassId].grenades;
    return Math.max(0, max - rt.nadeUsed);
  }

  private deployBarricade(p: PlayerState, rt: RT): void {
    if (rt.barricades <= 0 || p.seat >= 0) return;
    rt.barricades--;
    const horizontal = Math.abs(Math.cos(p.aim)) > 0.5;
    const w = horizontal ? 70 : 18;
    const h = horizontal ? 18 : 70;
    const b = new BarricadeState();
    b.id = `bar-${this.seq++}`;
    b.x = p.x + Math.cos(p.aim) * 42 - w / 2;
    b.y = p.y + Math.sin(p.aim) * 42 - h / 2;
    b.w = w;
    b.h = h;
    b.hp = 90;
    b.team = p.team;
    b.owner = p.id;
    this.state.barricades.set(b.id, b);
  }

  private weaponInSlot(p: PlayerState, slot: number): import("@sixfront/shared").WeaponDef | null {
    if (slot === 5) return WEAPONS.cheese;
    if (slot === 4) return null;
    const def = CLASSES[p.classId as ClassId];
    const id = slot === 1 ? def.primary : slot === 2 ? def.secondary : def.special;
    if (!id || id === "barricade") return null;
    return WEAPONS[id as WeaponId];
  }

  private stepProjectiles(dt: number): void {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const proj = this.projs[i];
      const ox = proj.x;
      const oy = proj.y;
      proj.ttl -= dt;
      if (proj.kind === "smoke") {
        proj.vz -= 580 * dt;
        proj.z += proj.vz * dt;
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        if (proj.z <= 3 || proj.ttl <= 0) {
          this.deploySmoke(proj.x, proj.y);
          this.removeProj(i);
        }
        continue;
      }
      if (proj.kind === "grenade") {
        proj.vz -= 580 * dt;
        proj.z += proj.vz * dt;
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        // Arc → soft bounce → splat (explode) on second ground contact
        if (proj.z <= 3) {
          proj.z = 3;
          if ((proj.bounces ?? 0) < 1 && proj.vz < -60) {
            proj.bounces = 1;
            proj.vz = Math.abs(proj.vz) * 0.38;
            proj.vx *= 0.55;
            proj.vy *= 0.55;
          } else if ((proj.bounces ?? 0) >= 1 || proj.ttl <= 0.15) {
            this.explode(proj);
            this.removeProj(i);
            continue;
          } else {
            proj.vz = 0;
            proj.vx *= Math.max(0, 1 - 4 * dt);
            proj.vy *= Math.max(0, 1 - 4 * dt);
          }
        }
        if (proj.ttl <= 0) {
          this.explode(proj);
          this.removeProj(i);
        }
        continue;
      }
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      if (proj.kind === "rocket") proj.z += proj.vz * dt;
      let dead = proj.ttl <= 0 || proj.x < 0 || proj.y < 0 || proj.x > this.map.width || proj.y > this.map.height;
      if (!dead && proj.kind === "rocket" && proj.z <= 6) dead = true;
      if (!dead && blockedAt(this.map, proj.x, proj.y)) dead = true;
      if (!dead && proj.kind === "rocket" && proj.z <= 170) {
        for (const solid of this.map.solids) {
          if (segmentHitsRect(ox, oy, proj.x, proj.y, solid)) { dead = true; break; }
        }
      }
      if (!dead) {
        for (const src of this.map.doors) {
          const st = this.state.doors.get(src.id);
          if (!st || st.open) continue;
          if (segmentHitsRect(ox, oy, proj.x, proj.y, src)) { dead = true; break; }
        }
      }
      if (!dead) {
        this.state.barricades.forEach((b) => {
          if (dead) return;
          if (segmentHitsRect(ox, oy, proj.x, proj.y, b)) {
            b.hp -= Math.round(proj.damage * 0.5);
            dead = true;
          }
        });
      }
      if (!dead) dead = this.hitActors(proj, ox, oy);
      if (dead) {
        if (proj.kind === "rocket") this.explode(proj);
        else this.emit({ t: "impact", x: proj.x, y: proj.y, kind: proj.weapon });
        this.removeProj(i);
      }
    }
    for (const proj of this.projs) {
      const view = this.state.projectiles.get(proj.id);
      if (!view) continue;
      view.x = proj.x;
      view.y = proj.y;
      view.z = proj.z;
      view.vx = proj.vx;
      view.vy = proj.vy;
    }
  }

  private hitActors(proj: Proj, ox: number, oy: number): boolean {
    let hit = false;
    this.state.players.forEach((p) => {
      if (hit || p.alive === 0 || p.id === proj.ownerId) return;
        if (segmentHitsCircle(ox, oy, proj.x, proj.y, p.x, p.y, 16)) {
          if (proj.kind === "rocket") {
            hit = true;
            return;
          }
        const attacker = this.state.players.get(proj.ownerId);
        if (attacker && !this.state.friendlyFire && this.sameTeam(attacker, p) && attacker.id !== p.id) {
          hit = true;
          return;
        }
        const weapon = WEAPONS[proj.weapon as WeaponId] ?? WEAPONS.rifle;
        const dist = attacker ? Math.hypot(attacker.x - p.x, attacker.y - p.y) : 0;
        const head = Math.hypot((p.x + Math.cos(p.aim) * 10) - proj.x, (p.y + Math.sin(p.aim) * 10) - proj.y) < 8;
        const amount = proj.damage * falloff(weapon, dist) * (head ? 1.35 : 1);
        this.hurt(p, amount, attacker, proj.weapon, proj.x, proj.y, head);
        hit = true;
      }
    });
    if (hit) return true;
    this.state.vehicles.forEach((bike) => {
      if (hit || !bike.alive) return;
      if (segmentHitsCircle(ox, oy, proj.x, proj.y, bike.x, bike.y, 20)) {
        if (bike.driver === proj.ownerId || bike.passenger === proj.ownerId) return;
        if (proj.kind === "rocket") {
          hit = true;
          return;
        }
        bike.hp -= Math.max(1, Math.round(proj.damage * proj.vehicleMul));
        this.emit({ t: "impact", x: bike.x, y: bike.y, kind: "metal" });
        if (bike.hp <= 0) this.destroyBike(bike, proj.ownerId);
        hit = true;
      }
    });
    return hit;
  }

  private explode(proj: Proj): void {
    const kind = proj.weapon === "grenade" || proj.kind === "grenade" ? "hotdog" : proj.kind;
    this.emit({ t: "explode", x: proj.x, y: proj.y, kind });
    const attacker = this.state.players.get(proj.ownerId);
    this.state.players.forEach((p) => {
      if (p.alive === 0) return;
      const d = Math.hypot(p.x - proj.x, p.y - proj.y);
      if (d > proj.splash) return;
      const fall = 1 - d / proj.splash;
      const self = p.id === proj.ownerId ? 0.45 : 1;
      this.hurt(p, proj.splashDamage * fall * self, attacker, proj.weapon, proj.x, proj.y, false);
    });
    this.state.vehicles.forEach((bike) => {
      if (!bike.alive) return;
      const d = Math.hypot(bike.x - proj.x, bike.y - proj.y);
      if (d > proj.splash) return;
      bike.hp -= Math.round(proj.splashDamage * proj.vehicleMul * (1 - d / proj.splash));
      if (bike.hp <= 0) this.destroyBike(bike, proj.ownerId);
    });
    this.state.barricades.forEach((b, id) => {
      const d = Math.hypot(b.x - proj.x, b.y - proj.y);
      if (d < proj.splash) b.hp -= 50;
      if (b.hp <= 0) this.state.barricades.delete(id);
    });
  }

  private destroyBike(bike: VehicleState, ownerId: string): void {
    bike.hp = 0;
    bike.alive = 0;
    bike.speed = 0;
    const riders = [bike.driver, bike.passenger].filter(Boolean);
    bike.driver = "";
    bike.passenger = "";
    this.emit({ t: "explode", x: bike.x, y: bike.y, kind: "bike" });
    for (const rid of riders) {
      const rider = this.state.players.get(rid);
      if (!rider) continue;
      rider.vehicleId = "";
      rider.seat = -1;
      const attacker = this.state.players.get(ownerId);
      this.hurt(rider, 22, attacker, "ebike", bike.x, bike.y, false);
    }
    if (bike.base) bike.respawn = 22;
  }

  private hurt(
    target: PlayerState,
    amount: number,
    attacker: PlayerState | undefined,
    weapon: string,
    x: number,
    y: number,
    head: boolean,
    physical = false,
  ): boolean {
    if (this.warmup > 0 || target.alive === 0) {
      console.log(`[shot] blocked ${target.name} warmup=${this.warmup.toFixed(1)} alive=${target.alive}`);
      return false;
    }
    const rt = this.rt.get(target.id);
    if (!rt) {
      console.log(`[shot] blocked ${target.name} missing runtime`);
      return false;
    }
    if (target.alive === 1 && rt.invulnLeft > 0 && !physical) {
      console.log(`[shot] blocked ${target.name} spawn-shield ${rt.invulnLeft.toFixed(2)}s`);
      return false;
    }
    if (!physical && attacker && attacker.id !== target.id && !this.state.friendlyFire && this.sameTeam(attacker, target)) {
      console.log(`[shot] blocked friendly ${attacker.name} -> ${target.name} team ${target.team}`);
      return false;
    }
    const def = CLASSES[target.classId as ClassId] ?? CLASSES.rifleman;
    let raw = amount * def.armor;
    if (attacker && isDerl(attacker.id)) {
      const aRt = this.rt.get(attacker.id);
      if (aRt && aRt.cheeseWeakenLeft > 0) raw *= 0.75; // Derl attacks −25% when cheesed
      if (this.derlConfidence > 1.5) raw *= 0.8; // Colt 45: −20% damage
    }
    const dmg = Math.max(1, Math.round(raw));
    if (attacker) {
      rt.lastHitId = attacker.id;
      rt.lastHitName = attacker.name;
      rt.lastHitWeapon = WEAPONS[weapon as WeaponId]?.name ?? weapon;
      rt.lastHitDist = Math.round(Math.hypot(attacker.x - target.x, attacker.y - target.y));
      this.emit({ t: "hit", attacker: attacker.id, victim: target.id, x, y, dmg, head });
    }
    const dir = Math.atan2(target.y - y, target.x - x);
    this.emit({ t: "hurt", id: target.id, dir, dmg, fromX: x, fromY: y });
    if (target.alive === 2) {
      this.finishDeath(target, rt);
      return true;
    }
    target.hp -= dmg;
    if (isDerl(target.id)) {
      this.state.derlHp = Math.max(0, target.hp);
    }
    if (target.hp > 0) return true;
    target.hp = 0;
    if (isDerl(target.id)) {
      this.finishDerl(target, rt);
      return true;
    }
    if (isCheeseCurl(target.id)) {
      this.finishDeath(target, rt);
      this.emit({ t: "notice", id: "", text: "Mr. Cheese Curl got munched — he'll be back!" });
      return true;
    }
    if (!this.personal()) {
      target.alive = 2;
      rt.downedLeft = 7;
      this.dismount(target.id);
      this.emit({
        t: "down", id: target.id, by: rt.lastHitId, byName: rt.lastHitName,
        weapon: rt.lastHitWeapon, dist: rt.lastHitDist,
      });
      return true;
    }
    this.finishDeath(target, rt);
    return true;
  }

  private finishDerl(target: PlayerState, rt: RT): void {
    target.alive = 0;
    target.hp = 0;
    this.state.derlAlive = 0;
    this.state.derlHp = 0;
    this.state.derlConfidence = 1;
    this.derlConfidence = 1;
    const attacker = rt.lastHitId ? this.state.players.get(rt.lastHitId) : undefined;
    if (attacker && !isDerl(attacker.id)) {
      attacker.kills += 1;
      this.addScore(attacker, 150);
    }
    this.emit({
      t: "dead", id: target.id, by: rt.lastHitId, byName: rt.lastHitName || "Unknown",
      weapon: rt.lastHitWeapon || "cheese", dist: rt.lastHitDist,
    });
    this.emit({
      t: "feed", killer: rt.lastHitId, killerName: rt.lastHitName || "Someone",
      victim: target.id, victimName: "Derl", weapon: rt.lastHitWeapon || "cheese",
    });
    this.emit({ t: "notice", id: "", text: "Derl is down! The house is quiet… for now." });
    this.state.players.delete(DERL_ID);
    this.rt.delete(DERL_ID);
  }

  private removeDerl(): void {
    if (this.state.players.has(DERL_ID)) this.state.players.delete(DERL_ID);
    this.rt.delete(DERL_ID);
    this.state.derlAlive = 0;
    this.state.derlHp = 0;
  }

  private spawnCheeseCurl(): void {
    if (this.state.players.has(CHEESE_CURL_ID)) return;
    const p = new PlayerState();
    p.id = CHEESE_CURL_ID;
    p.name = CHEESE_CURL_NAME;
    p.identity = CHEESE_CURL_NAME;
    p.bot = 3;
    p.team = 8;
    p.classId = "rifleman";
    p.x = CHEESE_CURL_SPAWN.x;
    p.y = CHEESE_CURL_SPAWN.y;
    p.aim = 0;
    p.maxHp = CHEESE_CURL_HP;
    p.hp = CHEESE_CURL_HP;
    p.alive = 1;
    p.weaponSlot = 1;
    p.seat = -1;
    this.state.players.set(CHEESE_CURL_ID, p);
    const rt = this.freshRT("rifleman");
    rt.livesLeft = 99;
    rt.mags[0] = 0;
    rt.reserves[0] = 0;
    this.rt.set(CHEESE_CURL_ID, rt);
    this.cheeseGoal = { x: CHEESE_CURL_SPAWN.x, y: CHEESE_CURL_SPAWN.y, until: 0 };
    this.emit({ t: "notice", id: "", text: "Mr. Cheese Curl is running wild — shootable!" });
  }

  private removeCheeseCurl(): void {
    if (this.state.players.has(CHEESE_CURL_ID)) this.state.players.delete(CHEESE_CURL_ID);
    this.rt.delete(CHEESE_CURL_ID);
  }

  private pickCheeseGoal(): { x: number; y: number } {
    const spots = [
      ...this.map.spawns.map((s) => ({ x: s.x, y: s.y })),
      ...this.map.objectives.map((o) => ({ x: o.x, y: o.y })),
      { x: CHEESE_CURL_SPAWN.x, y: CHEESE_CURL_SPAWN.y },
    ];
    const pick = spots[Math.floor(Math.random() * spots.length)] ?? CHEESE_CURL_SPAWN;
    const jitter = 80;
    return {
      x: pick.x + (Math.random() * 2 - 1) * jitter,
      y: pick.y + (Math.random() * 2 - 1) * jitter,
    };
  }

  private spawnLocoPickups(): void {
    this.state.pickups.clear();
    LOCO_SPOTS.forEach((spot, i) => {
      const p = new PickupState();
      p.id = `loco-${i}`;
      p.kind = "loco";
      p.x = spot.x;
      p.y = spot.y;
      p.alive = 1;
      this.state.pickups.set(p.id, p);
    });
  }

  private spawnSmokePickups(): void {
    this.smokeRespawn.clear();
    SMOKE_SPOTS.forEach((spot, i) => {
      if (blockedAt(this.map, spot.x, spot.y)) return;
      const p = new PickupState();
      p.id = `smoke-${i}`;
      p.kind = "smoke";
      p.x = spot.x;
      p.y = spot.y;
      p.alive = 1;
      this.state.pickups.set(p.id, p);
    });
  }

  private deploySmoke(x: number, y: number): void {
    const id = `cloud-${this.seq++}`;
    const cloud = new SmokeCloudState();
    cloud.id = id;
    cloud.x = x;
    cloud.y = y;
    cloud.r = SMOKE_RADIUS;
    this.state.smokeClouds.set(id, cloud);
    this.smokeTtl.set(id, SMOKE_DURATION);
    this.emit({ t: "explode", x, y, kind: "smoke" });
  }

  private stepSmokeClouds(dt: number): void {
    const drop: string[] = [];
    this.smokeTtl.forEach((left, id) => {
      const next = left - dt;
      if (next <= 0) drop.push(id);
      else this.smokeTtl.set(id, next);
    });
    for (const id of drop) {
      this.smokeTtl.delete(id);
      this.state.smokeClouds.delete(id);
    }
  }

  private clearSmokeClouds(): void {
    this.smokeTtl.clear();
    this.state.smokeClouds.clear();
  }

  private spawnDerl(): void {
    if (this.state.players.has(DERL_ID)) return;
    const p = new PlayerState();
    p.id = DERL_ID;
    p.name = "Derl";
    p.identity = "Derl";
    p.bot = 2;
    p.team = 7;
    p.classId = "heavy";
    p.x = DERL_SPAWN.x;
    p.y = DERL_SPAWN.y;
    p.aim = 0;
    p.maxHp = DERL_MAX_HP;
    p.hp = DERL_MAX_HP;
    p.alive = 1;
    p.weaponSlot = 1;
    p.seat = -1;
    this.state.players.set(DERL_ID, p);
    const rt = this.freshRT("heavy");
    rt.mags[0] = 999;
    rt.reserves[0] = 999;
    this.rt.set(DERL_ID, rt);
    this.derlConfidence = 1;
    this.state.derlAlive = 1;
    this.state.derlHp = DERL_MAX_HP;
    this.state.derlMaxHp = DERL_MAX_HP;
    this.state.derlConfidence = 1;
    this.humans().forEach((h) => {
      const hrt = this.rt.get(h.id);
      if (hrt) hrt.colt45 = COLT45_STOCK;
    });
    this.emit({ t: "notice", id: "", text: "DERL HAS ENTERED THE HOUSE — cheese gun (5) and drop Colt 45 (F)!" });
  }

  private stepDerl(dt: number): void {
    void dt;
    if (this.state.phase !== "play") return;
    this.derlSpawnAt = 0;
    const derl = this.state.players.get(DERL_ID);
    if (derl && derl.alive === 1) {
      this.state.derlHp = derl.hp;
      this.state.derlConfidence = this.derlConfidence;
    }
  }

  /** F during Derl fight places a Colt 45 bottle — confidence up, attack speed/dmg down. */
  private tryPlaceColt(p: PlayerState, rt: RT): boolean {
    if (!this.state.derlAlive || isDerl(p.id)) return false;
    const rising = rt.input.ability && !rt.abilityLatch;
    if (!rising || rt.colt45 <= 0 || p.seat >= 0) return false;
    rt.colt45 -= 1;
    const bottle = new PickupState();
    bottle.id = `colt-${this.seq++}`;
    bottle.kind = "colt";
    bottle.x = p.x + Math.cos(p.aim) * 36;
    bottle.y = p.y + Math.sin(p.aim) * 36;
    bottle.alive = 1;
    this.state.pickups.set(bottle.id, bottle);
    this.derlConfidence = Math.min(4, this.derlConfidence * 3);
    this.state.derlConfidence = this.derlConfidence;
    this.emit({ t: "notice", id: p.id, text: "Colt 45 dropped — Derl's confidence skyrockets!" });
    this.emit({ t: "ability", id: p.id, kind: "colt45" });
    return true;
  }

  private stepPickups(): void {
    const remove: string[] = [];
    this.smokeRespawn.forEach((left, id) => {
      const next = left - TICK;
      if (next <= 0) {
        const pick = this.state.pickups.get(id);
        if (pick && pick.kind === "smoke") pick.alive = 1;
        this.smokeRespawn.delete(id);
      } else {
        this.smokeRespawn.set(id, next);
      }
    });
    this.state.pickups.forEach((pick, id) => {
      if (!pick.alive) {
        // Smoke pads stay in the map and respawn; loco/colt are one-shot.
        if (pick.kind !== "smoke") remove.push(id);
        return;
      }
      if (pick.kind === "loco") {
        this.state.players.forEach((p) => {
          if (!pick.alive || p.alive !== 1 || isDerl(p.id)) return;
          const d = (p.x - pick.x) ** 2 + (p.y - pick.y) ** 2;
          if (d > 38 * 38) return;
          const heal = Math.round(p.maxHp * 0.5);
          p.hp = Math.min(p.maxHp, p.hp + heal);
          pick.alive = 0;
          remove.push(id);
          this.emit({ t: "notice", id: p.id, text: "4Loco! +50% health" });
          this.emit({ t: "ability", id: p.id, kind: "loco" });
        });
      } else if (pick.kind === "colt") {
        const derl = this.state.players.get(DERL_ID);
        if (derl && derl.alive === 1) {
          const dd = (derl.x - pick.x) ** 2 + (derl.y - pick.y) ** 2;
          if (dd < 48 * 48) {
            pick.alive = 0;
            remove.push(id);
          }
        }
      } else if (pick.kind === "smoke") {
        this.state.players.forEach((p) => {
          if (!pick.alive || p.alive !== 1 || isDerl(p.id) || isCheeseCurl(p.id)) return;
          const rt = this.rt.get(p.id);
          if (!rt || rt.smokes >= SMOKE_CARRY_MAX) return;
          const d = (p.x - pick.x) ** 2 + (p.y - pick.y) ** 2;
          if (d > 38 * 38) return;
          rt.smokes += 1;
          p.smokes = rt.smokes;
          pick.alive = 0;
          this.smokeRespawn.set(id, SMOKE_RESPAWN);
          this.emit({ t: "notice", id: p.id, text: "Picked up a smoke grenade" });
        });
      }
    });
    for (const id of remove) this.state.pickups.delete(id);
  }

  private finishDeath(target: PlayerState, rt: RT): void {
    if (target.alive === 0) return;
    target.alive = 0;
    target.hp = 0;
    target.deaths += 1;
    rt.downedLeft = 0;
    this.dismount(target.id);
    const attacker = rt.lastHitId ? this.state.players.get(rt.lastHitId) : undefined;
    if (attacker && attacker.id !== target.id) {
      attacker.kills += 1;
      const pts = MODE_MAP[this.settings.mode].pointsPerKill;
      if (pts) this.addScore(attacker, pts);
    }
    target.killerName = rt.lastHitName || "Unknown";
    target.killerWeapon = rt.lastHitWeapon || "Unknown";
    target.killerDist = rt.lastHitDist;
    const mode = MODE_MAP[this.settings.mode];
    target.respawnLeft = isCheeseCurl(target.id)
      ? Math.max(4, this.settings.respawn || 5)
      : (mode.respawn ? this.settings.respawn : 0);
    this.emit({
      t: "dead", id: target.id, by: rt.lastHitId, byName: target.killerName,
      weapon: target.killerWeapon, dist: target.killerDist,
    });
    this.emit({
      t: "feed", killer: rt.lastHitId, killerName: target.killerName, victim: target.id,
      victimName: target.name, weapon: target.killerWeapon,
    });
  }

  private addScore(p: PlayerState, amount: number): void {
    p.score += amount;
    if (this.personal()) return;
    if (p.team === 0) this.state.score0 += amount;
    else if (p.team === 1) this.state.score1 += amount;
    else if (p.team === 2) this.state.score2 += amount;
  }

  private removeProj(index: number): void {
    const proj = this.projs[index];
    this.state.projectiles.delete(proj.id);
    this.projs.splice(index, 1);
  }

  private clearProjectiles(): void {
    this.projs.splice(0, this.projs.length);
    this.state.projectiles.clear();
  }

  private decayBarricades(dt: number): void {
    this.state.barricades.forEach((b, id) => {
      b.hp -= dt * 3.2;
      if (b.hp <= 0) this.state.barricades.delete(id);
    });
  }

  private capture(dt: number): void {
    for (const zone of this.state.objectives) this.captureZone(zone, dt, true);
    this.state.towers.forEach((tower) => {
      this.captureGeneric({
        id: tower.id,
        x: tower.x,
        y: tower.y,
        r: 88,
        owner: tower.owner,
        progress: tower.progress,
        progressTeam: tower.progressTeam,
        active: 1,
        set: (owner, progress, team) => {
          tower.owner = owner;
          tower.progress = progress;
          tower.progressTeam = team;
        },
      }, dt, 5.5, false);
    });
  }

  private captureZone(zone: { id: string; x: number; y: number; r: number; owner: number; progress: number; progressTeam: number; active: number }, dt: number, score: boolean): void {
    this.captureGeneric({
      ...zone,
      set: (owner, progress, team) => {
        const prev = zone.owner;
        zone.owner = owner;
        zone.progress = progress;
        zone.progressTeam = team;
        if (score && owner !== prev && owner >= 0) this.emit({ t: "capture", id: zone.id, owner });
      },
    }, dt, 8, true);
  }

  private captureGeneric(
    zone: {
      id: string; x: number; y: number; r: number; owner: number; progress: number; progressTeam: number; active: number;
      set: (owner: number, progress: number, team: number) => void;
    },
    dt: number,
    seconds: number,
    requireActive: boolean,
  ): void {
    if (requireActive && !zone.active) return;
    const counts = new Map<number, number>();
    this.state.players.forEach((p) => {
      if (p.alive !== 1) return;
      const dx = p.x - zone.x;
      const dy = p.y - zone.y;
      if (dx * dx + dy * dy > zone.r * zone.r) return;
      const key = this.personal() ? this.teamKey(p) : p.team;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    if (counts.size !== 1) return;
    const [team, count] = [...counts.entries()][0];
    const rate = (100 / seconds) * (1 + 0.55 * (count - 1));
    if (zone.owner === team) {
      zone.set(team, 100, team);
      return;
    }
    if (zone.owner === -1 || zone.progressTeam === team || zone.progress <= 0) {
      const progress = Math.min(100, zone.progress + rate * dt);
      if (progress >= 100) zone.set(team, 100, team);
      else zone.set(zone.owner, progress, team);
    } else {
      const progress = zone.progress - rate * dt;
      if (progress <= 0) zone.set(-1, 0, team);
      else zone.set(zone.owner, progress, zone.progressTeam);
    }
  }

  private teamKey(p: PlayerState): number {
    if (!p.bot && p.identity) return IDENTITIES.indexOf(p.identity as Identity);
    return 10 + (p.team % 20);
  }

  private scoreTick(dt: number): void {
    if (this.warmup > 0) return;
    const mode = MODE_MAP[this.settings.mode];
    if (!mode.pointsPerSecond) return;
    this.scoreAcc += dt;
    if (this.scoreAcc < 1) return;
    this.scoreAcc -= 1;
    this.state.objectives.forEach((o) => {
      if (!o.active || o.owner < 0) return;
      if (this.personal()) {
        this.state.players.forEach((p) => {
          const key = p.bot ? 10 + p.team : IDENTITIES.indexOf(p.identity as Identity);
          if (key === o.owner) p.score += mode.pointsPerSecond;
        });
      } else if (o.owner === 0) this.state.score0 += mode.pointsPerSecond;
      else if (o.owner === 1) this.state.score1 += mode.pointsPerSecond;
      else if (o.owner === 2) this.state.score2 += mode.pointsPerSecond;
    });
  }

  private life(dt: number): void {
    const mode = MODE_MAP[this.settings.mode];
    this.eachPlayer((p) => {
      const rt = this.rt.get(p.id);
      if (!rt) return;
      if (p.alive === 2) {
        rt.downedLeft -= dt;
        p.respawnLeft = Math.max(0, rt.downedLeft);
        if (rt.downedLeft <= 0) this.finishDeath(p, rt);
      } else if (p.alive === 0 && (mode.respawn || isCheeseCurl(p.id))) {
        p.respawnLeft = Math.max(0, p.respawnLeft - dt);
        if (p.respawnLeft <= 0) this.spawn(p);
      }
    });
  }

  private visibility(): void {
    const humans = this.humans();
    const now = this.tickCount * TICK;
    this.eachPlayer((target) => {
      let mask = 0;
      const seers: PlayerState[] = [];
      for (const viewer of humans) {
        const bit = 1 << Math.max(0, IDENTITIES.indexOf(viewer.identity as Identity));
        const key = `${viewer.id}:${target.id}`;
        const seen = viewer.id === target.id || this.sameTeam(viewer, target) || this.canSee(viewer, target);
        if (seen) this.spotUntil.set(key, now + 2.5);
        if (seen || (this.spotUntil.get(key) ?? 0) > now) {
          seers.push(viewer);
          mask |= bit;
        }
      }
      if (!this.personal()) {
        for (const viewer of humans) {
          if (seers.some((s) => this.sameTeam(s, viewer))) {
            mask |= 1 << Math.max(0, IDENTITIES.indexOf(viewer.identity as Identity));
          }
        }
      }
      target.seenMask = mask & 0xff;
      const rt = this.rt.get(target.id);
      target.blip = rt && rt.noiseLeft > 0 ? 1 : 0;
    });
  }

  private canSee(viewer: PlayerState, target: PlayerState): boolean {
    if (viewer.alive !== 1 || target.alive === 0) return false;
    const dx = target.x - viewer.x;
    const dy = target.y - viewer.y;
    const dist = Math.hypot(dx, dy);
    const vrt = this.rt.get(viewer.id);
    if (vrt && vrt.pulseLeft > 0 && dist < 680 * MAP_SCALE) return true;
    if (!this.personal()) {
      let pulsed = false;
      this.state.players.forEach((ally) => {
        if (pulsed || !this.sameTeam(ally, viewer)) return;
        const pr = this.rt.get(ally.id);
        if (pr && pr.pulseLeft > 0 && Math.hypot(target.x - ally.x, target.y - ally.y) < 680 * MAP_SCALE) pulsed = true;
      });
      if (pulsed) return true;
    }
    const def = CLASSES[viewer.classId as ClassId] ?? CLASSES.rifleman;
    let range = Math.max(2800, def.vision * 4) * MAP_SCALE;
    if (this.map && this.surf(viewer.x, viewer.y) === 7) range += 150 * MAP_SCALE;
    this.state.towers.forEach((tower) => {
      if (tower.owner < 0) return;
      const owns = this.personal() ? tower.owner === this.teamKey(viewer) : tower.owner === viewer.team;
      if (!owns) return;
      if (Math.hypot(viewer.x - tower.x, viewer.y - tower.y) < 520 * MAP_SCALE) range += 340 * MAP_SCALE;
    });
    if (dist > range) return false;
    if (this.smokeBlocks(viewer, target, dist)) return false;
    if (dist < 420 * MAP_SCALE) return true;
    for (const b of this.map.buildings) {
      if (segmentHitsRect(viewer.x, viewer.y, target.x, target.y, b)) return false;
    }
    return true;
  }

  /** Opaque across a smoke cloud unless the two players are right next to each other. */
  private smokeBlocks(viewer: PlayerState, target: PlayerState, dist: number): boolean {
    if (this.smokeTtl.size === 0) return false;
    if (dist <= SMOKE_NEAR) return false;
    let blocked = false;
    this.state.smokeClouds.forEach((cloud) => {
      if (blocked) return;
      if (segmentHitsCircle(viewer.x, viewer.y, target.x, target.y, cloud.x, cloud.y, cloud.r)) {
        blocked = true;
      }
    });
    return blocked;
  }

  private surf(x: number, y: number): number {
    return surfaceAt(this.map, x, y);
  }

  private thinkAi(dt: number): void {
    void dt;
    this.eachPlayer((bot) => {
      if (!bot.bot || bot.alive !== 1) return;
      const rt = this.rt.get(bot.id);
      if (!rt) return;
      const input = emptyInput(rt.input.seq + 1);

      // Mr. Cheese Curl — aimless sprint wander, never shoots
      if (isCheeseCurl(bot.id)) {
        const now = this.tickCount * TICK;
        if (now >= this.cheeseGoal.until || Math.hypot(this.cheeseGoal.x - bot.x, this.cheeseGoal.y - bot.y) < 50) {
          this.cheeseGoal = { ...this.pickCheeseGoal(), until: now + 2.2 + Math.random() * 2.8 };
        }
        const ang = Math.atan2(this.cheeseGoal.y - bot.y, this.cheeseGoal.x - bot.x);
        input.aim = ang;
        input.mx = Math.cos(ang);
        input.my = Math.sin(ang);
        input.sprint = true;
        input.fire = false;
        // Occasional zig-zag
        if (this.tickCount % 40 < 12) {
          input.mx = Math.cos(ang + 0.9);
          input.my = Math.sin(ang + 0.9);
        }
        rt.input = input;
        return;
      }

      const derlBoss = isDerl(bot.id);
      let target: PlayerState | null = null;
      let best = (derlBoss ? 720 : 520) ** 2;
      this.state.players.forEach((other) => {
        if (other.id === bot.id || other.alive !== 1 || this.sameTeam(bot, other)) return;
        const d = (other.x - bot.x) ** 2 + (other.y - bot.y) ** 2;
        if (d < best && this.canSee(bot, other)) { best = d; target = other; }
      });
      if (target) {
        const foe: PlayerState = target;
        input.aim = Math.atan2(foe.y - bot.y, foe.x - bot.x);
        const dist = Math.sqrt(best);
        const fireEvery = derlBoss
          ? (this.derlConfidence > 1.5 ? 4 : 2) // Colt: −20% attack speed ≈ slower cadence
          : (bot.classId === "heavy" ? 2 : 3);
        input.fire = dist < (derlBoss ? 520 : 460) && this.tickCount % fireEvery === 0;
        if (dist < (derlBoss ? 140 : 180)) {
          input.mx = Math.cos(input.aim + Math.PI / 2);
          input.my = Math.sin(input.aim + Math.PI / 2);
        } else if (dist > (derlBoss ? 220 : 280)) {
          input.mx = Math.cos(input.aim) * (derlBoss && this.derlConfidence > 1.5 ? 1.15 : 1);
          input.my = Math.sin(input.aim) * (derlBoss && this.derlConfidence > 1.5 ? 1.15 : 1);
        }
        if (bot.classId === "medic" && bot.hp < 60) input.ability = true;
      } else {
        const goal = this.aiGoal(bot);
        const ang = Math.atan2(goal.y - bot.y, goal.x - bot.x);
        input.aim = ang;
        input.mx = Math.cos(ang);
        input.my = Math.sin(ang);
        input.sprint = true;
        if (bot.seat < 0 && Math.hypot(goal.x - bot.x, goal.y - bot.y) > 900) {
          input.interact = this.tickCount % 30 === 0;
        }
      }
      if (bot.seat === 0) {
        const goal = this.aiGoal(bot);
        const bike = this.state.vehicles.get(bot.vehicleId);
        if (bike) {
          let diff = Math.atan2(goal.y - bike.y, goal.x - bike.x) - bike.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          input.steer = Math.max(-1, Math.min(1, diff * 2));
          input.throttle = 1;
          input.mx = 0;
          input.my = 0;
          if (Math.hypot(goal.x - bike.x, goal.y - bike.y) < 160) input.interact = true;
        }
      }
      rt.input = input;
    });
  }

  private aiGoal(bot: PlayerState): { x: number; y: number } {
    let best: { x: number; y: number } | null = null;
    let score = -1;
    this.state.objectives.forEach((o) => {
      if (!o.active) return;
      const owned = o.owner === (this.personal() ? this.teamKey(bot) : bot.team);
      const value = owned ? 1 : 5;
      const d = Math.hypot(o.x - bot.x, o.y - bot.y) + 1;
      const s = value * 1000 / d;
      if (s > score) { score = s; best = { x: o.x, y: o.y }; }
    });
    if (best) return best;
    const sp = this.map.spawns[this.tickCount % this.map.spawns.length];
    return { x: sp.x, y: sp.y };
  }

  private checkWin(): void {
    if (this.state.phase !== "play" || this.warmup > 0) return;
    const mode = MODE_MAP[this.settings.mode];
    if (mode.id === "lss" && this.state.timeLeft < this.settings.minutes * 60 - 5) {
      const living = new Set<number>();
      this.state.players.forEach((p) => {
        if (isDerl(p.id) || isCheeseCurl(p.id)) return;
        if (p.alive === 1 || p.alive === 2) living.add(this.personal() ? this.teamKey(p) : p.team);
      });
      if (living.size <= 1) {
        const team = living.size ? [...living][0] : -1;
        this.finishMatch(team, this.nameFor(team));
        return;
      }
    }
    const limit = this.settings.scoreLimit || mode.winScore;
    if (limit > 0 && mode.winScore > 0) {
      if (this.personal()) {
        const best = this.bestPlayer();
        if (best && best.score >= limit) {
          this.finishMatch(best.team, best.name);
          return;
        }
      } else {
        const scores = [this.state.score0, this.state.score1, this.state.score2];
        const top = Math.max(...scores);
        if (top >= limit) {
          const team = scores.indexOf(top);
          this.finishMatch(team, this.nameFor(team));
          return;
        }
      }
    }
    if (this.clock <= 0) {
      if (this.personal()) {
        const best = this.bestPlayer();
        this.finishMatch(best ? best.team : -1, best ? best.name : "Draw");
      } else {
        const scores = [this.state.score0, this.state.score1, this.state.score2];
        const top = Math.max(...scores);
        const leaders = scores.map((s, i) => s === top ? i : -1).filter((i) => i >= 0);
        if (leaders.length !== 1) this.finishMatch(-1, "Draw");
        else this.finishMatch(leaders[0], this.nameFor(leaders[0]));
      }
    }
  }

  private bestPlayer(): PlayerState | undefined {
    const all: PlayerState[] = [];
    this.state.players.forEach((p) => all.push(p));
    all.sort((a, b) => b.score - a.score);
    return all[0];
  }

  private nameFor(team: number): string {
    if (team < 0) return "Draw";
    if (this.personal()) {
      let name = "Soldier";
      this.state.players.forEach((p) => { if (p.team === team && !p.bot) name = p.name; });
      return name;
    }
    return ["West", "East", "North"][team] ?? "Team";
  }

  private finishMatch(team: number, name: string): void {
    this.state.phase = "end";
    this.state.winnerTeam = team;
    this.state.winnerName = name;
    this.endLeft = 12;
  }

  private syncAll(): void {
    this.eachPlayer((p) => {
      const rt = this.rt.get(p.id);
      if (!rt) return;
      p.ack = rt.input.seq;
      this.syncHud(p);
    });
  }

  private syncHud(p: PlayerState): void {
    const rt = this.rt.get(p.id);
    if (!rt) return;
    if (p.weaponSlot === 4) {
      p.mag = this.grenadesLeft(p, rt);
      p.reserve = 0;
    } else {
      const idx = Math.max(0, p.weaponSlot - 1);
      p.mag = rt.mags[idx] ?? 0;
      p.reserve = rt.reserves[idx] ?? 0;
    }
    p.grenades = this.grenadesLeft(p, rt);
    p.smokes = rt.smokes;
    p.reloading = rt.reloading ? 1 : 0;
    p.reloadPct = rt.reloading ? 1 - rt.reloadLeft / rt.reloadDur : 0;
    p.abilityCd = rt.abilityCd;
    p.abilityMax = CLASSES[p.classId as ClassId]?.abilityCd ?? 1;
  }
}
