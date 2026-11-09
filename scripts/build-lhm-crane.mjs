#!/usr/bin/env node
/**
 * Builds public/models/port/lhm-420.glb: a low-poly mobile harbour crane in
 * the shape of a Liebherr LHM 420, for the Port of Hueneme twin.
 *
 * Original geometry, laid out by eye from Liebherr's published LHM 420 photos
 * (X-shaped undercarriage on four outrigger pads, wheel bogies under the
 * chassis, yellow machine house with a white power-pack, dark grey tapered
 * tower with the cabin high up, rear A-frame, white four-chord lattice boom).
 * No logos or lettering. Dimensions are approximate.
 *
 * Model conventions (public/models/README.md): metres, glTF +Y up, front
 * (the boom) toward local -X, origin on the ground under the slewing centre.
 *
 *   node scripts/build-lhm-crane.mjs [out.glb] [--boom-deg 45]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const out = resolve(
  args.find((a) => a.endsWith('.glb')) ?? 'public/models/port/lhm-420.glb',
);
const BOOM_DEG = flag('--boom-deg', 45);

const MATERIALS = {
  grey: [0.27, 0.3, 0.33],
  dark: [0.16, 0.18, 0.2],
  yellow: [0.95, 0.68, 0.05],
  white: [0.9, 0.91, 0.92],
  rubber: [0.06, 0.06, 0.07],
  glass: [0.35, 0.5, 0.6],
};

// ---- geometry helpers --------------------------------------------------
const parts = Object.fromEntries(
  Object.keys(MATERIALS).map((k) => [k, { pos: [], nrm: [], idx: [] }]),
);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => scale(a, 1 / Math.hypot(...a));

/** Flat-shaded quad (a,b,c,d counter-clockwise seen from outside). */
function quad(mat, a, b, c, d) {
  const p = parts[mat];
  const n = norm(cross(sub(b, a), sub(c, a)));
  const base = p.pos.length / 3;
  for (const v of [a, b, c, d]) (p.pos.push(...v), p.nrm.push(...n));
  p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Hexahedron from 8 corners: bottom 0-3 and top 4-7, same winding. */
function hexa(mat, c) {
  const [b0, b1, b2, b3, t0, t1, t2, t3] = c;
  quad(mat, b1, b2, b3, b0); // bottom
  quad(mat, t3, t2, t1, t0); // top
  quad(mat, t0, t1, b1, b0);
  quad(mat, t1, t2, b2, b1);
  quad(mat, t2, t3, b3, b2);
  quad(mat, t3, t0, b0, b3);
}

/** Axis-aligned box from centre and size. */
function box(mat, [cx, cy, cz], [sx, sy, sz]) {
  const x0 = cx - sx / 2,
    x1 = cx + sx / 2,
    y0 = cy - sy / 2,
    y1 = cy + sy / 2,
    z0 = cz - sz / 2,
    z1 = cz + sz / 2;
  hexa(mat, [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ]);
}

/** Square-section beam of width w from point a to point b. */
function beam(mat, a, b, w, h = w) {
  const dir = norm(sub(b, a));
  const helper = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = scale(norm(cross(dir, helper)), w / 2);
  const v = scale(norm(cross(u, dir)), h / 2);
  const ring = (p) => [
    sub(sub(p, u), v),
    sub(add(p, u), v),
    add(add(p, u), v),
    add(sub(p, u), v),
  ];
  const [a0, a1, a2, a3] = ring(a);
  const [b0, b1, b2, b3] = ring(b);
  hexa(mat, [a0, a1, a2, a3, b0, b1, b2, b3]);
}

/** Vertical n-sided prism (tapering), from y0 to y1 at (x, z). */
function prism(mat, [x, z], y0, y1, r0, r1, n = 8) {
  const ang = (i) => (i / n) * Math.PI * 2 + Math.PI / n;
  for (let i = 0; i < n; i += 1) {
    const a = ang(i),
      b = ang(i + 1);
    quad(
      mat,
      [x + r1 * Math.cos(a), y1, z + r1 * Math.sin(a)],
      [x + r1 * Math.cos(b), y1, z + r1 * Math.sin(b)],
      [x + r0 * Math.cos(b), y0, z + r0 * Math.sin(b)],
      [x + r0 * Math.cos(a), y0, z + r0 * Math.sin(a)],
    );
  }
  // caps
  for (let i = 0; i < n; i += 1) {
    const a = ang(i),
      b = ang(i + 1);
    const p = parts[mat];
    for (const [r, y, up] of [
      [r1, y1, 1],
      [r0, y0, -1],
    ]) {
      const base = p.pos.length / 3;
      const verts =
        up > 0
          ? [
              [x, y, z],
              [x + r * Math.cos(b), y, z + r * Math.sin(b)],
              [x + r * Math.cos(a), y, z + r * Math.sin(a)],
            ]
          : [
              [x, y, z],
              [x + r * Math.cos(a), y, z + r * Math.sin(a)],
              [x + r * Math.cos(b), y, z + r * Math.sin(b)],
            ];
      for (const v of verts) (p.pos.push(...v), p.nrm.push(0, up, 0));
      p.idx.push(base, base + 1, base + 2);
    }
  }
}

/** Wheel: short horizontal prism along z. */
function wheel([x, y, z], r, width) {
  const n = 10;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2,
      b = ((i + 1) / n) * Math.PI * 2;
    const pt = (t, s) => [x + r * Math.cos(t), y + r * Math.sin(t), z + s];
    quad(
      'rubber',
      pt(a, -width / 2),
      pt(b, -width / 2),
      pt(b, width / 2),
      pt(a, width / 2),
    );
  }
  box('grey', [x, y, z], [r * 0.9, r * 0.9, width * 1.05]);
}

