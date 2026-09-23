export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function angDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angDelta(b, a) * t;
}

export function circleHitsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, rect: Rect): boolean {
  if (circleHitsRect(x1, y1, 0.01, rect) || circleHitsRect(x2, y2, 0.01, rect)) return true;
  const steps = 4;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (circleHitsRect(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 1, rect)) return true;
  }
  return false;
}

export function rayCircle(x: number, y: number, dx: number, dy: number, cx: number, cy: number, r: number): number | null {
  const fx = x - cx;
  const fy = y - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export function rayRect(x: number, y: number, dx: number, dy: number, max: number, rect: Rect): number | null {
  let tmin = 0;
  let tmax = max;
  const slab = (d: number, origin: number, min: number, maxEdge: number): boolean => {
    if (Math.abs(d) < 1e-8) return origin >= min && origin <= maxEdge;
    let t1 = (min - origin) / d;
    let t2 = (maxEdge - origin) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  if (!slab(dx, x, rect.x, rect.x + rect.w)) return null;
  if (!slab(dy, y, rect.y, rect.y + rect.h)) return null;
  if (tmax < 0 || tmin < 0) return null;
  return tmin;
}

export function segmentHitsCircle(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, r: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const px = x1 + dx * t;
  const py = y1 + dy * t;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey <= r * r;
}

/** Shove a body back out of any wall it has overlapped so it can move again. */
function pushOutOfSolids(x: number, y: number, r: number, solids: Rect[]): { x: number; y: number } {
  for (let pass = 0; pass < 6; pass++) {
    let hit = false;
    for (const s of solids) {
      if (!circleHitsRect(x, y, r, s)) continue;
      hit = true;
      const nearestX = Math.max(s.x, Math.min(x, s.x + s.w));
      const nearestY = Math.max(s.y, Math.min(y, s.y + s.h));
      let ox = x - nearestX;
      let oy = y - nearestY;
      const dist = Math.hypot(ox, oy);
      if (dist < 0.01) {
        const left = x - s.x;
        const right = s.x + s.w - x;
        const down = y - s.y;
        const up = s.y + s.h - y;
        const min = Math.min(left, right, down, up);
        if (min === left) x = s.x - r - 1;
        else if (min === right) x = s.x + s.w + r + 1;
        else if (min === down) y = s.y - r - 1;
        else y = s.y + s.h + r + 1;
      } else {
        const push = r - dist + 1;
        x += (ox / dist) * push;
        y += (oy / dist) * push;
      }
    }
    if (!hit) break;
  }
  return { x, y };
}

export function moveCircle(
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  solids: Rect[],
  blocked: (x: number, y: number) => boolean,
): { x: number; y: number } {
  const hits = (px: number, py: number) =>
    blocked(px, py) || solids.some((s) => circleHitsRect(px, py, r, s));
  const freed = pushOutOfSolids(x, y, r, solids);
  let cx = freed.x;
  let cy = freed.y;
  const dist = Math.hypot(dx, dy);
  const slices = Math.max(1, Math.ceil(dist / 6));
  const sx = dx / slices;
  const sy = dy / slices;
  for (let i = 0; i < slices; i++) {
    const prevX = cx;
    const prevY = cy;
    if (!hits(cx + sx, cy)) cx += sx;
    if (!hits(cx, cy + sy)) cy += sy;
    if (cx === prevX && cy === prevY) break;
  }
  if (hits(cx, cy)) return pushOutOfSolids(x, y, r, solids);
  return { x: cx, y: cy };
}
