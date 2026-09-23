import { Client, Room } from "colyseus.js";
import type { GameEvent, JoinOptions, MoveInput } from "@sixfront/shared";

export interface SyncPlayer {
  id: string;
  name: string;
  identity: string;
  bot: number;
  team: number;
  classId: string;
  x: number;
  y: number;
  aim: number;
  hp: number;
  maxHp: number;
  alive: number;
  vehicleId: string;
  seat: number;
  weaponSlot: number;
  mag: number;
  reserve: number;
  grenades: number;
  smokes: number;
  reloading: number;
  reloadPct: number;
  abilityCd: number;
  abilityMax: number;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  ready: number;
  helmet: number;
  hat: number;
  shirt: number;
  vest: number;
  pants: number;
  face: number;
  seenMask: number;
  blip: number;
  ack: number;
  respawnLeft: number;
  killerName: string;
  killerWeapon: string;
  killerDist: number;
  sprinting: number;
  floorZ: number;
  jumpZ: number;
  pitch: number;
}

export interface SyncVehicle {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  battery: number;
  hp: number;
  maxHp: number;
  driver: string;
  passenger: string;
  alive: number;
  braking: number;
  boosting: number;
  seats: number;
}

export interface SyncObjective {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  group: string;
  owner: number;
  progress: number;
  progressTeam: number;
  active: number;
}

export interface SyncState {
  phase: string;
  code: string;
  hostId: string;
  mode: string;
  mapId: string;
  minutes: number;
  scoreLimit: number;
  teamMode: string;
  friendlyFire: number;
  aiCount: number;
  respawn: number;
  night: number;
  timeLeft: number;
  score0: number;
  score1: number;
  score2: number;
  winnerTeam: number;
  winnerName: string;
  derlAlive: number;
  derlHp: number;
  derlMaxHp: number;
  derlConfidence: number;
  players: { forEach(fn: (p: SyncPlayer, id: string) => void): void; get(id: string): SyncPlayer | undefined };
  vehicles: { forEach(fn: (v: SyncVehicle, id: string) => void): void; get(id: string): SyncVehicle | undefined };
  objectives: { length: number; forEach(fn: (o: SyncObjective, index: number) => void): void };
  towers: { forEach(fn: (t: { id: string; x: number; y: number; owner: number; progress: number }) => void): void };
  projectiles: { forEach(fn: (p: { id: string; x: number; y: number; z: number; vx: number; vy: number; kind: string; owner: string; weapon: string }, id: string) => void): void };
  barricades: { forEach(fn: (b: { id: string; x: number; y: number; w: number; h: number; hp: number; team: number }, id: string) => void): void };
  pickups: { forEach(fn: (p: { id: string; kind: string; x: number; y: number; alive: number }, id: string) => void): void };
  smokeClouds: { forEach(fn: (c: { id: string; x: number; y: number; r: number }, id: string) => void): void };
  doors: { forEach(fn: (d: { id: string; open: number }, id: string) => void): void; get(id: string): { id: string; open: number } | undefined };
}

const TOKEN = "sixfront-token";

export interface ListedRoom {
  code: string;
  roomId: string;
  clients: number;
  maxClients: number;
  phase: string;
  humans: number;
}

export async function fetchRooms(): Promise<ListedRoom[]> {
  const response = await fetch(`${serverUrl()}/api/rooms`);
  const body = await response.json() as { rooms?: ListedRoom[]; error?: string };
  if (!response.ok) throw new Error(body.error || "Could not load games.");
  return body.rooms ?? [];
}

export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  return `${location.origin}/sixfront/colyseus`;
}

export class Session {
  readonly client = new Client(serverUrl());
  room: Room | null = null;
  me = "";
  onSync: (() => void) | null = null;
  onEvent: ((evt: GameEvent) => void) | null = null;
  onDrop: (() => void) | null = null;
  private pingTimer = 0;

  get state(): SyncState | null {
    return (this.room?.state as SyncState | undefined) ?? null;
  }

  get mine(): SyncPlayer | null {
    return this.state?.players.get(this.me) ?? null;
  }

  async create(options: JoinOptions): Promise<void> {
    const response = await fetch(`${serverUrl()}/api/rooms`, { method: "POST" });
    const body = await response.json() as { roomId?: string; error?: string };
    if (!response.ok || !body.roomId) throw new Error(body.error || "Could not create a game.");
    await this.joinId(body.roomId, options);
  }

  async joinCode(code: string, options: JoinOptions): Promise<void> {
    const response = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`);
    const body = await response.json() as { roomId?: string; error?: string };
    if (!response.ok || !body.roomId) throw new Error(body.error || "No game with that code.");
    await this.joinId(body.roomId, options);
  }

  async joinRoom(roomId: string, options: JoinOptions): Promise<void> {
    await this.joinId(roomId, options);
  }

  async resume(): Promise<boolean> {
    const token = sessionStorage.getItem(TOKEN);
    if (!token) return false;
    try {
      await this.bind(await this.client.reconnect(token));
      return true;
    } catch {
      sessionStorage.removeItem(TOKEN);
      return false;
    }
  }

  async leave(): Promise<void> {
    sessionStorage.removeItem(TOKEN);
    window.clearInterval(this.pingTimer);
    await this.room?.leave(true);
    this.room = null;
  }

  send(type: string, payload: unknown): void {
    this.room?.send(type, payload);
  }

  input(payload: MoveInput): void {
    this.room?.send("input", payload);
  }

  private async joinId(roomId: string, options: JoinOptions): Promise<void> {
    await this.bind(await this.client.joinById(roomId, options));
  }

  private async bind(room: Room): Promise<void> {
    this.room = room;
    this.me = room.sessionId;
    sessionStorage.setItem(TOKEN, room.reconnectionToken);
    room.onStateChange(() => this.onSync?.());
    room.onMessage("evt", (evt: GameEvent) => this.onEvent?.(evt));
    room.onMessage("pong", (sent: number) => {
      const rtt = Date.now() - sent;
      room.send("rtt", rtt);
    });
    room.onLeave((code: number) => {
      window.clearInterval(this.pingTimer);
      if (code !== 1000) this.onDrop?.();
    });
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => room.send("ping", Date.now()), 2000);
    this.onSync?.();
  }
}
