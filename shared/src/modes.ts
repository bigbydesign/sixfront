export type ModeId = "conquest" | "tdm" | "ffa" | "koth" | "base" | "lss";
export type TeamMode = "two" | "three" | "ffa";
export type ObjectiveGroup = "front" | "center" | "base";

export interface ModeDef {
  id: ModeId;
  label: string;
  blurb: string;
  objectives: "all" | "center" | "bases" | "none";
  pointsPerSecond: number;
  pointsPerKill: number;
  winScore: number;
  respawn: boolean;
  lives: number;
  personal: boolean;
}

export const MODES: ModeDef[] = [
  {
    id: "conquest",
    label: "CONQUEST",
    blurb: "Hold A through E. Points tick while you own them. First to the score, or the leader when time runs out.",
    objectives: "all",
    pointsPerSecond: 1,
    pointsPerKill: 25,
    winScore: 500,
    respawn: true,
    lives: 0,
    personal: false,
  },
  {
    id: "tdm",
    label: "TEAM DEATHMATCH",
    blurb: "No flags. First team to the kill target wins.",
    objectives: "none",
    pointsPerSecond: 0,
    pointsPerKill: 1,
    winScore: 40,
    respawn: true,
    lives: 0,
    personal: false,
  },
  {
    id: "ffa",
    label: "FREE FOR ALL",
    blurb: "Every soldier for themselves. First to the kill target.",
    objectives: "none",
    pointsPerSecond: 0,
    pointsPerKill: 1,
    winScore: 20,
    respawn: true,
    lives: 0,
    personal: true,
  },
  {
    id: "koth",
    label: "KING OF THE HILL",
    blurb: "Only the town hill counts. Hold C and bleed the clock.",
    objectives: "center",
    pointsPerSecond: 3,
    pointsPerKill: 10,
    winScore: 400,
    respawn: true,
    lives: 0,
    personal: false,
  },
  {
    id: "base",
    label: "BASE ASSAULT",
    blurb: "Capture the north and south bases. Holding both ends the fight fast.",
    objectives: "bases",
    pointsPerSecond: 2,
    pointsPerKill: 15,
    winScore: 400,
    respawn: true,
    lives: 0,
    personal: false,
  },
  {
    id: "lss",
    label: "LAST SQUAD STANDING",
    blurb: "One life. Downed teammates can still be revived. Last team standing wins.",
    objectives: "none",
    pointsPerSecond: 0,
    pointsPerKill: 0,
    winScore: 0,
    respawn: false,
    lives: 1,
    personal: false,
  },
];

export const MODE_MAP: Record<ModeId, ModeDef> = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;

export function isModeId(value: string): value is ModeId {
  return value in MODE_MAP;
}

export const MATCH_MINUTES = [5, 10, 15, 20, 30];
export const SCORE_LIMITS = [10, 20, 30, 50];
export const FFA_SCORE_LIMITS = SCORE_LIMITS;
export const RESPAWN_TIMES = [3, 5, 8, 12];

export interface MatchSettings {
  mode: ModeId;
  mapId: string;
  minutes: number;
  scoreLimit: number;
  teamMode: TeamMode;
  friendlyFire: boolean;
  aiCount: number;
  respawn: number;
  night: boolean;
}

export const DEFAULT_SETTINGS: MatchSettings = {
  mode: "ffa",
  mapId: "hersh-house",
  minutes: 10,
  scoreLimit: 20,
  teamMode: "ffa",
  friendlyFire: false,
  aiCount: 0,
  respawn: 5,
  night: false,
};

export function sanitizeSettings(raw: Partial<MatchSettings> | undefined): MatchSettings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.mode = "ffa";
  s.teamMode = "ffa";
  s.friendlyFire = false;
  if (s.mapId !== "hersh-house" && s.mapId !== "sixfront") s.mapId = "hersh-house";
  s.mapId = "hersh-house";
  if (!MATCH_MINUTES.includes(s.minutes)) s.minutes = 10;
  if (!SCORE_LIMITS.includes(s.scoreLimit)) s.scoreLimit = 20;
  s.aiCount = 0;
  if (!RESPAWN_TIMES.includes(s.respawn)) s.respawn = 5;
  s.night = !!s.night;
  return s;
}

export function objectiveActive(group: ObjectiveGroup, mode: ModeId): boolean {
  const def = MODE_MAP[mode];
  if (def.objectives === "none") return false;
  if (def.objectives === "all") return group === "front";
  if (def.objectives === "center") return group === "center";
  if (def.objectives === "bases") return group === "base";
  return false;
}
