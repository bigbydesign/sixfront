export const GAME_PASSWORD = process.env.SIXFRONT_PASSWORD || "4195454043";

export function passwordOk(raw: unknown): boolean {
  return String(raw ?? "") === GAME_PASSWORD;
}
