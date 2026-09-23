import Phaser from "phaser";

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas");
  draw(ctx);
  return c;
}

function add(scene: Phaser.Scene, key: string, c: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
}

export function buildTextures(scene: Phaser.Scene): void {
  const tile = canvas(48 * 11, 48, (ctx) => {
    const paints: Array<(g: CanvasRenderingContext2D, x: number) => void> = [
      (g, x) => { g.fillStyle = "#3f6b3a"; g.fillRect(x, 0, 48, 48); speckle(g, x, "#4e7d46", 8); },
      (g, x) => { g.fillStyle = "#3a6236"; g.fillRect(x, 0, 48, 48); speckle(g, x, "#588a4c", 6); },
      (g, x) => { g.fillStyle = "#467445"; g.fillRect(x, 0, 48, 48); speckle(g, x, "#2f522c", 5); },
      (g, x) => { g.fillStyle = "#8a7048"; g.fillRect(x, 0, 48, 48); speckle(g, x, "#a58858", 7); },
      (g, x) => { g.fillStyle = "#5c6168"; g.fillRect(x, 0, 48, 48); g.strokeStyle = "#6e747c"; g.strokeRect(x + 4, 18, 40, 8); },
      (g, x) => { g.fillStyle = "#9aa0a4"; g.fillRect(x, 0, 48, 48); g.strokeStyle = "#7d848a"; g.strokeRect(x + 2, 2, 44, 44); },
      (g, x) => { g.fillStyle = "#2d6d86"; g.fillRect(x, 0, 48, 48); g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(x, 14, 48, 4); g.fillRect(x, 30, 48, 3); },
      (g, x) => { g.fillStyle = "#2c4a30"; g.fillRect(x, 0, 48, 48); speckle(g, x, "#3e6844", 8); },
      (g, x) => { g.fillStyle = "#6a5a3e"; g.fillRect(x, 0, 48, 48); g.strokeStyle = "#3e3428"; g.strokeRect(x + 6, 8, 36, 10); g.strokeRect(x + 6, 28, 36, 10); },
      (g, x) => { g.fillStyle = "#6d8a58"; g.fillRect(x, 0, 48, 48); speckle(g, x, "#d7d2c4", 4); },
      (g, x) => { g.fillStyle = "#6a6258"; g.fillRect(x, 0, 48, 48); g.fillStyle = "#8a8074"; g.fillRect(x, 18, 48, 12); },
    ];
    paints.forEach((paint, i) => paint(ctx, i * 48));
  });
  add(scene, "tiles", tile);

  for (let i = 0; i < 4; i++) {
    add(scene, `legs-${i}`, canvas(64, 40, (ctx) => {
      ctx.fillStyle = "#2a2d28";
      const swing = (i - 1.5) * 5;
      round(ctx, 22, 18, 8, 16);
      ctx.fillRect(34, 16 + swing * 0.2, 8, 16);
      ctx.fillRect(22, 16 - swing * 0.2, 8, 16);
    }));
  }
  add(scene, "torso", canvas(64, 40, (ctx) => {
    ctx.fillStyle = "#ffffff";
    round(ctx, 16, 8, 32, 22);
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.fillRect(30, 8, 4, 22);
  }));
  add(scene, "head", canvas(32, 32, (ctx) => {
    ctx.fillStyle = "#e2b48a";
    ctx.beginPath();
    ctx.arc(16, 16, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a241e";
    ctx.fillRect(20, 14, 3, 2);
  }));
  add(scene, "helmet-1", canvas(32, 32, (ctx) => {
    ctx.fillStyle = "#3e4a3a";
    ctx.beginPath();
    ctx.arc(16, 15, 12, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(6, 14, 22, 6);
  }));
  add(scene, "helmet-2", canvas(32, 32, (ctx) => {
    ctx.fillStyle = "#2f3d55";
    ctx.fillRect(8, 10, 18, 8);
    ctx.fillRect(18, 16, 10, 3);
  }));
  add(scene, "helmet-3", canvas(32, 32, (ctx) => {
    ctx.fillStyle = "#6e2430";
    ctx.beginPath();
    ctx.ellipse(16, 14, 11, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }));
  add(scene, "hat-1", canvas(36, 24, (ctx) => {
    ctx.fillStyle = "#6b7a48";
    ctx.fillRect(10, 4, 16, 8);
    ctx.fillRect(4, 10, 28, 4);
  }));
  add(scene, "hat-2", canvas(28, 20, (ctx) => {
    ctx.fillStyle = "#2c3038";
    round(ctx, 6, 4, 16, 10);
  }));
  add(scene, "vest-1", canvas(40, 28, (ctx) => {
    ctx.fillStyle = "rgba(40,44,38,.55)";
    round(ctx, 6, 2, 28, 22);
  }));
  add(scene, "vest-2", canvas(40, 28, (ctx) => {
    ctx.fillStyle = "rgba(28,32,30,.8)";
    round(ctx, 4, 2, 32, 24);
    ctx.fillStyle = "#8a8f86";
    ctx.fillRect(18, 6, 4, 14);
  }));
  add(scene, "face-1", canvas(32, 16, (ctx) => {
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 4, 8, 6);
    ctx.strokeRect(16, 4, 8, 6);
  }));
  add(scene, "face-2", canvas(32, 16, (ctx) => {
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(8, 6, 14, 8);
  }));
  add(scene, "face-3", canvas(32, 16, (ctx) => {
    ctx.fillStyle = "#22262c";
    round(ctx, 6, 2, 18, 12);
  }));

  const guns: Record<string, (ctx: CanvasRenderingContext2D) => void> = {
    rifle: (ctx) => { ctx.fillStyle = "#2a2e28"; ctx.fillRect(8, 10, 36, 5); ctx.fillRect(18, 14, 8, 7); },
    pistol: (ctx) => { ctx.fillStyle = "#2a2e28"; ctx.fillRect(8, 10, 16, 5); ctx.fillRect(12, 14, 5, 8); },
    smg: (ctx) => { ctx.fillStyle = "#34382f"; ctx.fillRect(6, 11, 28, 5); ctx.fillRect(14, 15, 6, 8); },
    lmg: (ctx) => { ctx.fillStyle = "#2c3028"; ctx.fillRect(4, 9, 46, 7); ctx.fillRect(16, 15, 10, 8); ctx.fillStyle = "#6a5a32"; ctx.fillRect(28, 16, 8, 10); },
    carbine: (ctx) => { ctx.fillStyle = "#31362e"; ctx.fillRect(8, 10, 32, 5); ctx.fillRect(16, 14, 7, 6); },
    scout: (ctx) => { ctx.fillStyle = "#3a342c"; ctx.fillRect(4, 11, 48, 4); ctx.fillStyle = "#1c1c1c"; ctx.fillRect(30, 8, 10, 3); },
    rocket: (ctx) => { ctx.fillStyle = "#4a4034"; ctx.fillRect(4, 8, 40, 10); ctx.fillStyle = "#c45a3a"; ctx.fillRect(40, 10, 8, 6); },
  };
  for (const [name, draw] of Object.entries(guns)) add(scene, `gun-${name}`, canvas(56, 28, draw));

  add(scene, "ebike", canvas(78, 36, (ctx) => {
    ctx.fillStyle = "#1e2420";
    ctx.beginPath(); ctx.arc(16, 24, 8, 0, Math.PI * 2); ctx.arc(60, 24, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#d8d2c6"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(16, 24); ctx.lineTo(34, 16); ctx.lineTo(52, 18); ctx.lineTo(60, 24); ctx.stroke();
    ctx.fillStyle = "#c9842a";
    ctx.fillRect(30, 14, 16, 6);
    ctx.fillStyle = "#9ad0ff";
    ctx.fillRect(62, 12, 6, 4);
  }));
  add(scene, "tree", canvas(64, 72, (ctx) => {
    ctx.fillStyle = "#5a4632"; ctx.fillRect(28, 40, 8, 26);
    ctx.fillStyle = "#2f6a38"; ctx.beginPath(); ctx.arc(32, 28, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3e8048"; ctx.beginPath(); ctx.arc(24, 24, 10, 0, Math.PI * 2); ctx.fill();
  }));
  add(scene, "bush", canvas(36, 24, (ctx) => {
    ctx.fillStyle = "#3d7a46"; ctx.beginPath(); ctx.ellipse(18, 14, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
  }));
  add(scene, "crate", canvas(24, 24, (ctx) => {
    ctx.fillStyle = "#8a6238"; ctx.fillRect(2, 2, 20, 20);
    ctx.strokeStyle = "#5c4024"; ctx.strokeRect(2, 2, 20, 20);
  }));
  add(scene, "barrier", canvas(36, 18, (ctx) => {
    ctx.fillStyle = "#b7b1a4"; ctx.fillRect(0, 4, 36, 10);
    ctx.fillStyle = "#c45a3a"; ctx.fillRect(4, 6, 8, 6); ctx.fillRect(20, 6, 8, 6);
  }));
  add(scene, "lamp", canvas(20, 48, (ctx) => {
    ctx.fillStyle = "#2c3130"; ctx.fillRect(8, 10, 4, 38);
    ctx.fillStyle = "#f0e2b0"; ctx.beginPath(); ctx.arc(10, 8, 6, 0, Math.PI * 2); ctx.fill();
  }));
  add(scene, "tent", canvas(52, 36, (ctx) => {
    ctx.fillStyle = "#6e7c58"; ctx.beginPath(); ctx.moveTo(2, 32); ctx.lineTo(26, 4); ctx.lineTo(50, 32); ctx.fill();
  }));
  add(scene, "wreck", canvas(60, 32, (ctx) => {
    ctx.fillStyle = "#5c5348"; ctx.fillRect(6, 10, 48, 14);
    ctx.fillStyle = "#2a2a28"; ctx.beginPath(); ctx.arc(16, 24, 6, 0, Math.PI * 2); ctx.arc(44, 24, 6, 0, Math.PI * 2); ctx.fill();
  }));
  add(scene, "rock", canvas(40, 28, (ctx) => {
    ctx.fillStyle = "#8d8a84"; ctx.beginPath(); ctx.ellipse(20, 16, 16, 10, 0, 0, Math.PI * 2); ctx.fill();
  }));
  add(scene, "charger", canvas(28, 40, (ctx) => {
    ctx.fillStyle = "#2e3430"; ctx.fillRect(8, 8, 12, 28);
    ctx.fillStyle = "#7dcea0"; ctx.fillRect(10, 12, 8, 6);
    ctx.fillStyle = "#c9842a"; ctx.fillRect(4, 4, 20, 4);
  }));
  add(scene, "tower", canvas(40, 56, (ctx) => {
    ctx.fillStyle = "#6a6258"; ctx.fillRect(12, 16, 16, 36);
    ctx.fillStyle = "#c9842a"; ctx.fillRect(6, 8, 28, 10);
  }));
  add(scene, "bullet", canvas(10, 4, (ctx) => {
    ctx.fillStyle = "#f4e2a8"; ctx.fillRect(0, 0, 10, 4);
  }));
  add(scene, "grenade", canvas(12, 12, (ctx) => {
    ctx.fillStyle = "#4e6a3a"; ctx.beginPath(); ctx.arc(6, 7, 5, 0, Math.PI * 2); ctx.fill();
  }));
  add(scene, "shadow", canvas(40, 16, (ctx) => {
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(20, 8, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
  }));

  const roofs: Record<string, string> = {
    hq: "#6d6248", barn: "#8a3a32", house: "#7a6558", shed: "#6e6256",
    power: "#4d5964", bunker: "#5c6458", warehouse: "#6a5e52",
  };
  for (const [kind, color] of Object.entries(roofs)) {
    add(scene, `b-${kind}`, canvas(80, 64, (ctx) => {
      ctx.fillStyle = "#3e4450";
      ctx.fillRect(8, 18, 64, 40);
      ctx.fillStyle = color;
      ctx.fillRect(6, 8, 64, 36);
      ctx.fillStyle = "rgba(255,255,255,.18)";
      ctx.fillRect(14, 16, 10, 8);
      ctx.fillRect(32, 16, 10, 8);
      ctx.fillRect(50, 16, 10, 8);
    }));
  }
}

function speckle(ctx: CanvasRenderingContext2D, x: number, color: string, n: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) ctx.fillRect(x + ((i * 17) % 44) + 2, (i * 13) % 40, 3, 2);
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
}

export function tileIndex(surface: number, c: number, r: number): number {
  if (surface === 0) return 1;
  if (surface === 1) return 4;
  if (surface === 2) return 5;
  if (surface === 3) return 6;
  if (surface === 4) return 7;
  if (surface === 5) return 8;
  if (surface === 6) return 9;
  if (surface === 7) return 10;
  return 11;
}
