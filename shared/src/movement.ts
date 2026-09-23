import { BIKE_RADIUS, VEHICLES } from "./vehicles";

/** Shared sim step. Client prediction must use the same value as the server. */
export const SIM_DT = 1 / 30;
import { FOOT_RADIUS } from "./vehicles";
import { moveCircle, clamp, type Rect } from "./math";

export interface MoveInput {
  seq: number;
  mx: number;
  my: number;
  aim: number;
  ax: number;
  ay: number;
  /** Look pitch in radians (positive = up). */
  pitch: number;
  /** Extra eye height from jump, world px. */
  jumpZ: number;
  /** Standing platform height (rooftop / ladder), world px. */
  floorZ: number;
  crouch: boolean;
  throttle: number;
  steer: number;
  fire: boolean;
  reload: boolean;
  ability: boolean;
  grenade: boolean;
  interact: boolean;
  sprint: boolean;
  boost: boolean;
  brake: boolean;
  ads: boolean;
  slot: number;
}

export function emptyInput(seq = 0): MoveInput {
  return {
    seq, mx: 0, my: 0, aim: 0, ax: NaN, ay: NaN, pitch: 0, jumpZ: 0, floorZ: 0, crouch: false,
    throttle: 0, steer: 0,
    fire: false, reload: false, ability: false, grenade: false, interact: false,
    sprint: false, boost: false, brake: false, ads: false, slot: 1,
  };
}

export function sanitizeInput(raw: Partial<MoveInput> | undefined, fallbackSeq = 0): MoveInput {
  const n = (v: unknown, a: number, b: number, d = 0) => {
    const x = typeof v === "number" && Number.isFinite(v) ? v : d;
    return clamp(x, a, b);
  };
  return {
    seq: Math.max(0, Math.floor(n(raw?.seq, 0, 1e9, fallbackSeq))),
    mx: n(raw?.mx, -1, 1),
    my: n(raw?.my, -1, 1),
    aim: n(raw?.aim, -20, 20),
    ax: typeof raw?.ax === "number" && Number.isFinite(raw.ax) ? raw.ax : Number.NaN,
    ay: typeof raw?.ay === "number" && Number.isFinite(raw.ay) ? raw.ay : Number.NaN,
    pitch: n(raw?.pitch, -1.2, 1.2),
    jumpZ: n(raw?.jumpZ, 0, 820),
    floorZ: n(raw?.floorZ, 0, 400),
    crouch: !!raw?.crouch,
    throttle: n(raw?.throttle, -1, 1),
    steer: n(raw?.steer, -1, 1),
    fire: !!raw?.fire,
    reload: !!raw?.reload,
    ability: !!raw?.ability,
    grenade: !!raw?.grenade,
    interact: !!raw?.interact,
    sprint: !!raw?.sprint,
    boost: !!raw?.boost,
    brake: !!raw?.brake,
    ads: !!raw?.ads,
    slot: Math.round(n(raw?.slot, 1, 5, 1)),
  };
}

export interface MoverEnv {
  dt: number;
  solids: Rect[];
  blocked: (x: number, y: number) => boolean;
  footMul: (x: number, y: number) => number;
  bikeMul: (x: number, y: number) => number;
}

export function stepInfantry(
  body: { x: number; y: number; aim: number },
  input: MoveInput,
  speed: number,
  env: MoverEnv,
): void {
  let mx = input.mx;
  let my = input.my;
  const mag = Math.hypot(mx, my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }
  const mul = env.footMul(body.x, body.y);
  const dist = speed * mul * env.dt;
  const next = moveCircle(body.x, body.y, FOOT_RADIUS, mx * dist, my * dist, env.solids, env.blocked);
  body.x = next.x;
  body.y = next.y;
  body.aim = input.aim;
}

export interface BikeBody {
  x: number;
  y: number;
  heading: number;
  speed: number;
  battery: number;
  hp: number;
  boostLeft: number;
  boostCd: number;
  braking: boolean;
  boosting: boolean;
}

