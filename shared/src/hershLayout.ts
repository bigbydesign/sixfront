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

/**
 * Local meters → world rect.
 * House group uses rotation.y = +π/2 so front (+Z) faces street (+X).
 */
function footprint(cx: number, cy: number, lx: number, lz: number, lw: number, ld: number, scale: number): Rect {
  const wx = cx + lz * PX_PER_M * scale;
  const wy = cy - lx * PX_PER_M * scale;
  const w = Math.max(8, Math.abs(ld) * PX_PER_M * scale);
  const h = Math.max(8, Math.abs(lw) * PX_PER_M * scale);
  return { x: wx - w / 2, y: wy - h / 2, w, h };
}

/** Full-size shell so the door and ceiling clear a standing player. */
export const HERSH_SCALE = 1;

/** Collision shell + stair/attic floors. */
export function buildHershLayout(cx: number, cy: number, scale = HERSH_SCALE): HershLayout {
  const HOUSE_W = 11.5;
  const HOUSE_D = 8.0;
  const FLOOR_H = 3.2;
  const WALL_T = 0.28;
  const HALF_D = HOUSE_D / 2;
  const frontZ = HALF_D;
  const solids: Rect[] = [];

  const wall = (w: number, d: number, x: number, z: number) => {
    solids.push(footprint(cx, cy, x, z, w, d, scale));
  };

  // Front wall. Door opening is 1.8m so a 15px-radius body fits through.
  wall(1.35, WALL_T, -5.075, frontZ);
  wall(2.6, WALL_T, -1.3, frontZ);
  wall(2.35, WALL_T, 4.575, frontZ);
  wall(3.4, WALL_T, 1.7, frontZ); // window is glass, not a walk-through
  wall(HOUSE_W, WALL_T, 0, -HALF_D);
  wall(WALL_T, HOUSE_D, -HOUSE_W / 2, 0);
  wall(WALL_T, HOUSE_D, HOUSE_W / 2, 0);
  // Porch posts sit outside the doorway
  wall(0.22, 0.22, -4.7, 4.7);
  wall(0.22, 0.22, -2.3, 4.7);

  const door = footprint(cx, cy, -3.5, frontZ + 0.15, 1.8, 0.4, scale);

  const floors: HershFloor[] = [];
  const deck = (w: number, d: number, x: number, z: number, meters: number) => {
    const r = footprint(cx, cy, x, z, w, d, scale);
    floors.push({ ...r, z: Math.round(meters * PX_PER_M * scale) });
  };
  const attic = FLOOR_H + 0.08;
  deck(1.35, HOUSE_D - 0.4, -5.0, 0, attic);
  deck(8.0, HOUSE_D - 0.4, 1.4, 0, attic);
  deck(1.7, 2.8, -3.55, -2.45, attic);
  deck(1.7, 1.35, -3.55, 3.0, attic);

  // One ramp along the stair run. Low local Z is the attic end (min world X).
  const stairCount = 16;
  const stairDepth = 0.23;
  const bottomZ = 2.4 + stairDepth / 2;
  const topZ = 2.4 - (stairCount - 1) * stairDepth - stairDepth / 2;
  const ramp = footprint(cx, cy, -3.55, (bottomZ + topZ) / 2, 1.7, bottomZ - topZ, scale);
  floors.push({
    ...ramp,
    z: Math.round(attic * PX_PER_M * scale),
    z1: 0,
    along: "x",
  });

  return { cx, cy, solids, floors, door };
}
