import type { Rect } from "./math";
import { HERSH_SCALE, buildHershLayout } from "./hershLayout";

export { HERSH_SCALE };

export const SURF = {
  grass: 0,
  dirt: 1,
  road: 2,
  concrete: 3,
  water: 4,
  forest: 5,
  trench: 6,
  hill: 7,
  bridge: 8,
} as const;

const FOOT_MUL = [1, 0.96, 1.06, 1.02, 0, 0.9, 0.76, 0.9, 1.05];
const BIKE_MUL = [0.66, 0.7, 1, 0.94, 0, 0.5, 0.38, 0.56, 1];

/** Layout authored for 200 yd at 48 px/yd. Twice the previous quarter-size arena. */
export const MAP_SCALE = 0.65 / 2;
export const CELL = 48;
export const WORLD_W = Math.round((9600 * MAP_SCALE) / CELL) * CELL;
export const WORLD_H = WORLD_W;
export const COLS = WORLD_W / CELL;
export const ROWS = WORLD_H / CELL;

export interface Spawn {
  x: number;
  y: number;
  team: number;
  ffa: boolean;
}

export interface MapBike {
  id: string;
  x: number;
  y: number;
  seats: 1 | 2;
  base: boolean;
  kind?: "ebike" | "heli" | "car";
}

export interface MapObjective {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  group: "front" | "center" | "base";
}

export interface Decor {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  variant: number;
}

/** Climb volume — stand inside and press W/S to go up/down. */
export interface MapLadder {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Roof height in world px. */
  topZ: number;
}

/** Walkable rooftop. `z` is the low edge; `z1` makes a slope. */
export interface MapRoof {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  z1?: number;
  along?: "x" | "y";
}

/** Stair / attic deck. Same shape as a roof, used to step floor height. */
export interface MapFloor {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height at the min edge. Flat decks use only this. */
  z: number;
  /** Height at the max edge of `along`. Present on ramps. */
  z1?: number;
  /** World axis the ramp climbs along. */
  along?: "x" | "y";
}

/** Interactable house door — collision when closed (server-synced). */
export interface MapDoor {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** "hersh" | "guest" — which house facade. */
  house: "hersh" | "guest";
}

/** Standard house roof height (~wall top). */
export const ROOF_Z = 148;

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  surface: Uint8Array;
  solids: Rect[];
  buildings: Decor[];
  decor: Decor[];
  ladders: MapLadder[];
  roofs: MapRoof[];
  floors: MapFloor[];
  doors: MapDoor[];
  /** Cartoon Hersh house anchor (world px). Front faces +X. */
  hersh: { cx: number; cy: number };
  objectives: MapObjective[];
  towers: { id: string; x: number; y: number; r: number }[];
  spawns: Spawn[];
  bikes: MapBike[];
  chargers: { x: number; y: number }[];
  lights: { x: number; y: number }[];
}

function paint(surface: Uint8Array, x: number, y: number, w: number, h: number, v: number) {
  const x0 = Math.max(0, Math.floor(x / CELL));
  const y0 = Math.max(0, Math.floor(y / CELL));
  const x1 = Math.min(COLS, Math.ceil((x + w) / CELL));
  const y1 = Math.min(ROWS, Math.ceil((y + h) / CELL));
  for (let r = y0; r < y1; r++) {
    for (let c = x0; c < x1; c++) surface[r * COLS + c] = v;
  }
}

let cached: GameMap | null = null;

export function getMap(): GameMap {
  if (!cached) cached = buildMap();
  return cached;
}

export function surfaceAt(map: GameMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return SURF.water;
  const c = Math.floor(x / map.cell);
  const r = Math.floor(y / map.cell);
  return map.surface[r * map.cols + c];
}

export function footMul(map: GameMap, x: number, y: number): number {
  return FOOT_MUL[surfaceAt(map, x, y)] ?? 0;
}

export function bikeMul(map: GameMap, x: number, y: number): number {
  return BIKE_MUL[surfaceAt(map, x, y)] ?? 0;
}

