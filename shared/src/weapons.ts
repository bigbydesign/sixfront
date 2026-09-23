export type WeaponId =
  | "rifle"
  | "pistol"
  | "smg"
  | "lmg"
  | "carbine"
  | "scout"
  | "sniper"
  | "shotgun"
  | "rocket"
  | "grenade"
  | "cheese";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  auto: boolean;
  damage: number;
  rpm: number;
  mag: number;
  reserve: number;
  reload: number;
  spread: number;
  pellets: number;
  speed: number;
  radius: number;
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  heat: number;
  vehicleMul: number;
  splash: number;
  splashDamage: number;
  kind: "bullet" | "rocket" | "grenade";
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: "rifle", name: "Assault Rifle", auto: true, damage: 18, rpm: 640, mag: 30, reserve: 90,
    reload: 1.75, spread: 0.038, pellets: 1, speed: 1100, radius: 5, falloffStart: 420, falloffEnd: 980,
    falloffMin: 0.55, heat: 0.012, vehicleMul: 0.32, splash: 0, splashDamage: 0, kind: "bullet",
  },
  pistol: {
    id: "pistol", name: "Pistol", auto: false, damage: 24, rpm: 320, mag: 12, reserve: 36,
    reload: 1.25, spread: 0.034, pellets: 1, speed: 980, radius: 5, falloffStart: 260, falloffEnd: 640,
    falloffMin: 0.5, heat: 0.02, vehicleMul: 0.22, splash: 0, splashDamage: 0, kind: "bullet",
  },
  smg: {
    id: "smg", name: "SMG", auto: true, damage: 12, rpm: 900, mag: 32, reserve: 96,
    reload: 1.55, spread: 0.06, pellets: 1, speed: 1000, radius: 5, falloffStart: 220, falloffEnd: 520,
    falloffMin: 0.42, heat: 0.01, vehicleMul: 0.28, splash: 0, splashDamage: 0, kind: "bullet",
  },
  lmg: {
    id: "lmg", name: "Light Machine Gun", auto: true, damage: 14, rpm: 760, mag: 70, reserve: 140,
    reload: 3.1, spread: 0.048, pellets: 1, speed: 1080, radius: 5, falloffStart: 380, falloffEnd: 900,
    falloffMin: 0.62, heat: 0.008, vehicleMul: 0.4, splash: 0, splashDamage: 0, kind: "bullet",
  },
  carbine: {
    id: "carbine", name: "Carbine", auto: true, damage: 16, rpm: 560, mag: 24, reserve: 72,
    reload: 1.65, spread: 0.034, pellets: 1, speed: 1080, radius: 5, falloffStart: 360, falloffEnd: 860,
    falloffMin: 0.58, heat: 0.011, vehicleMul: 0.3, splash: 0, splashDamage: 0, kind: "bullet",
  },
  scout: {
    id: "scout", name: "Scout Carbine", auto: false, damage: 28, rpm: 260, mag: 18, reserve: 54,
    reload: 1.7, spread: 0.018, pellets: 1, speed: 1300, radius: 4, falloffStart: 640, falloffEnd: 1400,
    falloffMin: 0.78, heat: 0.006, vehicleMul: 0.26, splash: 0, splashDamage: 0, kind: "bullet",
  },
  sniper: {
    id: "sniper", name: "Sniper Rifle", auto: false, damage: 78, rpm: 48, mag: 5, reserve: 20,
    reload: 2.85, spread: 0.11, pellets: 1, speed: 1600, radius: 4, falloffStart: 900, falloffEnd: 2200,
    falloffMin: 0.88, heat: 0.004, vehicleMul: 0.35, splash: 0, splashDamage: 0, kind: "bullet",
  },
  shotgun: {
    id: "shotgun", name: "Shotgun", auto: false, damage: 9, rpm: 80, mag: 6, reserve: 18,
    reload: 2.4, spread: 0.16, pellets: 7, speed: 860, radius: 4, falloffStart: 80, falloffEnd: 280,
    falloffMin: 0.25, heat: 0, vehicleMul: 0.35, splash: 0, splashDamage: 0, kind: "bullet",
  },
  rocket: {
    id: "rocket", name: "AT Launcher", auto: false, damage: 48, rpm: 40, mag: 1, reserve: 3,
    reload: 2.6, spread: 0.02, pellets: 1, speed: 460, radius: 8, falloffStart: 2000, falloffEnd: 2000,
    falloffMin: 1, heat: 0, vehicleMul: 3.4, splash: 78, splashDamage: 46, kind: "rocket",
  },
  grenade: {
    id: "grenade", name: "Hotdog", auto: false, damage: 0, rpm: 50, mag: 1, reserve: 0,
    reload: 0, spread: 0.06, pellets: 1, speed: 420, radius: 6, falloffStart: 1, falloffEnd: 1,
    // 65% of a standard 100 HP pool at blast center
    falloffMin: 1, heat: 0, vehicleMul: 1.3, splash: 110, splashDamage: 65, kind: "grenade",
  },
  cheese: {
    id: "cheese", name: "Cheese Gun", auto: true, damage: 8, rpm: 480, mag: 40, reserve: 120,
    reload: 2.0, spread: 0.05, pellets: 1, speed: 900, radius: 5, falloffStart: 280, falloffEnd: 700,
    falloffMin: 0.5, heat: 0.01, vehicleMul: 0.2, splash: 0, splashDamage: 0, kind: "bullet",
  },
};

/** Bullet distances were tuned on the smaller arena. The map is twice that size. */
export const GUN_RANGE = 2;

export function falloff(weapon: WeaponDef, dist: number): number {
  const start = weapon.falloffStart * GUN_RANGE;
  const end = weapon.falloffEnd * GUN_RANGE;
  if (dist <= start) return 1;
  if (dist >= end) return weapon.falloffMin;
  const t = (dist - start) / (end - start);
  return 1 + (weapon.falloffMin - 1) * t;
}
