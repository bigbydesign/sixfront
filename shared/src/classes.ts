import type { WeaponId } from "./weapons";

export type ClassId = "rifleman" | "medic" | "heavy" | "scout" | "engineer" | "at";

export interface ClassDef {
  id: ClassId;
  name: string;
  blurb: string;
  hp: number;
  speed: number;
  armor: number;
  vision: number;
  primary: WeaponId;
  secondary: WeaponId | null;
  special: WeaponId | "barricade" | null;
  grenades: number;
  ability: string;
  abilityName: string;
  abilityCd: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  rifleman: {
    id: "rifleman", name: "Rifleman", blurb: "Balanced fighter with a short sprint.",
    hp: 100, speed: 176, armor: 1, vision: 430,
    primary: "rifle", secondary: "pistol", special: null, grenades: 5,
    ability: "sprint", abilityName: "Sprint", abilityCd: 8,
  },
  medic: {
    id: "medic", name: "Medic", blurb: "Heals allies and revives the downed.",
    hp: 100, speed: 180, armor: 1, vision: 420,
    primary: "smg", secondary: "pistol", special: null, grenades: 5,
    ability: "heal", abilityName: "Medical Kit", abilityCd: 10,
  },
  heavy: {
    id: "heavy", name: "Heavy", blurb: "Slow, tough, and built to suppress.",
    hp: 100, speed: 138, armor: 0.72, vision: 400,
    primary: "lmg", secondary: null, special: null, grenades: 5,
    ability: "suppress", abilityName: "Suppress", abilityCd: 14,
  },
  scout: {
    id: "scout", name: "Scout", blurb: "Sniper primary. Scope with RMB. Spots farther.",
    hp: 90, speed: 206, armor: 1, vision: 560,
    primary: "sniper", secondary: "pistol", special: null, grenades: 5,
    ability: "pulse", abilityName: "Recon Pulse", abilityCd: 13,
  },
  engineer: {
    id: "engineer", name: "Engineer", blurb: "Repairs bikes and drops barricades.",
    hp: 100, speed: 170, armor: 1, vision: 420,
    primary: "carbine", secondary: "pistol", special: "barricade", grenades: 5,
    ability: "repair", abilityName: "Repair Kit", abilityCd: 3.5,
  },
  at: {
    id: "at", name: "Anti-Vehicle", blurb: "Rockets for bikes and future armor.",
    hp: 92, speed: 162, armor: 1, vision: 410,
    primary: "carbine", secondary: "pistol", special: "rocket", grenades: 5,
    ability: "lock", abilityName: "Lock", abilityCd: 8,
  },
};

export const CLASS_LIST = Object.values(CLASSES);

export function isClassId(value: string): value is ClassId {
  return value in CLASSES;
}

export function slotWeapon(def: ClassDef, slot: number): WeaponId | "barricade" | null {
  if (slot === 1) return def.primary;
  if (slot === 2) return def.secondary;
  if (slot === 3) return def.special;
  return null;
}