// ---- the crane ---------------------------------------------------------
// Front (boom side, toward the ship) is -X. z is across the chassis.

// Chassis: long beam along the quay (z), carried on wheel bogies.
const CHASSIS_Y = 2.6;
box('grey', [0, CHASSIS_Y, 0], [4.2, 1.8, 15]);
for (const side of [-1, 1]) {
  // Two bogie rows, eight axles each side.
  for (let i = 0; i < 8; i += 1) {
    const z = -6.3 + i * 1.8;
    box('dark', [side * 1.6, 1.35, z], [0.6, 0.9, 0.6]);
    wheel([side * 1.6, 0.55, z - 0.35], 0.55, 0.45);
    wheel([side * 1.6, 0.55, z + 0.35], 0.55, 0.45);
  }
}

// X-shaped outriggers to four pads.
const PAD = 7.2;
for (const sx of [-1, 1])
  for (const sz of [-1, 1]) {
    beam(
      'grey',
      [sx * 1.6, CHASSIS_Y + 0.3, sz * 3.5],
      [sx * PAD, 1.4, sz * PAD],
      1.1,
      1.3,
    );
    box('dark', [sx * PAD, 0.9, sz * PAD], [0.6, 1.2, 0.6]);
    box('grey', [sx * PAD, 0.15, sz * PAD], [3.2, 0.3, 2.2]);
  }

// Slewing ring and machine house (yellow) with the white power-pack.
prism('dark', [0, 0], CHASSIS_Y + 0.9, CHASSIS_Y + 1.6, 2.6, 2.6, 12);
const HOUSE_Y0 = CHASSIS_Y + 1.6;
box('dark', [1.2, HOUSE_Y0 + 0.4, 0], [10, 0.8, 6.2]);
box('yellow', [1.2, HOUSE_Y0 + 2.0, 0], [10, 2.4, 6]);
box('grey', [1.2, HOUSE_Y0 + 3.3, 0], [10, 0.25, 6.1]);
box('white', [4.2, HOUSE_Y0 + 4.5, 1.2], [2.6, 2.2, 2.2]);
box('white', [4.2, HOUSE_Y0 + 4.5, -1.4], [2.6, 2.2, 1.8]);
box('dark', [5.3, HOUSE_Y0 + 6.1, 1.2], [0.25, 1.0, 0.25]); // exhaust
const HOUSE_TOP = HOUSE_Y0 + 3.4;

// Tower: tapered dark grey column with a cabin near the top.
const TOWER_TOP = 31;
prism('dark', [0, 0], HOUSE_TOP, TOWER_TOP, 1.9, 1.15, 8);
box('dark', [0, TOWER_TOP + 0.6, 0], [3.4, 1.2, 2.6]); // tower head
box('grey', [-2.3, 24.6, 0], [2.6, 2.6, 2.4]); // cabin
box('glass', [-3.62, 24.9, 0], [0.05, 1.5, 2.0]);
box('grey', [-0.8, 23.1, 0], [4.2, 0.2, 3.4]); // cabin platform

// Rear A-frame / portal behind the tower.
const FRAME_X = 6.4;
for (const sz of [-1, 1]) {
  beam(
    'dark',
    [FRAME_X, HOUSE_TOP, sz * 2.4],
    [1.0, TOWER_TOP + 0.4, sz * 0.9],
    0.35,
  );
  beam('dark', [FRAME_X, HOUSE_TOP, sz * 2.4], [FRAME_X, 21, sz * 2.4], 0.3);
}
beam('dark', [FRAME_X, 21, -2.4], [FRAME_X, 21, 2.4], 0.3);
beam('dark', [FRAME_X, 21, 2.4], [1.5, 21, 1.4], 0.25);
beam('dark', [FRAME_X, 21, -2.4], [1.5, 21, -1.4], 0.25);

