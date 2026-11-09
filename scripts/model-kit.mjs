/**
 * Tiny low-poly model kit for the port twin's generated models: flat-shaded
 * boxes, beams, prisms and wheels grouped by material, written as one GLB with
 * no dependencies. Used by scripts/build-*-model.mjs style generators.
 */
import { writeFileSync } from 'node:fs';

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => scale(a, 1 / Math.hypot(...a));

/** @param {Record<string, number[]>} MATERIALS name -> [r, g, b] (linear) */
export function createModelKit(MATERIALS) {
  // ---- geometry helpers --------------------------------------------------
  const parts = Object.fromEntries(
    Object.keys(MATERIALS).map((k) => [k, { pos: [], nrm: [], idx: [] }]),
  );

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

  /** Wheel: short horizontal prism along z, with a hub in `hub`. */
  function wheel([x, y, z], r, width, hub = 'grey') {
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
    box(hub, [x, y, z], [r * 0.9, r * 0.9, width * 1.05]);
  }

  function writeGlb(out, meta = {}) {
    const bufferParts = [];
    let byteLength = 0;
    const bufferViews = [];
    const accessors = [];
    const meshes = [];
    const materials = [];
    const nodes = [];
    function pushView(typed, target) {
      const bytes = Buffer.from(
        typed.buffer,
        typed.byteOffset,
        typed.byteLength,
      );
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
        generator: meta.generator ?? 'scripts/model-kit.mjs',
        extras: meta.extras ?? {},
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
    const binBuf = Buffer.concat([
      bin,
      Buffer.alloc((4 - (bin.length % 4)) % 4),
    ]);
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
  }

  return { box, beam, prism, wheel, hexa, quad, writeGlb };
}
