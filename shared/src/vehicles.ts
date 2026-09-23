export type VehicleKind = "ebike" | "heli" | "car" | "atv" | "cart" | "jeep" | "moto" | "armor" | "boat";

export interface VehicleDef {
  kind: VehicleKind;
  name: string;
  seats: number;
  maxSpeed: number;
  reverse: number;
  accel: number;
  drag: number;
  turn: number;
  hp: number;
  battery: number;
  drain: number;
  implemented: boolean;
}

export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  ebike: {
    kind: "ebike", name: "eBike", seats: 2, maxSpeed: 460, reverse: 140, accel: 520, drag: 0.55,
    turn: 2.4, hp: 150, battery: 100, drain: 0, implemented: true,
  },
  heli: {
    kind: "heli", name: "Helicopter", seats: 2, maxSpeed: 380, reverse: 160, accel: 260, drag: 0.85,
    turn: 1.5, hp: 280, battery: 100, drain: 0, implemented: true,
  },
  car: {
    kind: "car", name: "Ford Fusion", seats: 2, maxSpeed: 340, reverse: 120, accel: 210, drag: 0.72,
    turn: 1.35, hp: 420, battery: 100, drain: 0, implemented: true,
  },
  atv: { kind: "atv", name: "ATV", seats: 2, maxSpeed: 400, reverse: 120, accel: 380, drag: 0.8, turn: 2, hp: 220, battery: 100, drain: 0, implemented: false },
  cart: { kind: "cart", name: "Golf Cart", seats: 2, maxSpeed: 280, reverse: 100, accel: 260, drag: 1.1, turn: 2.2, hp: 120, battery: 100, drain: 4, implemented: false },
  jeep: { kind: "jeep", name: "Jeep", seats: 3, maxSpeed: 380, reverse: 110, accel: 240, drag: 0.7, turn: 1.5, hp: 320, battery: 0, drain: 0, implemented: false },
  moto: { kind: "moto", name: "Motorcycle", seats: 2, maxSpeed: 520, reverse: 80, accel: 480, drag: 0.4, turn: 2.6, hp: 110, battery: 0, drain: 0, implemented: false },
  armor: { kind: "armor", name: "Armored Vehicle", seats: 3, maxSpeed: 240, reverse: 80, accel: 120, drag: 0.6, turn: 1.1, hp: 800, battery: 0, drain: 0, implemented: false },
  boat: { kind: "boat", name: "Boat", seats: 3, maxSpeed: 300, reverse: 80, accel: 180, drag: 0.9, turn: 1.3, hp: 200, battery: 0, drain: 0, implemented: false },
};

export const FOOT_RADIUS = 15;
export const BIKE_RADIUS = 18;
