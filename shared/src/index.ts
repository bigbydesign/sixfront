export * from "./ids";
export * from "./cosmetics";
export * from "./weapons";
export * from "./classes";
export * from "./vehicles";
export * from "./modes";
export * from "./math";
export * from "./movement";
export * from "./map";
export * from "./protocol";

import { getMap, blockedAt } from "./map";
import { circleHitsRect } from "./math";
import { emptyInput, stepBike, stepHeli, stepInfantry, type BikeBody } from "./movement";
import { VEHICLES } from "./vehicles";

export function runSanity(): void {
  const map = getMap();
  if (map.objectives.length < 7) throw new Error("objectives missing");
  const ebikes = map.bikes.filter((b) => (b.kind ?? "ebike") === "ebike");
  const helis = map.bikes.filter((b) => b.kind === "heli");
  const cars = map.bikes.filter((b) => b.kind === "car");
  if (ebikes.length !== 2) throw new Error("bikes missing");
  if (helis.length !== 1) throw new Error("helicopter missing");
  if (cars.length !== 1) throw new Error("ford fusion missing");
  const pads = map.decor.filter((d) => d.kind === "trampoline");
  if (pads.length !== 3) throw new Error("trampolines missing");
  for (const pad of pads) {
    if (blockedAt(map, pad.x, pad.y)) throw new Error(`trampoline blocked ${pad.x},${pad.y}`);
    if (map.solids.some((s) => circleHitsRect(pad.x, pad.y, 36, s))) throw new Error(`trampoline in a wall ${pad.x},${pad.y}`);
  }
  const body = { x: 400, y: 400, aim: 0 };
  const env = {
    dt: 0.05,
    solids: map.solids,
    blocked: (x: number, y: number) => blockedAt(map, x, y),
    footMul: () => 1,
    bikeMul: () => 1,
  };
  const input = emptyInput(1);
  input.mx = 1;
  for (let i = 0; i < 10; i++) stepInfantry(body, input, 180, env);
  if (!Number.isFinite(body.x) || body.x <= 400) throw new Error("infantry did not move");
  const bike: BikeBody = {
    x: 1200, y: 900, heading: 0, speed: 0, battery: 100, hp: 100,
    boostLeft: 0, boostCd: 0, braking: false, boosting: false,
  };
  input.mx = 0;
  input.throttle = 1;
  for (let i = 0; i < 20; i++) stepBike(bike, input, VEHICLES.ebike.seats, env);
  if (bike.speed <= 0) throw new Error("bike did not accelerate");
  const heli = { x: 780, y: 1000, z: 0, vz: 0, heading: 0, speed: 0 };
  input.throttle = 1;
  input.brake = true;
  input.crouch = false;
  for (let i = 0; i < 20; i++) stepHeli(heli, input, env);
  if (heli.z <= 0 || heli.speed <= 0) throw new Error("helicopter did not lift");
}