export function stepBike(bike: BikeBody, input: MoveInput, seats: number, env: MoverEnv, kind: "ebike" | "car" = "ebike"): void {
  void seats;
  const stats = kind === "car" ? VEHICLES.car : VEHICLES.ebike;
  const radius = kind === "car" ? 28 : BIKE_RADIUS;
  const surf = env.bikeMul(bike.x, bike.y);
  const wantBoost = input.boost && bike.boostCd <= 0;
  if (wantBoost) bike.boostLeft = 1.35;
  if (bike.boostLeft > 0) {
    bike.boostLeft -= env.dt;
    bike.boosting = true;
    if (bike.boostLeft <= 0) bike.boostCd = 4.5;
  } else {
    bike.boosting = false;
    bike.boostCd = Math.max(0, bike.boostCd - env.dt);
  }
  const boost = bike.boosting ? 1.32 : 1;
  const juice = 1;
  bike.battery = stats.battery;
  let throttle = input.brake ? 0 : input.throttle;
  if (input.brake) {
    bike.speed *= Math.max(0, 1 - 7.5 * env.dt);
    bike.braking = Math.abs(bike.speed) > 20;
  } else {
    bike.braking = false;
    bike.speed += throttle * stats.accel * surf * juice * boost * env.dt;
  }
  const drag = stats.drag * (surf < 0.8 ? 1.8 : 1);
  bike.speed *= Math.max(0, 1 - drag * env.dt);
  const max = stats.maxSpeed * surf * juice * boost;
  bike.speed = clamp(bike.speed, -stats.reverse * surf, max);
  const steerScale = clamp(Math.abs(bike.speed) / 90, 0.2, 1);
  bike.heading += input.steer * stats.turn * steerScale * env.dt * Math.sign(bike.speed || 1);
  const dx = Math.cos(bike.heading) * bike.speed * env.dt;
  const dy = Math.sin(bike.heading) * bike.speed * env.dt;
  const next = moveCircle(bike.x, bike.y, radius, dx, dy, env.solids, env.blocked);
  if (next.x === bike.x && next.y === bike.y && (dx !== 0 || dy !== 0)) bike.speed *= 0.4;
  bike.x = next.x;
  bike.y = next.y;
  void throttle;
}

export interface HeliBody {
  x: number;
  y: number;
  z: number;
  vz: number;
  heading: number;
  speed: number;
}

/** Arcade helicopter. Space climbs, Ctrl descends, and it holds altitude when you let go. */
export function stepHeli(body: HeliBody, input: MoveInput, env: MoverEnv): void {
  const stats = VEHICLES.heli;
  const climb = (input.brake ? 1 : 0) + (input.crouch ? -1 : 0);
  body.vz += climb * 520 * env.dt;
  body.vz *= Math.max(0, 1 - 2.4 * env.dt);
  body.vz = clamp(body.vz, -280, 260);
  const maxZ = 16 * 48;
  body.z = clamp(body.z + body.vz * env.dt, 0, maxZ);
  if (body.z <= 0) {
    body.z = 0;
    body.vz = Math.max(0, body.vz);
  } else if (body.z >= maxZ) {
    body.z = maxZ;
    body.vz = Math.min(0, body.vz);
  }
  body.speed += input.throttle * stats.accel * env.dt;
  body.speed *= Math.max(0, 1 - stats.drag * env.dt);
  body.speed = clamp(body.speed, -stats.reverse, stats.maxSpeed);
  body.heading += input.steer * stats.turn * env.dt;
  const dx = Math.cos(body.heading) * body.speed * env.dt;
  const dy = Math.sin(body.heading) * body.speed * env.dt;
  const low = body.z < 8 * 48;
  const next = moveCircle(body.x, body.y, 26, dx, dy, low ? env.solids : [], env.blocked);
  if (next.x === body.x && next.y === body.y && (dx !== 0 || dy !== 0)) body.speed *= 0.45;
  body.x = next.x;
  body.y = next.y;
}

export function seatPoint(x: number, y: number, heading: number, seat: number): { x: number; y: number } {
  const back = seat === 0 ? 2 : -26;
  return { x: x + Math.cos(heading) * back, y: y + Math.sin(heading) * back };
}
