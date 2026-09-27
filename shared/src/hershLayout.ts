import type { Rect } from "./math";

/** Game world pixels per meter (matches the Three.js view). */
export const PX_PER_M = 48;

export interface HershFloor extends Rect {
  /** Walk surface height in world px. Ramp: height at the min edge. */
  z: number;
  /** Ramp height at the max edge of `along`. */
  z1?: number;
  along?: "x" | "y";
}

export interface HershLayout {
  cx: number;
  cy: number;
  /** Simple 2D wall boxes. Visual mesh is separate and more detailed. */
  solids: Rect[];
  floors: HershFloor[];
  door: Rect;
}

/** Local meters → world rect. House group uses rotation.y = +π/2 so front (+Z) faces street (+X). */
function footprint(cx: number, cy: number, lx: number, lz: number, lw: number, ld: number, scale: number): Rect {
  const wx = cx + lz * PX_PER_M * scale;
  const wy = cy - lx * PX_PER_M * scale;
  const w = Math.max(8, Math.abs(ld) * PX_PER_M * scale);
  const h = Math.max(8, Math.abs(lw) * PX_PER_M * scale);
  return { x: wx - w / 2, y: wy - h / 2, w, h };
}

/** Full-size shell so the door and ceiling clear a standing player. */
export const HERSH_SCALE = 1;

/**
 * Big Hersh House, meters. Front is +Z. Wider than the old shell so the
 * ground floor fits a living room, kitchen, and two bedrooms.
 */
export const HERSH = {
  w: 16,
  d: 8.4,
  floorH: 3.4,
  ridge: 7.05,
  wall: 0.24,
  doorX: -2.4,
  doorW: 1.7,
  winX: 2.7,
  winW: 3.3,
  stairX: -6.2,
  stairW: 1.55,
  stairCount: 16,
  stairDepth: 0.22,
  /** Center Z of the lowest (front) step. */
  stairFrontZ: 2.1,
} as const;

export interface HershSeg {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Wall boxes in local meters. Shared by collision and the house mesh. */
export function hershPartitions(): HershSeg[] {
  const H = HERSH;
  const halfW = H.w / 2;
  const halfD = H.d / 2;
  const t = H.wall;
  const segs: HershSeg[] = [];
  const wall = (w: number, d: number, x: number, z: number) => {
    if (w > 0.05 && d > 0.05) segs.push({ x, z, w, d });
  };

  const doorL = H.doorX - H.doorW / 2;
  const doorR = H.doorX + H.doorW / 2;
  const winL = H.winX - H.winW / 2;
  const winR = H.winX + H.winW / 2;
  const frontZ = halfD;

  wall(doorL + halfW, t, (-halfW + doorL) / 2, frontZ);
  wall(winL - doorR, t, (doorR + winL) / 2, frontZ);
  wall(H.winW, t, H.winX, frontZ);
  wall(halfW - winR, t, (winR + halfW) / 2, frontZ);
  wall(H.w, t, 0, -halfD);
  wall(t, H.d, -halfW, 0);
  wall(t, H.d, halfW, 0);

  // Covered porch posts, clear of the front door.
  wall(0.22, 0.22, 1.15, halfD + 1.35);
  wall(0.22, 0.22, 6.35, halfD + 1.35);

  // Bedrooms sit behind this wall. The stairwell on the left stays open.
  const crossZ = 0.05;
  const bedDoor = 1.4;
  const bed1 = -3.3;
  const bed2 = 2.2;
  const crossL = -5.15;
  const crossR = halfW - 0.4;
  wall(bed1 - bedDoor / 2 - crossL, t, (crossL + bed1 - bedDoor / 2) / 2, crossZ);
  wall((bed2 - bedDoor / 2) - (bed1 + bedDoor / 2), t, (bed1 + bed2) / 2, crossZ);
  wall(crossR - (bed2 + bedDoor / 2), t, (bed2 + bedDoor / 2 + crossR) / 2, crossZ);

  // Wall between the two bedrooms.
  wall(t, 3.55, 0.15, -2.05);

  // Kitchen / living divider, with a wide opening.
  const kitX = 1.35;
  const kitDoorZ0 = 1.45;
  const kitDoorZ1 = 2.95;
  wall(t, kitDoorZ0 - 0.4, kitX, (0.4 + kitDoorZ0) / 2);
  wall(t, halfD - 0.55 - kitDoorZ1, kitX, (kitDoorZ1 + halfD - 0.55) / 2);

  return segs;
}

/** Attic walk decks in local meters, with a hole over the stairs. */
export function hershAtticDecks(): HershSeg[] {
  const H = HERSH;
  const halfW = H.w / 2;
  const halfD = H.d / 2;
  const inset = 0.45;
  const x0 = -halfW + inset;
  const x1 = halfW - inset;
  const z0 = -halfD + inset;
  const z1 = halfD - inset;
  const holeR = -4.95;
  const landZ = H.stairFrontZ - (H.stairCount - 1) * H.stairDepth - 0.35;
  const decks: HershSeg[] = [];
  const deck = (x0n: number, z0n: number, x1n: number, z1n: number) => {
    decks.push({
      x: (x0n + x1n) / 2,
      z: (z0n + z1n) / 2,
      w: x1n - x0n,
      d: z1n - z0n,
    });
  };
  deck(holeR, z0, x1, z1);
  deck(x0, z0, holeR, landZ);
  return decks;
}

/** Collision shell + stair/attic floors. */
export function buildHershLayout(cx: number, cy: number, scale = HERSH_SCALE): HershLayout {
  const H = HERSH;
  const solids = hershPartitions().map((s) => footprint(cx, cy, s.x, s.z, s.w, s.d, scale));
  const door = footprint(cx, cy, H.doorX, H.d / 2 + 0.15, H.doorW, 0.4, scale);

  const attic = H.floorH + 0.08;
  const floors: HershFloor[] = hershAtticDecks().map((s) => {
    const r = footprint(cx, cy, s.x, s.z, s.w, s.d, scale);
    return { ...r, z: Math.round(attic * PX_PER_M * scale) };
  });

  // Low local Z is the attic end (min world X). High local Z is the ground.
  const bottomZ = H.stairFrontZ + H.stairDepth / 2;
  const topZ = H.stairFrontZ - (H.stairCount - 1) * H.stairDepth - H.stairDepth / 2;
  const ramp = footprint(cx, cy, H.stairX, (bottomZ + topZ) / 2, H.stairW, bottomZ - topZ, scale);
  floors.push({
    ...ramp,
    z: Math.round(attic * PX_PER_M * scale),
    z1: 0,
    along: "x",
  });

  return { cx, cy, solids, floors, door };
}
