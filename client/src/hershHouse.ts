import * as THREE from "three";

function asphaltFloorTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const n = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const grit = n(x, y);
      const patch = n(Math.floor(x / 8), Math.floor(y / 8));
      let v = 24 + patch * 16 + grit * 10;
      if (grit > 0.8) v = 52 + n(x * 2, y * 3) * 30;
      if (grit < 0.05) v = 14;
      ctx.fillStyle = `rgb(${v | 0},${v | 0},${(v * 0.97) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Big Hersh House — cartoon suburban shell.
 * X left/right, Y up, Z front. Front = +Z. 1 unit = 1 meter.
 * Collision is NOT this mesh; the map uses simple boxes + stair floors.
 */
export function createHershHouse(): THREE.Group {
  const house = new THREE.Group();
  house.name = "HershHouse";

  const HOUSE_W = 11.5;
  const HOUSE_D = 8.0;
  const FLOOR_H = 3.2;
  const WALL_T = 0.22;
  const EAVE_Y = FLOOR_H;
  const RIDGE_Y = 6.1;
  const HALF_W = HOUSE_W / 2;
  const HALF_D = HOUSE_D / 2;

  const sidingMat = new THREE.MeshLambertMaterial({ color: 0x8a9aa4 });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0xf4f0e6 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a4148, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const floorMap = asphaltFloorTex();
  floorMap.repeat.set(4, 3);
  const floorMat = new THREE.MeshBasicMaterial({
    map: floorMap,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6240 });
  const concreteMat = new THREE.MeshLambertMaterial({ color: 0xb8b4a9 });
  const glassMat = new THREE.MeshLambertMaterial({
    color: 0x8ec6e8, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x6a4328 });
  const doorDark = new THREE.MeshLambertMaterial({ color: 0x4a2e1c });
  const garageDoorMat = new THREE.MeshLambertMaterial({ color: 0xe7e2d6 });
  const truckMat = new THREE.MeshLambertMaterial({ color: 0xd5d8dc });
  const truckDark = new THREE.MeshLambertMaterial({ color: 0x2c3136 });
  const brickMat = new THREE.MeshLambertMaterial({ color: 0x8b4939 });
  const ductMat = new THREE.MeshLambertMaterial({ color: 0x9aa3a8 });
  const clothMat = new THREE.MeshLambertMaterial({ color: 0x6a5344 });

  function addBox(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    material: THREE.Material,
    name = "",
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.name = name;
    house.add(mesh);
    return mesh;
  }

  addBox(HOUSE_W, 0.3, HOUSE_D, 0, -0.22, 0, concreteMat, "Foundation");
  addBox(HOUSE_W - WALL_T * 2, 0.16, HOUSE_D - WALL_T * 2, 0, 0.1, 0, floorMat, "GroundFloor");

  const frontZ = HALF_D;
  addBox(1.35, FLOOR_H, WALL_T, -5.075, FLOOR_H / 2, frontZ, sidingMat, "FrontWallLeft");
  addBox(2.6, FLOOR_H, WALL_T, -1.3, FLOOR_H / 2, frontZ, sidingMat, "FrontWallMiddle");
  addBox(2.35, FLOOR_H, WALL_T, 4.575, FLOOR_H / 2, frontZ, sidingMat, "FrontWallRight");
  addBox(1.8, 1.05, WALL_T, -3.5, 2.675, frontZ, sidingMat, "AboveFrontDoor");
  addBox(3.4, 0.9, WALL_T, 1.7, 0.45, frontZ, sidingMat, "BelowFrontWindow");
  addBox(3.4, 0.6, WALL_T, 1.7, 2.9, frontZ, sidingMat, "AboveFrontWindow");

  addBox(HOUSE_W, FLOOR_H, WALL_T, 0, FLOOR_H / 2, -HALF_D, sidingMat, "BackWall");
  addBox(WALL_T, FLOOR_H, HOUSE_D, -HALF_W, FLOOR_H / 2, 0, sidingMat, "LeftWall");
  addBox(WALL_T, FLOOR_H, HOUSE_D, HALF_W, FLOOR_H / 2, 0, sidingMat, "RightWall");

  const posterTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}side-poster.jpg`);
  posterTex.colorSpace = THREE.SRGBColorSpace;
  const posterH = 2.7;
  const posterW = posterH * (975 / 1024);
  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(posterW, posterH),
    new THREE.MeshBasicMaterial({ map: posterTex }),
  );
  poster.position.set(-HALF_W - WALL_T / 2 - 0.04, FLOOR_H / 2, 0);
  poster.rotation.y = -Math.PI / 2;
  poster.name = "SidePoster";
  house.add(poster);

  const insideTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}inside-poster.jpg`);
  insideTex.colorSpace = THREE.SRGBColorSpace;
  const insideH = 2.45;
  const insideW = insideH * (1024 / 976);
  const inside = new THREE.Mesh(
    new THREE.PlaneGeometry(insideW, insideH),
    new THREE.MeshBasicMaterial({ map: insideTex }),
  );
  inside.position.set(1.6, 1.7, -HALF_D + WALL_T / 2 + 0.05);
  inside.name = "InsidePoster";
  house.add(inside);

  const frontDoor = addBox(1.7, 2.15, 0.08, -3.5, 1.075, frontZ + 0.14, doorMat, "FrontDoor");
  frontDoor.userData.interactive = true;
  frontDoor.userData.type = "door";

  // Palladian window: 3.25m wide, shallow arch under the eave
  const winX = 1.7;
  const winW = 3.25;
  const winBase = 0.9;
  const winRect = 1.45;
  addBox(winW, winRect, 0.05, winX, winBase + winRect / 2, frontZ + 0.14, glassMat, "FrontWindow");
  const arch = new THREE.Mesh(new THREE.CircleGeometry(winW / 2, 22, 0, Math.PI), glassMat);
  arch.scale.y = 0.34;
  arch.position.set(winX, winBase + winRect, frontZ + 0.15);
  arch.name = "FrontWindowArch";
  house.add(arch);
  addBox(winW + 0.16, 0.08, 0.08, winX, winBase - 0.02, frontZ + 0.17, trimMat);
  addBox(0.08, winRect + 0.1, 0.08, winX - winW / 2, winBase + winRect / 2, frontZ + 0.17, trimMat);
  addBox(0.08, winRect + 0.1, 0.08, winX + winW / 2, winBase + winRect / 2, frontZ + 0.17, trimMat);
  addBox(0.05, winRect, 0.06, winX, winBase + winRect / 2, frontZ + 0.18, trimMat);
  addBox(winW, 0.05, 0.06, winX, winBase + winRect * 0.55, frontZ + 0.18, trimMat);
  const archTrim = new THREE.Mesh(new THREE.TorusGeometry(winW / 2, 0.045, 6, 18, Math.PI), trimMat);
  archTrim.scale.y = 0.34;
  archTrim.position.set(winX, winBase + winRect, frontZ + 0.18);
  house.add(archTrim);

  const derekTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}derek.png`);
  derekTex.colorSpace = THREE.SRGBColorSpace;
  const paperW = 1.7;
  const paperH = paperW * (267 / 303);
  const wallpaper = new THREE.Mesh(
    new THREE.PlaneGeometry(paperW, paperH),
    new THREE.MeshBasicMaterial({ map: derekTex }),
  );
  wallpaper.position.set(winX + 0.15, 3.08 + paperH / 2, frontZ + 0.32);
  wallpaper.name = "DerekWallpaper";
  house.add(wallpaper);

  const atticY = FLOOR_H + 0.08;
  addBox(1.35, 0.16, HOUSE_D - 0.4, -5.0, atticY, 0, floorMat, "AtticFloorLeft");
  addBox(8.0, 0.16, HOUSE_D - 0.4, 1.4, atticY, 0, floorMat, "AtticFloorMain");
  addBox(1.7, 0.16, 2.8, -3.55, atticY, -2.45, floorMat, "AtticFloorRearStairs");
  addBox(1.7, 0.16, 1.35, -3.55, atticY, 3.0, floorMat, "AtticFloorFrontStairs");

  addBox(WALL_T, 1.05, HOUSE_D, -5.15, FLOOR_H + 0.525, 0, sidingMat, "AtticKneeWallLeft");
  addBox(WALL_T, 1.05, HOUSE_D, 5.15, FLOOR_H + 0.525, 0, sidingMat, "AtticKneeWallRight");

  const roofRise = RIDGE_Y - EAVE_Y;
  const roofRun = HALF_W;
  const roofSlopeLength = Math.hypot(roofRun, roofRise);
  const roofAngle = Math.atan2(roofRise, roofRun);

  const leftRoof = addBox(roofSlopeLength + 0.3, 0.18, HOUSE_D + 0.65, -HALF_W / 2, EAVE_Y + roofRise / 2, 0, roofMat, "RoofLeft");
  leftRoof.rotation.z = roofAngle;
  const rightRoof = addBox(roofSlopeLength + 0.3, 0.18, HOUSE_D + 0.65, HALF_W / 2, EAVE_Y + roofRise / 2, 0, roofMat, "RoofRight");
  rightRoof.rotation.z = -roofAngle;

  function createGable(z: number, name: string): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(-HALF_W, EAVE_Y);
    shape.lineTo(HALF_W, EAVE_Y);
    shape.lineTo(0, RIDGE_Y);
    shape.closePath();
    const gable = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }),
      sidingMat,
    );
    gable.position.z = z;
    gable.name = name;
    house.add(gable);
    return gable;
  }
  createGable(frontZ + 0.04, "FrontGable");
  const rearGable = createGable(-HALF_D - 0.04, "RearGable");
  rearGable.rotation.y = Math.PI;

  addBox(1.45, 1.0, 0.05, 0, 4.35, frontZ + 0.1, glassMat, "AtticWindow");
  addBox(1.65, 0.09, 0.08, 0, 3.81, frontZ + 0.13, trimMat);
  addBox(1.65, 0.09, 0.08, 0, 4.89, frontZ + 0.13, trimMat);

  const stairCount = 16;
  const stairWidth = 1.7;
  const stairDepth = 0.23;
  const stairHeight = FLOOR_H / stairCount;
  for (let i = 0; i < stairCount; i++) {
    const top = stairHeight * (i + 1);
    const z = 2.4 - i * stairDepth;
    addBox(stairWidth, 0.06, stairDepth, -3.55, top - 0.03, z, floorMat, `Stair_${i}`);
    addBox(stairWidth, stairHeight, 0.04, -3.55, top - stairHeight / 2, z + stairDepth / 2, floorMat);
  }

  addBox(2.2, 0.18, 1.35, -3.5, 0.09, 4.65, concreteMat, "FrontPorch");
  addBox(0.18, 2.65, 0.18, -4.7, 1.325, 4.7, trimMat);
  addBox(0.18, 2.65, 0.18, -2.3, 1.325, 4.7, trimMat);
  addBox(0.65, 2.15, 0.65, -2.9, 5.05, -0.5, brickMat, "Chimney");

  // Attic combat dressing — visual only (ridge headroom stays open)
  addBox(1.1, 0.7, 0.8, 2.4, atticY + 0.45, 1.4, crateMat, "AtticCrateA");
  addBox(0.7, 0.55, 0.7, 3.1, atticY + 0.85, 1.5, crateMat, "AtticCrateB");
  addBox(1.6, 0.45, 0.7, 1.2, atticY + 0.35, -2.4, clothMat, "AtticCouch");
  addBox(0.35, 0.55, 0.35, 0.5, atticY + 0.4, -2.2, trimMat, "AtticChair");
  const duct = addBox(0.45, 0.35, 3.2, 3.6, 4.55, 0.2, ductMat, "AtticDuct");
  duct.rotation.y = 0.15;
  for (let i = -3; i <= 3; i++) {
    const rafter = addBox(0.08, 0.12, HOUSE_D - 0.8, i * 0.7, 5.15, 0, roofMat, `Rafter_${i}`);
    rafter.rotation.z = i < 0 ? 0.15 : -0.15;
  }

  return house;
}