// Boom: white four-chord lattice, foot low on the tower, pointing -X.
const FOOT = [-1.7, 13.5, 0];
const BOOM_LEN = 46;
const t = (BOOM_DEG * Math.PI) / 180;
const dir = [-Math.cos(t), Math.sin(t), 0];
const up = [Math.sin(t), Math.cos(t), 0]; // perpendicular, in the luff plane
const across = [0, 0, 1];
const halfW = (s) => 1.25 - 0.55 * s; // tapers toward the tip
const halfH = (s) => 1.0 - 0.45 * s;
const chord = (s, iu, ia) =>
  add(
    add(add(FOOT, scale(dir, s * BOOM_LEN)), scale(up, iu * halfH(s))),
    scale(across, ia * halfW(s)),
  );
const corners = [
  [-1, -1],
  [-1, 1],
  [1, 1],
  [1, -1],
];
const SEG = 12;
for (const [iu, ia] of corners)
  beam('white', chord(0, iu, ia), chord(1, iu, ia), 0.28);
for (let k = 0; k <= SEG; k += 1) {
  const s = k / SEG;
  for (let c = 0; c < 4; c += 1) {
    const [iu, ia] = corners[c];
    const [ju, ja] = corners[(c + 1) % 4];
    beam('white', chord(s, iu, ia), chord(s, ju, ja), 0.12);
    if (k < SEG) {
      const s2 = (k + 1) / SEG;
      beam('white', chord(s, iu, ia), chord(s2, ju, ja), 0.1);
    }
  }
}
const TIP = add(FOOT, scale(dir, BOOM_LEN));
box('dark', TIP, [1.6, 1.6, 1.4]); // head sheaves
// Luffing cylinder from the house to the boom.
beam('grey', [-2.6, HOUSE_TOP + 0.5, 0], add(FOOT, scale(dir, 9)), 0.7);
// Hoist ropes from the tower head to the boom tip, then a hanging hook.
beam('dark', [0, TOWER_TOP + 0.6, 0.4], add(TIP, [0, 0.4, 0.4]), 0.08);
beam('dark', [0, TOWER_TOP + 0.6, -0.4], add(TIP, [0, 0.4, -0.4]), 0.08);
const HOOK_Y = 18;
beam('dark', TIP, [TIP[0], HOOK_Y + 1.2, 0], 0.1);
box('yellow', [TIP[0], HOOK_Y + 0.6, 0], [1.4, 1.2, 1.0]);

// ---- write GLB -----------------------------------------------------------
const bufferParts = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];
const meshes = [];
const materials = [];
const nodes = [];
function pushView(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) (bufferParts.push(Buffer.alloc(pad)), (byteLength += pad));
  bufferViews.push({
    buffer: 0,
    byteOffset: byteLength,
    byteLength: bytes.length,
    target,
  });
  bufferParts.push(bytes);
  byteLength += bytes.length;
  return bufferViews.length - 1;
}
for (const [name, rgb] of Object.entries(MATERIALS)) {
  const p = parts[name];
  if (!p.idx.length) continue;
  const pos = new Float32Array(p.pos);
  const nrm = new Float32Array(p.nrm);
  const idx = new Uint32Array(p.idx);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let j = 0; j < 3; j += 1) {
      min[j] = Math.min(min[j], pos[i + j]);
      max[j] = Math.max(max[j], pos[i + j]);
    }
  const count = pos.length / 3;
  accessors.push(
    {
      bufferView: pushView(pos, 34962),
      componentType: 5126,
      count,
      type: 'VEC3',
      min,
      max,
    },
    {
      bufferView: pushView(nrm, 34962),
      componentType: 5126,
      count,
      type: 'VEC3',
    },
    {
      bufferView: pushView(idx, 34963),
      componentType: 5125,
      count: idx.length,
      type: 'SCALAR',
    },
  );
  const a = accessors.length - 3;
  materials.push({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [...rgb, 1],
      metallicFactor: name === 'glass' ? 0.2 : 0.1,
      roughnessFactor: name === 'glass' ? 0.2 : 0.7,
    },
    doubleSided: true,
  });
  meshes.push({
    name,
    primitives: [
      {
        attributes: { POSITION: a, NORMAL: a + 1 },
        indices: a + 2,
        material: materials.length - 1,
      },
    ],
  });
  nodes.push({ name, mesh: meshes.length - 1 });
}
const bin = Buffer.concat(bufferParts);
const json = {
  asset: {
    version: '2.0',
    generator: 'scripts/build-lhm-crane.mjs',
    extras: {
      title: 'Mobile harbour crane (LHM 420 style)',
      boomDeg: BOOM_DEG,
    },
  },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: bin.length }],
};
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([
  jsonBuf,
  Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20),
]);
const binBuf = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const chunk = (buf, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(buf.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, buf]);
};
writeFileSync(
  out,
  Buffer.concat([
    header,
    chunk(jsonBuf, 0x4e4f534a),
    chunk(binBuf, 0x004e4942),
  ]),
);
const tris = Object.values(parts).reduce((n, p) => n + p.idx.length / 3, 0);
console.log(
  `wrote ${out}: ${tris} triangles, ${((12 + jsonBuf.length + binBuf.length + 16) / 1024) | 0} KB`,
);