export function blockedAt(map: GameMap, x: number, y: number): boolean {
  const s = surfaceAt(map, x, y);
  return s === SURF.water || x < 24 || y < 24 || x > map.width - 24 || y > map.height - 24;
}

export function pointInRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  return x >= r.x - pad && y >= r.y - pad && x <= r.x + r.w + pad && y <= r.y + r.h + pad;
}

export function ladderAt(map: GameMap, x: number, y: number, pad = 18): MapLadder | null {
  for (const lad of map.ladders) {
    if (pointInRect(x, y, lad, pad)) return lad;
  }
  return null;
}

export function roofAt(map: GameMap, x: number, y: number, pad = 4): MapRoof | null {
  for (const roof of map.roofs) {
    if (pointInRect(x, y, roof, pad)) return roof;
  }
  return null;
}

/** Feet height on a flat or sloped roof, in world px. */
export function roofHeight(roof: MapRoof, x: number, y: number): number {
  if (roof.z1 == null) return roof.z;
  const alongY = roof.along === "y";
  const span = alongY ? roof.h : roof.w;
  if (span <= 1) return roof.z;
  const t = alongY ? (y - roof.y) / span : (x - roof.x) / span;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return roof.z + (roof.z1 - roof.z) * u;
}

/** Only the last step off a ladder ignores walls. Standing on the roof keeps them, so you are not pulled inside. */
export function onRoofWalk(map: GameMap, x: number, y: number, floorZ: number): boolean {
  const lad = ladderAt(map, x, y, 18);
  return !!lad && floorZ >= lad.topZ - 36;
}

/** Below the lowest eave. A trampoline jump stays above this until it lands. */
const AIR_CLEAR = 100;
/** Wall thickness plus body radius. The lip sits just outside the roof rect. */
const ROOF_LIP = 64;

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function expandRect(r: { x: number; y: number; w: number; h: number }, pad: number) {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/**
 * Solids used for walking. High jumps ignore walls so a trampoline can carry you
 * over the lip. Once your feet are on that roof, the lip walls stop blocking.
 */
export function walkSolids<T extends { x: number; y: number; w: number; h: number }>(
  map: GameMap,
  x: number,
  y: number,
  floorZ: number,
  jumpZ: number,
  solids: T[],
): T[] {
  if (onRoofWalk(map, x, y, floorZ) || floorZ + jumpZ > AIR_CLEAR) return [];
  const roof = roofAt(map, x, y, ROOF_LIP);
  if (!roof || floorZ < 80) return solids;
  const hz = roofHeight(roof, x, y);
  if (Math.abs(floorZ - hz) > 56) return solids;
  const slabs = map.roofs.filter((r) => rectsOverlap(expandRect(r, 24), roof));
  return solids.filter((s) => !slabs.some((r) => rectsOverlap(s, expandRect(r, ROOF_LIP))));
}

function deckHeight(floor: MapFloor, x: number, y: number): number {
  if (floor.z1 == null) return floor.z;
  const alongY = floor.along === "y";
  const span = alongY ? floor.h : floor.w;
  if (span <= 1) return floor.z;
  const t = alongY ? (y - floor.y) / span : (x - floor.x) / span;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return floor.z + (floor.z1 - floor.z) * u;
}

/** Highest deck you can stand on from currentZ (step-up within `step` px). */
export function floorUnder(map: GameMap, x: number, y: number, currentZ: number, step = 56): MapFloor | null {
  let best: MapFloor | null = null;
  let bestZ = -1;
  for (const floor of map.floors) {
    if (!pointInRect(x, y, floor, 4)) continue;
    const hz = deckHeight(floor, x, y);
    if (hz > currentZ + step) continue;
    if (hz >= bestZ) {
      best = floor;
      bestZ = hz;
    }
  }
  return best ? { ...best, z: bestZ } : null;
}

export function doorAt(map: GameMap, x: number, y: number, pad = 36): MapDoor | null {
  let best: MapDoor | null = null;
  let bestD = pad * pad;
  for (const door of map.doors) {
    const cx = door.x + door.w / 2;
    const cy = door.y + door.h / 2;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestD) {
      best = door;
      bestD = d;
    }
  }
  return best;
}

