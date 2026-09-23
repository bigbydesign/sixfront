export const IDENTITIES = [
  "Derek",
  "Hershal",
  "Reedo",
  "Melick",
  "Tomazon",
  "GnarlyNard",
  "Ryac Mac Monster",
] as const;

export type Identity = (typeof IDENTITIES)[number];

export const IDENTITY_ACCENT: Record<Identity, string> = {
  Derek: "#e0a040",
  Hershal: "#3d8c5a",
  Reedo: "#4a7eb5",
  Melick: "#c45050",
  Tomazon: "#8a62c4",
  GnarlyNard: "#c4b48a",
  "Ryac Mac Monster": "#d47028",
};

export const TEAM_COLORS = ["#3d7ec4", "#d06048", "#d4a017", "#8a8f98"];
export const TEAM_NAMES = ["West", "East", "North", "Independent"];

export function isIdentity(value: string): value is Identity {
  return (IDENTITIES as readonly string[]).includes(value);
}
