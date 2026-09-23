import type { Look } from "./cosmetics";
import type { MatchSettings } from "./modes";
import type { MoveInput } from "./movement";

export interface JoinOptions {
  name?: string;
  identity?: string;
  classId?: string;
  look?: Partial<Look>;
}

export interface ClientMessageMap {
  input: MoveInput;
  loadout: { identity?: string; classId?: string; team?: number; ready?: boolean; look?: Partial<Look>; name?: string };
  settings: Partial<MatchSettings>;
  start: Record<string, never>;
  lobby: Record<string, never>;
  leave: Record<string, never>;
  ping: number;
  rtt: number;
}

export type GameEvent =
  | { t: "shoot"; id: string; x: number; y: number; aim: number; weapon: string; x2: number; y2: number; z1?: number; z2?: number }
  | { t: "impact"; x: number; y: number; kind: string }
  | { t: "explode"; x: number; y: number; kind: string }
  | { t: "hit"; attacker: string; victim: string; x: number; y: number; dmg: number; head: boolean }
  | { t: "hurt"; id: string; dir: number; dmg: number; fromX: number; fromY: number }
  | { t: "down"; id: string; by: string; byName: string; weapon: string; dist: number }
  | { t: "dead"; id: string; by: string; byName: string; weapon: string; dist: number }
  | { t: "feed"; killer: string; killerName: string; victim: string; victimName: string; weapon: string }
  | { t: "capture"; id: string; owner: number }
  | { t: "notice"; id: string; text: string }
  | { t: "repair"; x: number; y: number }
  | { t: "ability"; id: string; kind: string };