function pushWall(
  solids: Rect[],
  buildings: Decor[],
  rect: Rect,
  kind: string,
  variant = 0,
): void {
  solids.push(rect);
  buildings.push({
    kind, x: rect.x, y: rect.y, w: rect.w, h: rect.h, rot: 0, variant,
  });
}

/** Nuketown-style cul-de-sac: two houses across a street — Big Hersh House. */
function buildMap(): GameMap {
  const Y = 48;
  const px = (yards: number) => Math.round(yards * MAP_SCALE * Y);
  const surface = new Uint8Array(COLS * ROWS);
  surface.fill(SURF.road);

  const solids: Rect[] = [];
  const buildings: Decor[] = [];
  const decor: Decor[] = [];

  const t = px(1.2); // wall thickness

  // Perimeter fence sits on the map edge.
  pushWall(solids, buildings, { x: 0, y: 0, w: WORLD_W, h: t }, "fence", 1);
  pushWall(solids, buildings, { x: 0, y: WORLD_H - t, w: WORLD_W, h: t }, "fence", 1);
  pushWall(solids, buildings, { x: 0, y: 0, w: t, h: WORLD_H }, "fence", 1);
  pushWall(solids, buildings, { x: WORLD_W - t, y: 0, w: t, h: WORLD_H }, "fence", 1);

  // Corn maze just inside the fence. The path connects all the way around.
  const cornT = Math.max(18, px(1.35));
  const edge = px(3.2);
  const band = px(7.2);
  const inner = edge + cornT + band;
  const gate = px(6);
  const addCorn = (x: number, y: number, w: number, h: number) => {
    if (w < 10 || h < 10) return;
    pushWall(solids, buildings, { x, y, w, h }, "corn", 0);
  };
  const split = (x: number, y: number, w: number, h: number, alongX: boolean) => {
    const len = alongX ? w : h;
    const lead = Math.max(10, (len - gate) / 2);
    if (alongX) {
      addCorn(x, y, lead, h);
      addCorn(x + lead + gate, y, Math.max(10, len - lead - gate), h);
    } else {
      addCorn(x, y, w, lead);
      addCorn(x, y + lead + gate, w, Math.max(10, len - lead - gate));
    }
  };
  addCorn(edge, edge, WORLD_W - edge * 2, cornT);
  addCorn(edge, WORLD_H - edge - cornT, WORLD_W - edge * 2, cornT);
  addCorn(edge, edge, cornT, WORLD_H - edge * 2);
  addCorn(WORLD_W - edge - cornT, edge, cornT, WORLD_H - edge * 2);
  const innerSpan = WORLD_W - inner * 2;
  split(inner, inner, innerSpan, cornT, true);
  split(inner, WORLD_H - inner - cornT, innerSpan, cornT, true);
  split(inner, inner, cornT, innerSpan, false);
  split(WORLD_W - inner - cornT, inner, cornT, innerSpan, false);
  const weave = (alongY: boolean, start: number, end: number, a: number, b: number) => {
    const reach = (b - a) * 0.55;
    const step = px(14);
    let n = 0;
    for (let p = start + px(5); p < end - px(5); p += step, n++) {
      if (alongY) addCorn(n % 2 === 0 ? a : b - reach, p, reach, cornT * 0.65);
      else addCorn(p, n % 2 === 0 ? a : b - reach, cornT * 0.65, reach);
    }
  };
  weave(true, inner + gate, WORLD_H - inner - gate, edge + cornT, inner);
  weave(true, inner + gate, WORLD_H - inner - gate, WORLD_W - inner, WORLD_W - edge - cornT);
  weave(false, inner + gate, WORLD_W - inner - gate, edge + cornT, inner);
  weave(false, inner + gate, WORLD_W - inner - gate, WORLD_H - inner, WORLD_H - edge - cornT);

  // ——— Big Hersh House: simple collision shell (cartoon mesh is client-side) ———
  const hersh = buildHershLayout(px(47), px(90));
  for (const s of hersh.solids) solids.push(s);
  const floors: MapFloor[] = hersh.floors.slice();

  // ——— East house: Guest house (mirrored) ———
  const eh = { x: px(132), y: px(54), w: px(48), h: px(68) };
  pushWall(solids, buildings, { x: eh.x, y: eh.y, w: eh.w, h: t }, "house", 0);
  pushWall(solids, buildings, { x: eh.x, y: eh.y + eh.h - t, w: eh.w, h: t }, "house", 0);
  // East back with gap
  pushWall(solids, buildings, { x: eh.x + eh.w - t, y: eh.y, w: t, h: px(22) }, "house", 0);
  pushWall(solids, buildings, { x: eh.x + eh.w - t, y: eh.y + px(38), w: t, h: px(30) }, "house", 0);
  // West (street-facing) — door gap
  const guestDoorY = eh.y + px(28);
  const guestDoorH = px(12);
  pushWall(solids, buildings, { x: eh.x, y: eh.y, w: t, h: guestDoorY - eh.y }, "house", 0);
  pushWall(solids, buildings, {
    x: eh.x,
    y: guestDoorY + guestDoorH,
    w: t,
    h: eh.y + eh.h - (guestDoorY + guestDoorH),
  }, "house", 0);
  pushWall(solids, buildings, { x: eh.x + px(22), y: eh.y + t, w: t, h: px(22) }, "house", 0);
  pushWall(solids, buildings, { x: eh.x + px(22), y: eh.y + px(40), w: t, h: px(26) }, "house", 0);
  // Guest garage
  pushWall(solids, buildings, { x: eh.x, y: eh.y + eh.h, w: px(20), h: t }, "garage", 0);
  pushWall(solids, buildings, { x: eh.x, y: eh.y + eh.h, w: t, h: px(14) }, "garage", 0);
  pushWall(solids, buildings, { x: eh.x + px(20) - t, y: eh.y + eh.h, w: t, h: px(14) }, "garage", 0);
  pushWall(solids, buildings, { x: eh.x, y: eh.y + eh.h + px(14) - t, w: px(20), h: t }, "garage", 0);

  const doors: MapDoor[] = [
    {
      id: "hersh-front",
      x: hersh.door.x,
      y: hersh.door.y,
      w: hersh.door.w,
      h: hersh.door.h,
      house: "hersh",
    },
    {
      id: "guest-front",
      x: eh.x,
      y: guestDoorY,
      w: t,
      h: guestDoorH,
      house: "guest",
    },
  ];
  for (const door of doors) {
    decor.push({
      kind: "door",
      x: door.x + door.w / 2,
      y: door.y + door.h / 2,
      w: door.w,
      h: door.h,
      rot: 0,
      variant: door.house === "hersh" ? 0 : 1,
    });
  }

  // Mid-street school bus cover
  pushWall(solids, buildings, { x: px(90), y: px(92), w: px(20), h: px(10) }, "bus", 2);

  // Back-yard fence, set in from the corn maze so the loop stays open
  pushWall(solids, buildings, { x: px(30), y: px(72), w: px(6), h: t }, "fence", 1);
  pushWall(solids, buildings, { x: px(30), y: px(108), w: px(6), h: t }, "fence", 1);
  pushWall(solids, buildings, { x: px(30), y: px(72), w: t, h: px(36) }, "fence", 1);
  // Front-yard low hedges / fence stubs (street edge)
  pushWall(solids, buildings, { x: px(70), y: px(52), w: px(4), h: t }, "fence", 1);
  pushWall(solids, buildings, { x: px(70), y: px(118), w: px(4), h: t }, "fence", 1);
  // Mid-street cover
  const junk: Array<[number, number, number, number, string]> = [
    [96, 48, 8, 3, "house"],
    [96, 140, 8, 3, "house"],
    [150, 140, 10, 3, "fence"],
  ];
  for (const [gx, gy, gw, gh, kind] of junk) {
    pushWall(solids, buildings, { x: px(gx), y: px(gy), w: px(gw), h: px(gh) }, kind, kind === "fence" ? 1 : 0);
  }

  // Welcome sign — front yard, in front of the cartoon house (street side)
  // Front-right corner, outside the walls. The facade has almost no depth of yard.
  const signX = hersh.cx + 6.4 * 48 * HERSH_SCALE;
  const signY = hersh.cy - 8.6 * 48 * HERSH_SCALE;
  const signW = 2.4 * 48 * HERSH_SCALE;
  decor.push({ kind: "sign", x: signX, y: signY, w: signW, h: px(0.4), rot: 0, variant: 0 });
  pushWall(solids, buildings, { x: signX - px(0.3), y: signY - signW * 0.38, w: px(0.5), h: px(0.5) }, "fence", 1);
  pushWall(solids, buildings, { x: signX - px(0.3), y: signY + signW * 0.38, w: px(0.5), h: px(0.5) }, "fence", 1);

  const callW = 6.2 * 48;
  const callX = signX + 6 * 48;
  const callY = signY - 7 * 48;
  decor.push({ kind: "callboard", x: callX, y: callY, w: callW, h: px(0.4), rot: 0, variant: 0 });
  pushWall(solids, buildings, { x: callX - px(0.3), y: callY - callW * 0.38, w: px(0.5), h: px(0.5) }, "fence", 1);
  pushWall(solids, buildings, { x: callX - px(0.3), y: callY + callW * 0.38, w: px(0.5), h: px(0.5) }, "fence", 1);

  // Sunset yard props — tree + lamp near front of Hersh
  decor.push({ kind: "tree", x: hersh.cx + 1.5 * 48, y: hersh.cy - 8.2 * 48, w: px(4), h: px(4), rot: 0, variant: 0 });
  solids.push({ x: hersh.cx + 1.2 * 48, y: hersh.cy - 8.6 * 48, w: px(2), h: px(2) });
  decor.push({ kind: "lamp", x: hersh.cx + 5.3 * 48, y: hersh.cy + 1.6 * 48, w: px(1), h: px(1), rot: 0, variant: 0 });
  // Foundation bushes, outside the front wall
  for (const [bx, by] of [
    [hersh.cx + 4.6 * 48, hersh.cy - 4.2 * 48],
    [hersh.cx + 4.6 * 48, hersh.cy + 3.4 * 48],
    [hersh.cx + 5.0 * 48, hersh.cy - 1.2 * 48],
  ] as const) {
    decor.push({ kind: "bush", x: bx, y: by, w: px(2.5), h: px(2.5), rot: 0, variant: 0 });
  }

  // Climbable ladders → rooftops (street-facing walls + attic)
  const ladderD = px(3.5);
  const eaveZ = Math.round(3.2 * 48 * HERSH_SCALE);
  const ridgeZ = Math.round(6.1 * 48 * HERSH_SCALE);
  const halfD = 4 * 48 * HERSH_SCALE;
  const halfW = 5.75 * 48 * HERSH_SCALE;
  const ladders: MapLadder[] = [
    // Guest house — ladder overlaps the roof so you can step off at the top
    { x: eh.x - px(1.1), y: eh.y + px(8), w: px(2.8), h: ladderD, topZ: ROOF_Z },
    { x: eh.x - px(1.1), y: eh.y + eh.h - px(14), w: px(2.8), h: ladderD, topZ: ROOF_Z },
    // Hersh eaves — one on each low edge of the slope
    { x: hersh.cx - px(1.4), y: hersh.cy - halfW - px(1.6), w: px(2.8), h: px(3.4), topZ: eaveZ },
    { x: hersh.cx - px(1.4), y: hersh.cy + halfW - px(1.8), w: px(2.8), h: px(3.4), topZ: eaveZ },
  ];
  const roofs: MapRoof[] = [
    { x: eh.x, y: eh.y, w: eh.w, h: eh.h, z: ROOF_Z },
    // Hersh slopes: local +X is world -Y, ridge at the center
    {
      x: hersh.cx - halfD, y: hersh.cy - halfW, w: halfD * 2, h: halfW,
      z: eaveZ, z1: ridgeZ, along: "y",
    },
    {
      x: hersh.cx - halfD, y: hersh.cy, w: halfD * 2, h: halfW,
      z: ridgeZ, z1: eaveZ, along: "y",
    },
  ];
  for (const lad of ladders) {
    decor.push({ kind: "ladder", x: lad.x, y: lad.y, w: lad.w, h: lad.h, rot: 0, variant: lad.topZ });
  }

  // Derko's Ford Fusion is a drivable car on the street. See bikes[].

  // Cars / crates in driveways and street
  const props: Array<[number, number, string]> = [
    [138, 94, "car"], [144, 100, "car"],
    [96, 78, "crate"], [104, 118, "crate"],
    [152, 80, "crate"],
    [12, 100, "crate"], [160, 130, "crate"],
    [88, 56, "barrier"], [112, 56, "barrier"],
  ];
  for (const [gx, gy, kind] of props) {
    const size = kind === "car" ? px(4.5) : kind === "barrier" ? px(3) : px(2);
    const depth = kind === "car" ? px(2.2) : kind === "barrier" ? px(1) : px(2);
    decor.push({
      kind,
      x: px(gx) + size / 2,
      y: px(gy) + depth / 2,
      w: size,
      h: depth,
      rot: 0,
      variant: 0,
    });
    solids.push({ x: px(gx), y: px(gy), w: size, h: depth });
  }

  const spawns: Spawn[] = [
    // Hersh house side
    [28, 70], [28, 100], [36, 148],
    // Guest house side
    [172, 70], [172, 100], [164, 148],
    // Street ends
    [100, 24], [100, 176],
    // Flanks
    [60, 40], [140, 40],
  ].map(([gx, gy], i) => ({ x: px(gx), y: px(gy), team: i % 3, ffa: true }));

  const bikes: MapBike[] = [
    { id: "bike-1", x: px(88), y: px(72), seats: 2, base: true },
    { id: "bike-2", x: px(140), y: px(108), seats: 2, base: true },
    { id: "heli-1", x: px(100), y: px(130), seats: 2, base: true, kind: "heli" },
    { id: "car-1", x: px(86.6), y: px(101.2), seats: 2, base: true, kind: "car" },
  ];

  const trampolines = [
    { x: px(100), y: px(42) },
    { x: px(72), y: px(88) },
    { x: px(150), y: px(40) },
  ];
  trampolines.forEach((pad, i) => {
    decor.push({ kind: "trampoline", x: pad.x, y: pad.y, w: px(7), h: px(7), rot: 0, variant: i });
  });

  const objectives: MapObjective[] = [
    { id: "A", name: "HERSH HOUSE", x: px(44), y: px(88), r: px(5), group: "front" },
    { id: "B", name: "GUEST HOUSE", x: px(156), y: px(88), r: px(5), group: "front" },
    { id: "C", name: "MID BUS", x: px(100), y: px(97), r: px(4.5), group: "center" },
    { id: "D", name: "DERKO'S ATTIC", x: px(32), y: px(64), r: px(4.2), group: "base" },
    { id: "E", name: "STREET", x: px(100), y: px(70), r: px(4.5), group: "center" },
    { id: "F", name: "FRONT YARD", x: px(74), y: px(72), r: px(4.5), group: "front" },
    { id: "N", name: "WELCOME SIGN", x: signX + px(5), y: signY, r: px(3.5), group: "base" },
    { id: "S", name: "BACK YARD", x: px(12), y: px(88), r: px(5), group: "front" },
  ];

  const towers: { id: string; x: number; y: number; r: number }[] = [];

  const map: GameMap = {
    id: "hersh-house",
    name: "Big Hersh House",
    width: WORLD_W,
    height: WORLD_H,
    cell: CELL,
    cols: COLS,
    rows: ROWS,
    surface,
    solids,
    buildings,
    decor,
    ladders,
    roofs,
    floors,
    doors,
    hersh: { cx: hersh.cx, cy: hersh.cy },
    objectives,
    towers,
    spawns,
    bikes,
    chargers: [],
    lights: [],
  };
  for (const s of spawns) {
    if (blockedAt(map, s.x, s.y)) throw new Error(`spawn blocked ${s.x},${s.y}`);
  }
  for (const b of bikes) {
    if (blockedAt(map, b.x, b.y)) throw new Error(`bike blocked ${b.id}`);
  }
  return map;
}
