/** Ground smoke canisters — outdoor open spots around Big Hersh House. */
import { MAP_SCALE } from "@sixfront/shared";

const Y = 48;
const px = (yards: number) => Math.round(yards * MAP_SCALE * Y);

/** Cloud lasts ~15s; opaque across the cloud unless players are right next to each other. */
export const SMOKE_DURATION = 15;
export const SMOKE_RADIUS = px(9);
/** Players closer than this can still see each other through / inside smoke. */
export const SMOKE_NEAR = px(5.5);
/** Canister returns to its pad after this many seconds. */
export const SMOKE_RESPAWN = 14;
/** Carry at most one smoke at a time. */
export const SMOKE_CARRY_MAX = 1;

/**
 * Outdoor pads only — front yard, street by the bus, Hersh side, guest house side.
 * Kept clear of house interiors and wall solids (validated at spawn).
 */
export const SMOKE_SPOTS: { x: number; y: number }[] = [
  // Front yard (west of street, south of Hersh porch / welcome area)
  { x: px(74), y: px(72) },
  { x: px(68), y: px(100) },
  // Street by the bus (open pavement, not on the bus solid)
  { x: px(100), y: px(82) },
  { x: px(100), y: px(118) },
  // Hersh House side / flank (open grass west of the house)
  { x: px(42), y: px(118) },
  { x: px(55), y: px(68) },
  // Guest house street side / side yard
  { x: px(124), y: px(88) },
  { x: px(148), y: px(112) },
];
