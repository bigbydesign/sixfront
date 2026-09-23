import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") identity = "";
  @type("uint8") bot = 0;
  @type("int8") team = 0;
  @type("string") classId = "rifleman";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") aim = 0;
  @type("int16") hp = 100;
  @type("int16") maxHp = 100;
  @type("uint8") alive = 0;
  @type("string") vehicleId = "";
  @type("int8") seat = -1;
  @type("uint8") weaponSlot = 1;
  @type("uint16") mag = 0;
  @type("uint16") reserve = 0;
  @type("uint8") grenades = 0;
  @type("uint8") reloading = 0;
  @type("float32") reloadPct = 0;
  @type("float32") abilityCd = 0;
  @type("float32") abilityMax = 1;
  @type("uint16") kills = 0;
  @type("uint16") deaths = 0;
  @type("uint16") score = 0;
  @type("uint16") ping = 0;
  @type("uint8") ready = 0;
  @type("uint8") helmet = 0;
  @type("uint8") hat = 0;
  @type("uint8") shirt = 0;
  @type("uint8") vest = 0;
  @type("uint8") pants = 0;
  @type("uint8") face = 0;
  @type("uint8") seenMask = 0;
  @type("uint8") blip = 0;
  @type("uint32") ack = 0;
  @type("float32") respawnLeft = 0;
  @type("string") killerName = "";
  @type("string") killerWeapon = "";
  @type("uint16") killerDist = 0;
  @type("uint8") sprinting = 0;
  @type("float32") floorZ = 0;
  @type("float32") jumpZ = 0;
  /** Look up/down. Spectators use this for that player's view. */
  @type("float32") pitch = 0;
}

export class VehicleState extends Schema {
  @type("string") id = "";
  @type("string") kind = "ebike";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") heading = 0;
  @type("float32") z = 0;
  @type("float32") speed = 0;
  @type("float32") battery = 100;
  @type("int16") hp = 150;
  @type("int16") maxHp = 150;
  @type("string") driver = "";
  @type("string") passenger = "";
  @type("uint8") alive = 1;
  @type("uint8") braking = 0;
  @type("uint8") boosting = 0;
  @type("uint8") seats = 1;
  @type("uint8") base = 0;
  @type("float32") respawn = 0;
}

export class ObjectiveState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") r = 100;
  @type("string") group = "front";
  @type("int8") owner = -1;
  @type("float32") progress = 0;
  @type("int8") progressTeam = -1;
  @type("uint8") active = 0;
}

export class TowerState extends Schema {
  @type("string") id = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") r = 80;
  @type("int8") owner = -1;
  @type("float32") progress = 0;
  @type("int8") progressTeam = -1;
}

export class ProjectileState extends Schema {
  @type("string") id = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") vx = 0;
  @type("float32") vy = 0;
  @type("string") kind = "bullet";
  @type("string") owner = "";
  @type("int8") team = 0;
  @type("string") weapon = "rifle";
}

export class BarricadeState extends Schema {
  @type("string") id = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") w = 64;
  @type("float32") h = 18;
  @type("int16") hp = 90;
  @type("int8") team = 0;
  @type("string") owner = "";
}

/** World pickups: 4Loco heal cans, placed Colt 45 bottles, etc. */
export class PickupState extends Schema {
  @type("string") id = "";
  @type("string") kind = "loco"; // loco | colt
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("uint8") alive = 1;
}

/** Interactable house door. */
export class DoorState extends Schema {
  @type("string") id = "";
  @type("uint8") open = 0;
}

export class WarState extends Schema {
  @type("string") phase = "lobby";
  @type("string") code = "";
  @type("string") hostId = "";
  @type("string") mode = "conquest";
  @type("string") mapId = "hersh-house";
  @type("uint8") minutes = 15;
  @type("uint16") scoreLimit = 500;
  @type("string") teamMode = "two";
  @type("uint8") friendlyFire = 0;
  @type("uint8") aiCount = 0;
  @type("uint8") respawn = 5;
  @type("uint8") night = 0;
  @type("uint16") timeLeft = 15 * 60;
  @type("uint16") score0 = 0;
  @type("uint16") score1 = 0;
  @type("uint16") score2 = 0;
  @type("int8") winnerTeam = -1;
  @type("string") winnerName = "";
  @type("uint8") derlAlive = 0;
  @type("int16") derlHp = 0;
  @type("int16") derlMaxHp = 800;
  @type("float32") derlConfidence = 1;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: VehicleState }) vehicles = new MapSchema<VehicleState>();
  @type([ObjectiveState]) objectives = new ArraySchema<ObjectiveState>();
  @type({ map: TowerState }) towers = new MapSchema<TowerState>();
  @type({ map: ProjectileState }) projectiles = new MapSchema<ProjectileState>();
  @type({ map: BarricadeState }) barricades = new MapSchema<BarricadeState>();
  @type({ map: PickupState }) pickups = new MapSchema<PickupState>();
  @type({ map: DoorState }) doors = new MapSchema<DoorState>();
}
