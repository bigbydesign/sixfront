/** Derl boss encounter — cheese weaken, Colt 45 confidence, 4Loco heals. */
import { MAP_SCALE } from "@sixfront/shared";

const Y = 48;
const px = (yards: number) => Math.round(yards * MAP_SCALE * Y);

export const DERL_ID = "derl-boss";
export const DERL_MAX_HP = 800;
export const DERL_SPAWN_DELAY = 35; // seconds into match
export const CHEESE_WEAKEN_SEC = 10;
export const CHEESE_BUFF_SEC = 10;
export const COLT45_STOCK = 3;

/** 4Loco can spots around Big Hersh House (world px). */
export const LOCO_SPOTS: { x: number; y: number }[] = [
  { x: px(40), y: px(88) },
  { x: px(156), y: px(88) },
  { x: px(100), y: px(97) },
  { x: px(100), y: px(70) },
  { x: px(114), y: px(30) },
  { x: px(100), y: px(160) },
  { x: px(60), y: px(40) },
  { x: px(140), y: px(40) },
  { x: px(32), y: px(64) },
  { x: px(168), y: px(120) },
];

/** Open street, south of the bus — not inside the bus solid. */
export const DERL_SPAWN = { x: px(100), y: px(150) };

export function isDerl(id: string | undefined | null): boolean {
  return id === DERL_ID;
}
