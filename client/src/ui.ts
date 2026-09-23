import {
  CLASS_LIST,
  CLASSES,
  DEFAULT_LOOK,
  IDENTITIES,
  IDENTITY_ACCENT,
  MATCH_MINUTES,
  RESPAWN_TIMES,
  SCORE_LIMITS,
  WEAPONS,
  slotWeapon,
  type ClassId,
  type Identity,
  type Look,
  type WeaponId,
} from "@sixfront/shared";
import { fetchRooms, type ListedRoom, type Session, type SyncPlayer } from "./net";
import { DEFAULT_BINDS, labelFor, loadPrefs, savePrefs, type Binds, type Prefs } from "./settings";

const screen = () => document.getElementById("screen")!;
const stage = () => document.getElementById("stage")!;
const hud = () => document.getElementById("hud")!;

let look: Look = { ...DEFAULT_LOOK.Derek };
let identity: Identity = "Derek";
let classId: ClassId = "rifleman";
let team = 0;
const feed: string[] = [];

export function selection(): { identity: Identity; classId: ClassId; look: Look; team: number } {
  return { identity, classId, look, team };
}

export function setPlaying(playing: boolean): void {
  screen().classList.toggle("hidden", playing);
  stage().classList.toggle("hidden", !playing);
  hud().classList.toggle("hidden", !playing);
}

export function showHome(
  onCreate: () => void,
  onPick: (room: ListedRoom) => void,
  onHow: () => void,
  onSettings: () => void,
): void {
  setPlaying(false);
  if (joinPoll !== null) window.clearInterval(joinPoll);
  screen().innerHTML = `
    <div class="home home-hero">
      <div class="home-scrim"></div>
      <div class="home-card">
        <p class="eyebrow">Big by Design</p>
        <h1>BIG HERSH HOUSE</h1>
        <p class="lede">Free-for-all at Big Hersh House — Nuketown-style street fight. Derko's Attic, mid bus, eBikes.</p>
        <p class="error" id="err"></p>
        <div class="actions">
          <button id="create" class="primary">Create Game</button>
          <button id="how">How to Play</button>
          <button id="settings">Settings</button>
        </div>
        <h3 class="join-divider">Open games</h3>
        <p class="hint" id="server-status">Loading games…</p>
        <div class="servers" id="servers"></div>
      </div>
    </div>`;
  document.getElementById("create")!.onclick = onCreate;
  document.getElementById("how")!.onclick = onHow;
  document.getElementById("settings")!.onclick = onSettings;
  void refreshServerList(onPick);
  joinPoll = window.setInterval(() => void refreshServerList(onPick), 4000);
}

let joinPoll: number | null = null;

function phaseLabel(phase: string): string {
  if (phase === "play") return "In match";
  if (phase === "end") return "Finished";
  return "Lobby";
}

function renderServerList(rooms: ListedRoom[], onPick: (room: ListedRoom) => void): void {
  const list = document.getElementById("servers");
  if (!list) return;
  if (!rooms.length) {
    list.innerHTML = `<p class="hint">No open games yet. Create one and it shows up here.</p>`;
    return;
  }
  list.innerHTML = rooms.map((room) => {
    const full = room.clients >= room.maxClients;
    const label = phaseLabel(room.phase);
    return `<button type="button" class="server-row${full ? " full" : ""}" data-id="${room.roomId}" data-code="${room.code}" ${full ? "disabled" : ""}>
      <b>${label}</b>
      <span>${room.humans}/${room.maxClients} players</span>
    </button>`;
  }).join("");
  list.querySelectorAll(".server-row:not(.full)").forEach((node) => {
    node.addEventListener("click", () => {
      const id = (node as HTMLElement).dataset.id!;
      const code = (node as HTMLElement).dataset.code!;
      const picked = rooms.find((r) => r.roomId === id && r.code === code);
      if (picked) onPick(picked);
    });
  });
}

async function refreshServerList(onPick: (room: ListedRoom) => void): Promise<void> {
  const status = document.getElementById("server-status");
  try {
    const rooms = await fetchRooms();
    renderServerList(rooms, onPick);
    if (status) status.textContent = `${rooms.length} game${rooms.length === 1 ? "" : "s"} online`;
  } catch (error) {
    if (status) status.textContent = "Could not reach the match server.";
    renderServerList([], onPick);
  }
}

