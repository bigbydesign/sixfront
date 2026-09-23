export interface Binds {
  up: string;
  down: string;
  left: string;
  right: string;
  reload: string;
  interact: string;
  ability: string;
  grenade: string;
  sprint: string;
  slot1: string;
  slot2: string;
  slot3: string;
  slot4: string;
  slot5: string;
  crouch: string;
  score: string;
  map: string;
  brake: string;
}

export const DEFAULT_BINDS: Binds = {
  up: "KeyW",
  down: "KeyS",
  left: "KeyA",
  right: "KeyD",
  reload: "KeyR",
  interact: "KeyE",
  ability: "KeyF",
  grenade: "KeyG",
  sprint: "ShiftLeft",
  slot1: "Digit1",
  slot2: "Digit2",
  slot3: "Digit3",
  slot4: "Digit4",
  slot5: "Digit5",
  crouch: "ControlLeft",
  score: "Tab",
  map: "KeyM",
  brake: "Space",
};

export interface Prefs {
  binds: Binds;
  volume: number;
  shake: boolean;
  flash: boolean;
}

const KEY = "bbdn-sixfront-prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Prefs>;
    return {
      binds: { ...DEFAULT_BINDS, ...(raw.binds || {}) },
      volume: typeof raw.volume === "number" ? Math.max(0, Math.min(1, raw.volume)) : 0.8,
      shake: raw.shake !== false,
      flash: raw.flash !== false,
    };
  } catch {
    return { binds: { ...DEFAULT_BINDS }, volume: 0.8, shake: true, flash: true };
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export const keys = new Set<string>();
export const mouse = { x: 0, y: 0, left: false, right: false, worldX: 0, worldY: 0 };

let listening = false;

export function listenInput(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("keydown", (event) => {
    if (event.code === "Tab") event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => {
    keys.clear();
    mouse.left = false;
    mouse.right = false;
  });
  window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  });
  window.addEventListener("mousedown", (event) => {
    if (event.button === 0) mouse.left = true;
    if (event.button === 2) mouse.right = true;
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) mouse.left = false;
    if (event.button === 2) mouse.right = false;
  });
  window.addEventListener("contextmenu", (event) => event.preventDefault());
}

export function bindDown(code: string): boolean {
  return keys.has(code);
}

export function labelFor(code: string): string {
  return code.replace("Key", "").replace("Digit", "").replace("Left", "").replace("Right", "");
}
