import { DEFAULT_LOOK, type GameEvent, type Identity } from "@sixfront/shared";
import "./style.css";
import { audio } from "./audio";
import { Session } from "./net";
import { ThreeView } from "./threeview";
import { listenInput, loadPrefs } from "./settings";
import {
  ensureHud,
  flashHurt,
  pushFeed,
  selection,
  setPlaying,
  showError,
  showHome,
  showHow,
  closeServerMenu,
  setLeaveMatch,
  setMatchMenu,
  showLobby,
  showSettings,
} from "./ui";

const session = new Session();
let view: ThreeView | null = null;
let lastPhase = "";
let booting = false;

listenInput();
setLeaveMatch(() => {
  closeServerMenu();
  stopGame();
  setPlaying(false);
  void session.leave().then(home);
});
setMatchMenu({
  leave: () => {
    closeServerMenu();
    stopGame();
    setPlaying(false);
    void session.leave().then(home);
  },
  spectate: () => {
    closeServerMenu();
    view?.enterSpectate();
  },
  rejoin: () => {
    closeServerMenu();
    view?.rejoin();
  },
});
audio.attach(loadPrefs());
window.addEventListener("pointerdown", () => audio.unlock(), { once: true });
// Minus toggles background music from lobby or match
let musicMuteHeld = false;
window.addEventListener("keydown", (event) => {
  if (event.code !== "Minus" && event.code !== "NumpadSubtract") return;
  if (event.repeat) return;
  if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement) return;
  if (musicMuteHeld) return;
  musicMuteHeld = true;
  audio.toggleMusic();
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Minus" || event.code === "NumpadSubtract") musicMuteHeld = false;
});

session.onEvent = (evt) => handleEvent(evt);
session.onDrop = () => {
  stopGame();
  setPlaying(false);
  showHome(
    () => { void create(); },
    (room) => { void joinRoom(room); },
    () => showHow(home),
    () => showSettings(home),
  );
  const note = document.querySelector(".lede");
  if (note) note.textContent = "The match server disconnected. Create a game again.";
};
session.onSync = () => {
  const phase = session.state?.phase ?? "";
  if (phase === "lobby") {
    closeServerMenu();
    if (lastPhase !== "lobby") stopGame();
    showLobby(session, () => { void session.leave().then(home); });
  } else if (phase === "play" || phase === "end") {
    if (lastPhase === "lobby") document.getElementById("screen")!.replaceChildren();
    setPlaying(true);
    ensureHud();
    if (!view) startGame();
  }
  lastPhase = phase;
};

void session.resume().then((ok) => { if (!ok) home(); });

function home(): void {
  lastPhase = "";
  showHome(
    () => { void create(); },
    (room) => { void joinRoom(room); },
    () => showHow(home),
    () => showSettings(home),
  );
}

async function create(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    const pick = selection();
    lookDefault();
    await session.create({ ...pick, name: pick.identity });
  } catch (error) {
    home();
    showError(error instanceof Error ? error.message : "Could not create the game.");
  } finally {
    booting = false;
  }
}

async function joinRoom(room: { roomId: string }): Promise<void> {
  try {
    const pick = selection();
    await session.joinRoom(room.roomId, { ...pick, name: pick.identity });
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not join.");
  }
}

function lookDefault(): void {
  const pick = selection();
  if (!pick.look) return;
  Object.assign(pick.look, DEFAULT_LOOK[pick.identity as Identity]);
}

function startGame(): void {
  const stage = document.getElementById("stage")!;
  view = new ThreeView(session, stage);
  document.getElementById("quake-bar")?.classList.remove("hidden");
  document.getElementById("radar")?.classList.remove("hidden");
}

function stopGame(): void {
  view?.destroy();
  view = null;
  setPlaying(false);
}

function handleEvent(evt: GameEvent): void {
  if (evt.t === "feed") pushFeed(`${evt.killerName}  ${evt.weapon}  ${evt.victimName}`);
  if (evt.t === "capture") {
    audio.play("capture");
    pushFeed(`${evt.id} captured`);
  }
  if (evt.t === "hurt") {
    const hit = session.state?.players.get(evt.id);
    if (hit) view?.blood(hit.x, hit.y, hit.floorZ);
    if (evt.id === session.me) {
      audio.play("hurt");
      flashHurt();
    }
  }
  if (evt.t === "hit" && evt.attacker === session.me) audio.play("hit");
  if (evt.t === "explode") view?.burst(evt.x, evt.y, evt.kind);
    if (evt.t === "shoot") {
    view?.tracer(evt.x, evt.y, evt.x2, evt.y2, evt.z1 ?? 74, evt.z2 ?? 74);
    view?.radarPing(evt.x, evt.y);
    if (evt.id === session.me) view?.onShotFeedback(evt.weapon);
    else audio.play(evt.weapon === "rocket" ? "rocket" : evt.weapon === "grenade" ? "empty" : "shot", pan(evt.x));
  }
  if (evt.t === "notice") pushFeed(evt.text);
  if (evt.t === "dead" && evt.id === session.me) audio.play("hurt");
  if (evt.t === "ability" && evt.kind === "loco") {
    audio.play("loco", evt.id === session.me ? 0 : pan(0));
  }
}

function pan(x: number): number {
  if (!view) return 0;
  return (x - view.midX) / 1200;
}
