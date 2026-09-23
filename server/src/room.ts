import { Client, Room } from "colyseus";
import {
  DEFAULT_LOOK,
  IDENTITIES,
  clampLook,
  isIdentity,
  type Identity,
  type Look,
} from "@sixfront/shared";
import { WarSim } from "./sim";
import { WarState } from "./schema";

function clean(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[^\w \-'.]/g, "").trim().slice(0, 16);
  return text || fallback;
}

export class WarRoom extends Room<WarState> {
  maxClients = 6;
  sim!: WarSim;

  onCreate(options: { code?: string }): void {
    this.setState(new WarState());
    const code = clean(options?.code, "HERSH-0000").toUpperCase();
    this.state.code = /^(HERSH|BBDN)-\d{4}$/.test(code) ? code : "HERSH-0000";
    const syncMeta = () => {
      let humans = 0;
      this.state.players.forEach((p) => { if (!p.bot) humans += 1; });
      this.setMetadata({ code: this.state.code, phase: this.state.phase, humans });
    };
    syncMeta();
    this.sim = new WarSim(this.state, (evt) => this.broadcast("evt", evt));
    this.setSimulationInterval(() => {
      this.sim.tick();
      syncMeta();
    }, 1000 / 30);
    this.setPatchRate(1000 / 30);
    this.onMessage("input", (client, message) => this.sim.setInput(client.sessionId, message ?? {}));
    this.onMessage("loadout", (client, message) => this.sim.loadout(client.sessionId, message ?? {}));
    this.onMessage("settings", (client, message) => {
      if (client.sessionId !== this.state.hostId) return;
      this.sim.applySettings(message ?? {});
    });
    this.onMessage("start", (client) => {
      if (client.sessionId !== this.state.hostId) return;
      const error = this.sim.start();
      if (error) client.send("evt", { t: "notice", id: client.sessionId, text: error });
    });
    this.onMessage("lobby", (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.phase !== "lobby") this.sim.toLobby();
    });
    this.onMessage("ping", (client, sent) => client.send("pong", sent));
    this.onMessage("rtt", (client, ms) => this.sim.setPing(client.sessionId, Number(ms) || 0));
    this.onMessage("rejoin", (client) => this.sim.rejoin(client.sessionId));
  }

  onJoin(client: Client, options: { name?: string; identity?: string; classId?: string; look?: Partial<Look> }): void {
    const requested = isIdentity(String(options?.identity || "")) ? String(options.identity) as Identity : this.openIdentity();
    const look = clampLook(options?.look, DEFAULT_LOOK[requested]);
    const name = clean(options?.name, requested);
    this.sim.addHuman(client.sessionId, name, requested, String(options?.classId || "rifleman"), look);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    if (!consented) {
      try {
        await this.allowReconnection(client, 45);
        return;
      } catch {
        /* seat expired */
      }
    }
    const wasHost = this.state.hostId === client.sessionId;
    this.sim.remove(client.sessionId);
    if (wasHost) this.state.hostId = this.clients[0]?.sessionId ?? "";
  }

  private openIdentity(): Identity {
    const used = new Set<string>();
    this.state.players.forEach((player) => { if (!player.bot && player.identity) used.add(player.identity); });
    return IDENTITIES.find((id) => !used.has(id)) ?? "Derek";
  }
}
