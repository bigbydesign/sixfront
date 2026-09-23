import type { Identity } from "./ids";

export interface Look {
  helmet: number;
  hat: number;
  shirt: number;
  vest: number;
  pants: number;
  face: number;
}

export const SHIRTS = ["#c45050", "#3d7ec4", "#3d8c5a", "#e0a040", "#8a62c4", "#c4b48a", "#d8d2c8", "#2c3138"];
export const PANTS = ["#3a3e36", "#4a4034", "#2e3a48", "#5a5346"];

export const HELMETS = ["None", "Combat", "Cap", "Beret"];
export const HATS = ["None", "Boonie", "Beanie"];
export const VESTS = ["None", "Light", "Plate"];
export const FACES = ["None", "Glasses", "Beard", "Mask"];

export const DEFAULT_LOOK: Record<Identity, Look> = {
  Derek: { helmet: 1, hat: 0, shirt: 3, vest: 1, pants: 0, face: 0 },
  Hershal: { helmet: 0, hat: 1, shirt: 2, vest: 1, pants: 1, face: 2 },
  Reedo: { helmet: 2, hat: 0, shirt: 1, vest: 0, pants: 2, face: 1 },
  Melick: { helmet: 3, hat: 0, shirt: 0, vest: 2, pants: 0, face: 0 },
  Tomazon: { helmet: 1, hat: 0, shirt: 4, vest: 1, pants: 2, face: 3 },
  GnarlyNard: { helmet: 0, hat: 2, shirt: 5, vest: 0, pants: 3, face: 2 },
  "Ryac Mac Monster": { helmet: 2, hat: 0, shirt: 6, vest: 2, pants: 1, face: 3 },
};

export function clampLook(raw: Partial<Look> | undefined, fallback: Look): Look {
  const n = (v: unknown, max: number, d: number) => {
    const x = typeof v === "number" ? Math.floor(v) : d;
    return Math.max(0, Math.min(max, x));
  };
  return {
    helmet: n(raw?.helmet, HELMETS.length - 1, fallback.helmet),
    hat: n(raw?.hat, HATS.length - 1, fallback.hat),
    shirt: n(raw?.shirt, SHIRTS.length - 1, fallback.shirt),
    vest: n(raw?.vest, VESTS.length - 1, fallback.vest),
    pants: n(raw?.pants, PANTS.length - 1, fallback.pants),
    face: n(raw?.face, FACES.length - 1, fallback.face),
  };
}