export function showJoin(onBack: () => void, _onGo: (code: string) => void, onPickRoom?: (room: ListedRoom) => void): void {
  if (joinPoll !== null) window.clearInterval(joinPoll);
  const pick = onPickRoom ?? (() => undefined);
  screen().innerHTML = `
    <div class="panel narrow join-panel">
      <button class="back" id="back">Back</button>
      <h2>Open games</h2>
      <p class="hint" id="server-status">Loading games…</p>
      <div class="servers" id="servers"></div>
    </div>`;
  document.getElementById("back")!.onclick = () => {
    if (joinPoll !== null) window.clearInterval(joinPoll);
    joinPoll = null;
    onBack();
  };
  void refreshServerList(pick);
  joinPoll = window.setInterval(() => void refreshServerList(pick), 4000);
}

export function showHow(onBack: () => void): void {
  screen().innerHTML = `
    <div class="panel wide">
      <button class="back" id="back">Back</button>
      <h2>How to Play</h2>
      <div class="help-grid">
        <section><h3>Free for all</h3><p>Everyone fights alone at Big Hersh House. Hold Derko's Attic, contest the mid bus, or push the guest house. First to the kill target wins.</p></section>
        <section><h3>Move and fight</h3><p>First person. Click to look. W A S D move, Left Shift run, Ctrl crouch, Space jump. Three trampolines launch you high for air shots. Aim up/down to shoot off the flat plane. 1–3 guns, 4 hotdog, 5 cheese gun. Scout sniper — RMB scopes. Gray smoke canisters sit outdoors — walk over one to pick it up, then G throws smoke. Without smoke, G still throws hotdogs; key 4 + fire always throws a hotdog. F ability (or drop Colt 45 during Derl). Minus mutes music. Esc opens leave menu.</p></section>
        <section><h3>Derl boss</h3><p>Derl enters mid-match. Cheese him (5) to weaken (−25% his damage, +25% yours). Drop Colt 45 with F for +200% confidence but −20% his attack speed and damage. Grab green 4Loco cans for +50% health.</p></section>
        <section><h3>eBikes</h3><p>Bikes are parked around the map — walk up and press E to mount. W throttle, S reverse, A/D steer, Shift boost, Space brake. Passengers shoot. Bikes never run out of power. Ramming hurts.</p></section>
        <section><h3>Helicopter</h3><p>One helicopter sits on the south street. Press E to board. Mouse looks freely. W and S fly forward and back, A and D turn the helicopter, Space climbs, Ctrl descends. Let go and it hovers. Click fires hot dogs where you look. E gets out.</p></section>
        <section><h3>Ford Fusion</h3><p>Derko's Fusion is parked on the street. Press E to drive. W and S throttle, A and D steer, Space brakes. E gets out. Ramming hurts.</p></section>
        <section><h3>Classes</h3><p>Rifleman sprints. Medic heals and revives. Heavy suppresses. Scout snipes and spots farther. Engineer repairs and drops barricades. Anti-vehicle carries a launcher.</p></section>
        <section><h3>Radar</h3><p>Enemies outside sight are hidden. Gunfire flashes on the minimap. M expands the map. Tab is the scoreboard. Esc opens the server menu.</p></section>
      </div>
    </div>`;
  document.getElementById("back")!.onclick = onBack;
}

