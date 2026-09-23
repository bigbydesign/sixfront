/** Mr. Cheese Curl — shootable wander mascot. */
import { MAP_SCALE } from "@sixfront/shared";

const Y = 48;
const px = (yards: number) => Math.round(yards * MAP_SCALE * Y);

export const CHEESE_CURL_ID = "cheese-curl";
export const CHEESE_CURL_HP = 140;
export const CHEESE_CURL_NAME = "Mr. Cheese Curl";

export const CHEESE_CURL_SPAWN = { x: px(100), y: px(120) };

export function isCheeseCurl(id: string | undefined | null): boolean {
  return id === CHEESE_CURL_ID;
}