export function showSettings(onBack: () => void): void {
  const prefs = loadPrefs();
  const bindLabel: Partial<Record<keyof Binds, string>> = { grenade: "hotdog", slot4: "hotdog slot", slot5: "cheese gun" };
  const rows = (Object.keys(DEFAULT_BINDS) as (keyof Binds)[]).map((key) =>
    `<button class="bind" data-bind="${key}"><span>${bindLabel[key] ?? key}</span><strong>${labelFor(prefs.binds[key])}</strong></button>`).join("");
  screen().innerHTML = `
    <div class="panel narrow">
      <button class="back" id="back">Back</button>
      <h2>Settings</h2>
      <label>Volume <strong id="vol-label">${Math.round(prefs.volume * 100)}</strong></label>
      <input id="vol" type="range" min="0" max="100" value="${Math.round(prefs.volume * 100)}">
      <label class="check"><input id="shake" type="checkbox" ${prefs.shake ? "checked" : ""}> Screen shake</label>
      <label class="check"><input id="flash" type="checkbox" ${prefs.flash ? "checked" : ""}> Damage flash</label>
      <h3>Keys</h3>
      <div class="binds">${rows}</div>
      <p class="hint" id="hint">Click a key, then press the new one.</p>
    </div>`;
  const save = () => {
    const next: Prefs = {
      binds: prefs.binds,
      volume: Number((document.getElementById("vol") as HTMLInputElement).value) / 100,
      shake: (document.getElementById("shake") as HTMLInputElement).checked,
      flash: (document.getElementById("flash") as HTMLInputElement).checked,
    };
    savePrefs(next);
  };
  let waiting: keyof Binds | null = null;
  const onKey = (event: KeyboardEvent) => {
    if (!waiting) return;
    event.preventDefault();
    prefs.binds[waiting] = event.code;
    waiting = null;
    save();
    window.removeEventListener("keydown", onKey);
    showSettings(onBack);
  };
  document.getElementById("back")!.onclick = () => {
    window.removeEventListener("keydown", onKey);
    save();
    onBack();
  };
  document.getElementById("vol")!.oninput = () => {
    document.getElementById("vol-label")!.textContent = (document.getElementById("vol") as HTMLInputElement).value;
    save();
  };
  document.getElementById("shake")!.onchange = save;
  document.getElementById("flash")!.onchange = save;
  document.querySelectorAll(".bind").forEach((node) => {
    node.addEventListener("click", () => {
      waiting = (node as HTMLElement).dataset.bind as keyof Binds;
      document.getElementById("hint")!.textContent = `Press a key for ${waiting}.`;
    });
  });
  window.addEventListener("keydown", onKey);
}

function slotMarkup(state: NonNullable<Session["state"]>): string {
  return IDENTITIES.map((name) => {
    let found: SyncPlayer | undefined;
    state.players.forEach((p) => { if (!p.bot && p.identity === name) found = p; });
    const accent = IDENTITY_ACCENT[name];
    if (!found) return `<div class="slot empty" style="--accent:${accent}"><b>${name}</b><span>Open</span></div>`;
    return `<div class="slot" style="--accent:${accent}"><b>${name}</b><span>${found.ping} ms · ${found.ready ? "Ready" : "Waiting"} · ${CLASSES[found.classId as ClassId]?.name ?? found.classId}</span></div>`;
  }).join("");
}

export function showLobby(session: Session, onLeave: () => void): void {
  const state = session.state;
  if (!state) return;
  const host = state.hostId === session.me ? "1" : "0";
  const root = document.getElementById("lobby");
  if (!root || root.dataset.host !== host) mountLobby(session, onLeave);
  else refreshLobby(session);
}

function mountLobby(session: Session, onLeave: () => void): void {
  const state = session.state;
  if (!state) return;
  const me = session.mine;
  const host = state.hostId === session.me;
  const scroll = screen().scrollTop;
  screen().innerHTML = `
    <div class="lobby" id="lobby" data-host="${host ? "1" : "0"}">
      <header>
        <div>
          <p class="eyebrow">Big Hersh House</p>
          <h2 id="code">${state.code}</h2>
        </div>
        <div class="actions">
          ${host ? `<button id="start" class="primary">Start Match</button>` : `<p class="hint">Waiting for the host to start.</p>`}
          <button id="copy">Copy code</button>
          <button id="leave">Leave</button>
        </div>
      </header>
      <div class="lobby-grid">
        <div class="slots">${slotMarkup(state)}</div>
        <div class="panel">
          <h3>Your soldier</h3>
          <div class="identities">${IDENTITIES.map((name) => `<button data-id="${name}" class="${name === (me?.identity || identity) ? "on" : ""}">${name}</button>`).join("")}</div>
          <div class="classes">${CLASS_LIST.map((c) => `<button data-class="${c.id}" class="${c.id === (me?.classId || classId) ? "on" : ""}">${c.name}</button>`).join("")}</div>
          <p class="hint">${CLASSES[(me?.classId as ClassId) || classId].blurb}</p>
          <button id="ready" class="ready-toggle ${me?.ready ? "on" : ""}">${me?.ready ? "Ready" : "Not ready"}</button>
          ${host ? hostFields(state) : `<p class="hint">Waiting for the host.</p>`}
          <p class="error" id="err"></p>
        </div>
      </div>
    </div>`;
  document.getElementById("leave")!.onclick = onLeave;
  document.getElementById("copy")!.onclick = () => { void navigator.clipboard?.writeText(state.code); };
  document.querySelectorAll("[data-id]").forEach((node) => node.addEventListener("click", () => {
    identity = (node as HTMLElement).dataset.id as Identity;
    look = { ...DEFAULT_LOOK[identity] };
    session.send("loadout", { identity, look, name: identity });
  }));
  document.querySelectorAll("[data-class]").forEach((node) => node.addEventListener("click", () => {
    classId = (node as HTMLElement).dataset.class as ClassId;
    session.send("loadout", { classId });
  }));
  document.getElementById("ready")!.onclick = () => session.send("loadout", { ready: !me?.ready });
  if (host) {
    const read = () => session.send("settings", matchSettingsFromForm());
    document.querySelectorAll(".host-field").forEach((node) => node.addEventListener("change", read));
    document.getElementById("start")!.onclick = () => session.send("start", {});
  }
  screen().scrollTop = scroll;
}

function refreshLobby(session: Session): void {
  const state = session.state;
  const me = session.mine;
  if (!state) return;
  const slots = document.querySelector("#lobby .slots");
  if (slots) slots.innerHTML = slotMarkup(state);
  document.querySelectorAll("#lobby [data-id]").forEach((node) => {
    node.classList.toggle("on", (node as HTMLElement).dataset.id === (me?.identity || identity));
  });
  document.querySelectorAll("#lobby [data-class]").forEach((node) => {
    node.classList.toggle("on", (node as HTMLElement).dataset.class === (me?.classId || classId));
  });
  const ready = document.getElementById("ready");
  if (ready) {
    ready.classList.toggle("on", !!me?.ready);
    ready.textContent = me?.ready ? "Ready" : "Not ready";
  }
  const hint = document.querySelector("#lobby .panel > .hint");
  if (hint && me) hint.textContent = CLASSES[(me.classId as ClassId) || classId].blurb;
}

function hostFields(state: NonNullable<Session["state"]>): string {
  return `
    <h3>Match</h3>
    <p class="hint">Free for all — every player for themselves.</p>
    <label>Length (minutes)</label><select id="minutes" class="host-field">${MATCH_MINUTES.map((n) => `<option ${n === state.minutes ? "selected" : ""}>${n}</option>`).join("")}</select>
    <label>Kills to win</label><select id="score" class="host-field">${SCORE_LIMITS.map((n) => `<option ${n === state.scoreLimit ? "selected" : ""}>${n}</option>`).join("")}</select>
    <label>Respawn (seconds)</label><select id="respawn" class="host-field">${RESPAWN_TIMES.map((n) => `<option ${n === state.respawn ? "selected" : ""}>${n}</option>`).join("")}</select>
    <label class="check"><input id="night" class="host-field" type="checkbox" ${state.night ? "checked" : ""}> Night</label>`;
}

function matchSettingsFromForm(): Record<string, unknown> {
  return {
    mode: "ffa",
    teamMode: "ffa",
    friendlyFire: false,
    aiCount: 0,
    minutes: Number(value("minutes")),
    scoreLimit: Number(value("score")),
    respawn: Number(value("respawn")),
    night: checked("night"),
  };
}

function value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}
function checked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement).checked;
}

let menuOpen = false;
let leaveMatch: () => void = () => {};
let spectateMatch: () => void = () => {};
let rejoinMatch: () => void = () => {};

export function setLeaveMatch(fn: () => void): void {
  leaveMatch = fn;
}

export function setMatchMenu(actions: { leave: () => void; spectate: () => void; rejoin: () => void }): void {
  leaveMatch = actions.leave;
  spectateMatch = actions.spectate;
  rejoinMatch = actions.rejoin;
}

export function serverMenuOpen(): boolean {
  return menuOpen;
}

export function openServerMenu(session: Session): void {
  if (!menuOpen) toggleServerMenu(session);
  else bindPauseActions();
}

export function toggleServerMenu(session: Session): void {
  ensureHud();
  menuOpen = !menuOpen;
  const shell = document.getElementById("shell");
  shell?.classList.toggle("menu-open", menuOpen);
  const pause = document.getElementById("pause");
  if (!pause) return;
  pause.classList.toggle("hidden", !menuOpen);
  if (!menuOpen) return;
  if (document.pointerLockElement) document.exitPointerLock();
  const state = session.state;
  const host = !!state && state.hostId === session.me;
  const code = state?.code ? ` · ${state.code}` : "";
  pause.innerHTML = `
    <div class="pause-card">
      <p class="eyebrow">Paused${code}</p>
      <h2>Match menu</h2>
      <p class="hint">Spectate watches through another player's eyes. Rejoin puts you back in the fight. Leave match exits.</p>
      ${host && state ? hostFields(state) : `<p class="hint">Only the host can change match settings.</p>`}
      <div class="actions pause-actions">
        <button type="button" id="menu-spectate" class="primary">Spectate</button>
        <button type="button" id="menu-rejoin">Rejoin</button>
        <button type="button" id="menu-leave" class="danger">Leave match</button>
      </div>
    </div>`;
  bindPauseActions();
  if (!host) return;
  const read = () => session.send("settings", matchSettingsFromForm());
  pause.querySelectorAll(".host-field").forEach((node) => node.addEventListener("change", read));
}

function bindPauseActions(): void {
  const spectate = document.getElementById("menu-spectate");
  const rejoin = document.getElementById("menu-rejoin");
  const leave = document.getElementById("menu-leave");
  if (spectate) spectate.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeServerMenu();
    spectateMatch();
  };
  if (rejoin) rejoin.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeServerMenu();
    rejoinMatch();
  };
  if (leave) leave.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeServerMenu();
    leaveMatch();
  };
}

export function closeServerMenu(): void {
  menuOpen = false;
  document.getElementById("shell")?.classList.remove("menu-open");
  document.getElementById("pause")?.classList.add("hidden");
}

export function ensureHud(): void {
  const root = hud();
  if (root.dataset.ready === "hersh6" && document.getElementById("hud-menu")) return;
  root.dataset.ready = "hersh6";
  root.innerHTML = `
    <div class="fps-top">
      <div class="hp-wrap" id="hp-wrap">
        <div class="hp-fill" id="hp-fill"></div>
      </div>
      <div class="hp-wrap bike-wrap hidden" id="bike-wrap">
        <div class="hp-fill bike-fill" id="bike-fill"></div>
      </div>
      <div class="scoreline" id="scoreline"></div>
      <div class="fps-brand">BIG HERSH HOUSE</div>
    </div>
    <div class="feed" id="feed"></div>
    <div class="prompt" id="prompt"></div>
    <div class="specbar hidden" id="specbar"></div>
    <div class="fps-chips">
      <button type="button" class="chip chip-menu" id="hud-menu">MENU</button>
      <div class="chip chip-weapon"><span id="q-weapon">RIFLE</span></div>
      <div class="chip chip-ammo"><b id="q-ammo">30</b><span id="q-reserve">90</span></div>
      <div class="chip chip-dog">DOG <b id="q-grenades">5</b></div>
      <div class="chip chip-smoke">SMOKE <b id="q-smokes">0</b></div>
      <div class="chip chip-ability" id="q-ability">SPRINT</div>
      <div class="chip chip-bike hidden" id="q-bike"></div>
    </div>
    <div class="objectives" id="objs"></div>
    <div class="death hidden" id="death"></div>
    <div class="board hidden" id="board"></div>
    <div class="pause hidden" id="pause"></div>
    <div id="hurt"></div>
    <span id="q-health" class="hidden">100</span>
    <span id="q-armor" class="hidden">0</span>
    <span id="q-armor-label" class="hidden">ARMOR</span>`;
}

export function updateHud(session: Session, flags: { prompt: string; pause: boolean; score: boolean; spectate?: string }): void {
  ensureHud();
  const menuBtn = document.getElementById("hud-menu");
  if (menuBtn && menuBtn.dataset.bound !== "1") {
    menuBtn.dataset.bound = "1";
    menuBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.pointerLockElement) document.exitPointerLock();
      openServerMenu(session);
    });
  }
  const state = session.state;
  const me = session.mine;
  if (!state || !me) return;
  const objs = document.getElementById("objs")!;
  if (objs.innerHTML) objs.innerHTML = "";
  document.getElementById("scoreline")!.textContent =
    `${formatTime(state.timeLeft)}  ·  ${me.score} / ${state.scoreLimit} kills`;
  document.getElementById("prompt")!.textContent = flags.prompt;
  const specbar = document.getElementById("specbar");
  if (specbar) {
    specbar.textContent = flags.spectate || "";
    specbar.classList.toggle("hidden", !flags.spectate);
  }

  const hp = Math.max(0, Math.round(me.hp));
  const hpPct = Math.max(0, Math.min(100, (me.hp / Math.max(1, me.maxHp)) * 100));
  const healthEl = document.getElementById("q-health")!;
  healthEl.textContent = String(hp);
  const hpFill = document.getElementById("hp-fill")!;
  hpFill.style.width = `${hpPct}%`;
  hpFill.classList.toggle("hurt", hp < me.maxHp * 0.35);
  hpFill.classList.toggle("crit", hp < me.maxHp * 0.15);

  const bike = me.vehicleId ? state.vehicles.get(me.vehicleId) : undefined;
  const bikeWrap = document.getElementById("bike-wrap");
  const bikeFill = document.getElementById("bike-fill");
  if (bike && bikeWrap && bikeFill) {
    bikeWrap.classList.remove("hidden");
    const bp = Math.max(0, Math.min(100, (bike.hp / Math.max(1, bike.maxHp || 150)) * 100));
    bikeFill.style.width = `${bp}%`;
  } else {
    bikeWrap?.classList.add("hidden");
  }

  const mag = Math.max(0, me.mag | 0);
  const reserve = Math.max(0, me.reserve | 0);
  const ammoEl = document.getElementById("q-ammo")!;
  ammoEl.textContent = me.reloading ? "—" : String(mag);
  ammoEl.classList.toggle("empty", !me.reloading && mag === 0);
  document.getElementById("q-reserve")!.textContent = me.reloading ? "RELOAD" : String(reserve);
  document.getElementById("q-grenades")!.textContent = String(me.grenades ?? 0);
  const smokeEl = document.getElementById("q-smokes");
  if (smokeEl) smokeEl.textContent = String(me.smokes ?? 0);

  const def = CLASSES[me.classId as ClassId];
  const slotted = def ? slotWeapon(def, me.weaponSlot || 1) : null;
  const shortWeapon =
    me.weaponSlot === 4 ? "HOTDOG"
      : me.weaponSlot === 5 ? "CHEESE"
      : slotted === "barricade" ? "BARRICADE"
        : slotted && slotted in WEAPONS ? slotted.toUpperCase()
          : (def?.name ?? me.classId).toUpperCase();
  document.getElementById("q-weapon")!.textContent = shortWeapon;

  // Derl boss bar
  let derlBar = document.getElementById("derl-bar");
  if (state.derlAlive) {
    if (!derlBar) {
      derlBar = document.createElement("div");
      derlBar.id = "derl-bar";
      derlBar.className = "derl-bar";
      hud().appendChild(derlBar);
    }
    const pct = Math.max(0, Math.min(100, (state.derlHp / Math.max(1, state.derlMaxHp)) * 100));
    derlBar.innerHTML = `<span>DERL</span><i style="width:${pct}%"></i><em>CONF ${state.derlConfidence.toFixed(1)}x</em>`;
    derlBar.classList.remove("hidden");
  } else {
    derlBar?.classList.add("hidden");
  }
  const ability = (def?.abilityName ?? "ABILITY").toUpperCase();
  document.getElementById("q-ability")!.textContent =
    me.abilityCd > 0.2 ? `${ability} ${me.abilityCd.toFixed(1)}s` : ability;
  const bikeEl = document.getElementById("q-bike")!;
  bikeEl.classList.toggle("hidden", !bike);
  bikeEl.textContent = bike ? (me.seat === 0 ? "DRIVING" : "PASSENGER") : "";

  document.getElementById("board")!.classList.toggle("hidden", !flags.score);
  if (flags.score) {
    const rows: { html: string; score: number; kills: number }[] = [];
    state.players.forEach((p) => {
      const kills = p.kills | 0;
      const deaths = p.deaths | 0;
      const kd = deaths <= 0 ? kills.toFixed(1) : (kills / deaths).toFixed(2);
      const label = `${p.identity || p.name}${p.bot ? " (bot)" : ""}${p.id === me.id ? " ★" : ""}`;
      const cls = CLASSES[p.classId as ClassId]?.name ?? p.classId;
      rows.push({
        score: p.score | 0,
        kills,
        html: `<tr class="${p.id === me.id ? "me" : ""}"><td>${label}</td><td>${cls}</td><td>${kills}</td><td>${deaths}</td><td>${kd}</td><td>${p.score}</td><td>${p.ping}</td></tr>`,
      });
    });
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills);
    document.getElementById("board")!.innerHTML = `
      <h2>Scoreboard</h2>
      <table>
        <tr><th>Player</th><th>Class</th><th>K</th><th>D</th><th>K/D</th><th>Score</th><th>Ping</th></tr>
        ${rows.map((r) => r.html).join("")}
      </table>
      <p class="hint">Hold Tab</p>`;
  }
  const death = document.getElementById("death")!;
  const deathKey = state.phase === "end" ? "end" : me.alive === 0 ? "dead" : me.alive === 2 ? "down" : "up";
  if (death.dataset.mode !== deathKey) {
    death.dataset.mode = deathKey;
    if (deathKey === "dead") {
      death.classList.remove("hidden");
      death.innerHTML = `<p>Killed by <b id="killer">${me.killerName || "the house"}</b></p><p id="killmeta">${me.killerWeapon || ""} · ${me.killerDist} m</p><p id="respawn">Respawn ${Math.ceil(me.respawnLeft)}s</p><p id="spectate"></p>`;
    } else if (deathKey === "down") {
      death.classList.remove("hidden");
      death.innerHTML = `<p>Downed</p><p id="respawn">${Math.ceil(me.respawnLeft)}s to bleed out. A medic can still pull you up.</p><p id="spectate"></p>`;
    } else if (deathKey === "end") {
      death.classList.remove("hidden");
      death.innerHTML = `<p><b>${state.winnerName}</b> wins</p><p id="spectate"></p>`;
    } else death.classList.add("hidden");
  }
  const respawn = document.getElementById("respawn");
  if (respawn && me.alive !== 1) {
    respawn.textContent = me.alive === 2
      ? `${Math.ceil(me.respawnLeft)}s to bleed out. A medic can still pull you up.`
      : `Respawn ${Math.ceil(me.respawnLeft)}s`;
  }
  const spectate = document.getElementById("spectate");
  if (spectate) spectate.textContent = flags.spectate || "";
}

export function pushFeed(text: string): void {
  feed.unshift(text);
  feed.splice(4);
  const node = document.getElementById("feed");
  if (node) node.innerHTML = feed.map((line) => `<p>${line}</p>`).join("");
}

export function flashHurt(): void {
  if (!loadPrefs().flash) return;
  const node = document.getElementById("hurt");
  if (!node) return;
  node.classList.add("on");
  window.setTimeout(() => node.classList.remove("on"), 120);
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function showError(message: string): void {
  let node = document.getElementById("err");
  if (!node) {
    node = document.createElement("p");
    node.id = "err";
    node.className = "error toast-error";
    document.getElementById("shell")?.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("on");
  window.setTimeout(() => node?.classList.remove("on"), 5000);
}
